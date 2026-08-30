# Ravel × Histos 系统设计与实现路线

更新日期：2026-08-30
状态：设计定稿 + 实现计划（未实施部分以本篇为准）
前置：[`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md)（不变量）、[`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)（当前状态快照）

本文是 Histos 的**信息架构与演进路线**的单一入口，回答三个问题：Histos 里有什么（分类学）、删改如何可追溯（追溯模型）、接下来按什么顺序做什么（路线图）。历史验收与借鉴决策的骨架见 [`ravel-history-archive.md`](./ravel-history-archive.md)。

---

## 1. 内容分类学（终版）

来源：对 oh-my-pi / prime-agent / opencode / kilocode / hermes-agent / deepseek-harness 六项目与 zed 的内容类型对照分析，经用户逐轮确认收敛。

六大类，每类回答一个问题：

| 大类 | 回答什么 | 子类 | 数据落点（现有通道） |
|---|---|---|---|
| **记忆** | 发生过什么、知道什么 | 叙事记忆（会话摘要/ContextSet，"作家"）、程序记忆（解题步骤/操作链，"数学家"）、语义事实（Fact Graph triple）、项目知识（AGENTS.md 等静态输入）、**项目理解**（agent 消化项目得到的地图，zread 式，静态产出） | A→B、condenseGraph、结构图 |
| **能力** | 能做什么 | skill / 插件 / MCP / prompt（同一类的四个子类型），外加市场目录面（来源/版本/SHA） | E（agent_spec）+ 蒸馏工件 |
| **策略** | 按什么方案干活 | 单体策略=运行模式（约束集）、团队策略=sub-agent 编排（角色组合）、任务策略=真工作流（参数化任务模板）；三者共享同一生命周期：基础示例 → 对话共创 → 校验 → 人审 → 运行 → 沉淀 → 版本迭代 | E + C + 审批门 |
| **成果** | 产出了什么 | GraphRevision、报告、导出、Flow 实例 | C |
| **账目与观测** | 花了什么、被允许了什么、观察到什么 | 审批记录、费用、调度历史、诊断/日志 | A→B，只增不改 |
| **配置** | 系统怎么设置 | 生效投影视图、变更历史、user/project 分层来源、环境子域 | 待 `config_changed` 事实（P1） |

两条原则：

1. **易变运行时状态不入权威层，只入事件流**（worker 池状态、REPL 命名空间等；状态转换本身可作为事实记录）。
2. **凭据明文永不入 Histos**（与 `.env`/配置分离同理，hermes 的密钥强制分离是同一直觉）。

不做区（明确排除，防范围漂移）：协作/CRDT 多人分享、云沙箱、语音输入、图数据库、第二套 agent runtime。

---

## 2. 追溯双前提（空间可追溯 + 时间可追溯）

这是所有 Histos 内容操作的横切约束，优先于一切功能开发落地（P0）。

### 2.1 空间可追溯：能找到原内容，也能删除记录

**"能找到原内容"**：任何 Histos 投影对象（triple、节点、边、工件）都通过 Evidence → FactAddress 锚定权威源（JSONL 事实、Git 工作区、skill/插件文件、网页）。从画布上任意节点出发，沿 Evidence 链可回溯到原始内容——这是既有设计，追溯前提将它升级为**硬性验收项**：不允许存在无 Evidence 的可查询记录（agent_spec 与 view_state 两类元数据工件除外，它们自身就是源头）。

**"能删除记录"**：两级删除语义（2026-08-30 用户拍板）：

| 用户级动词 | 底层机制 | 可复原？ | 作用范围 |
|---|---|---|---|
| **归档（Archive）** | 墓碑（tombstone） | 是（撤销墓碑即重现，操作留痕） | Histos 全部查询与投影层；JSONL 原文保留 |
| **抹除（Erase/Purge）** | 物理清除 | 否（显式确认，不可逆） | 记录级：sqlite 行 + 工件文件；会话级：整会话 JSONL 文件（复用 `deleteSession`） |

**墓碑 schema**（通用表，一次 join 过滤所有查询）：

```sql
CREATE TABLE IF NOT EXISTS tombstones (
  id TEXT PRIMARY KEY,          -- 墓碑自身 id（8-hex）
  target_kind TEXT NOT NULL,    -- 'triple' | 'node' | 'edge' | 'artifact' | 'session_index'
  target_id TEXT NOT NULL,      -- 被删对象的 id（triple id / nodeRevisionId / artifact sha256 / ...）
  reason TEXT,                  -- 用户可选的删除理由（≤512 字符）
  created_at INTEGER NOT NULL,
  revoked_at INTEGER            -- 非空 = 已撤销（复原）
);
CREATE INDEX IF NOT EXISTS tombstones_target_lookup ON tombstones (target_kind, target_id);
```

规则：
- 墓碑只作用于 **Histos 索引与投影层**（sqlite 行在查询中被过滤、工件不再被引用），**JSONL 原文永不因归档而改动**。
- 归档一个"被用过"的工件（被某 ContextSet 引用的 GraphRevision）→ 允许，但引用方需显示"部分证据已归档"标记，不可静默丢弃。
- **JSONL 单行永不重写**（保 Pi entry 的 parentId 链完整）。会话级彻底删除复用既有 `omega:deleteSession`（整文件删除，已含路径包含校验）。
- `rebuild` 重建索引时**重放墓碑表**：重建后的库自动继承归档状态。
- 抹除（purge）是唯一物理删除：记录级清 `fact_triples`/`node_revisions`/`edge_revisions` 行与对应工件文件，并写一条 `purge` 账目事实（抹除这件事本身留痕，但内容不可恢复）；敏感内容若在 JSONL 原文中，抹除会提示"该记录原文属于会话 X，彻底删除请删除该会话"。

### 2.2 时间可追溯：能复原，也能删除时间上的记录

两个内置能力（2026-08-30 用户确认）：

1. **撤销墓碑**：归档可逆，撤销操作本身写入账目（谁、何时、撤销了哪条墓碑）。被"删除时间记录"的时间线事件，其墓碑仍可查——审计链完整。
2. **asOf 时间旅行查询**：`fact_triples` 已有 `validFrom/validUntil` 时间窗与 `asOf` 过滤；扩展到节点/边投影（`node_revisions.created_at` + revision_parents DAG 已具备数据基础），支持"查看任意时点的 Histos 状态"。参照：deepseek-harness 的 `deriveMessages()` 投影、`histos-web-source.js` 的 revision 链。

明确不做：整库时点回滚（工件不可变使其大部分等效于 asOf 查询；真回滚反而会丢墓碑历史）。

### 2.3 与核心不变量的关系

- append-only 不破坏：墓碑是行、撤销是更新、账目事实只增。
- `SQLite = rebuild(facts, Git, skills, durable artifacts)` 重建等式保持：重建 = 重扫源 + 重放墓碑表。
- 审批 fail-closed 不受影响：审批账目事实不可归档、不可抹除（安全审计底线）；purge 整会话时随会话一起消失，但抹除动作本身有账目。
- 单写者不变：墓碑/抹除只发生在 Histos 索引层与工件层，`session-facts.js` 仍是 JSONL 唯一写者。

---

## 3. 实现路线图

排序原则：横切 schema 能力先行（避免后迁表）；每个工作项标注借鉴来源与诚实验收标准（契约存在 ≠ 生产接入，遵守 `ravel-agent-completeness-baseline` 的完成判定诚实原则）。

### P0 追溯层（空间 + 时间可追溯）

- **工作项**：
  1. `tombstones` 表并入 `histos-schema.js`（含索引与校验）
  2. `histos-engine.js`：`archiveEntries(kind, ids, reason)` / `restoreEntries(tombstoneIds)` / `purgeEntries(kind, ids)`；全部查询（graphRows/queryFacts/getNode/suggest）join 墓碑过滤
  3. `rebuild` 重放墓碑表
  4. IPC：`omega:histosArchive` / `omega:histosRestore` / `omega:histosPurge`（preload 校验 + registry 同步 + 事件总线广播 `on_entries_archived` / `on_entries_restored` / `on_entries_purged`）
  5. purge 写 `purge` 账目事实；审批/安全类账目事实拒绝归档
  6. asOf：`queryFacts` 已有；节点/边投影的 asOf 参数（按 `created_at` + parents DAG 过滤）
- **借鉴来源**：oh-my-pi Mnemopi `forget()`（删除语义先例）、prime-agent `/refine` delete action（结构化删除 + reason）、`histos-web-source.js` revision 链（时间窗模式已在库内）
- **验收**：归档后所有查询/图投影/suggest 不可见；撤销后重现且账目可查；purge 后行物理消失且账目留痕；`rebuild` 后墓碑仍生效；审批事实归档被拒；asOf 查询返回历史时点状态；全部有测试覆盖。

### P1 `config_changed` 事实（配置类接入）

- **工作项**：`session-facts.js` 新增 `config_changed` 事实类型（`domain`：resource/permission/trust/mcp/mode/provider/profile + `action`: create/update/delete + `id` + `reason`）；资源中心、权限规则、信任决策、MCP 管理、模式切换、provider 配置六个写入点接 fact；派生投影（`histos-fact-derivation.js`）加映射；Fact Graph 可查"配置变更史"。
- **借鉴来源**：kilocode 分层配置（位置作用域）、deepseek-harness patch 分层 + `--dump-config`（生效视图即投影）
- **验收**：六个写入点均落事实；重启后从 JSONL 可重建配置变更时间线；Fact Graph triple 覆盖全部 domain。

### P2 Fact Graph 表面 UI

- **工作项**：Histos Inspector 增加"事实"页签（triple 列表 + 按谓词/时间/来源过滤）；工具栏显示 triple 统计；归档/抹除的右键入口（P0 能力首次暴露给用户）。
- **借鉴来源**：hermes SessionDB FTS5 搜索交互（跨会话事实检索的 UI 模式）
- **验收**：e2e 中从图上节点查到关联 triples；归档一条 triple 后画布/列表即时消失且可撤销。

### P3 策略类共创循环

- **工作项**：模式/编排/工作流统一"基础示例 → Histos 内对话生成配置草案 → schema/权限/预算校验 → 人审批准 → 落 agent_spec 工件（新 revision）→ 实例化运行"。
- **借鉴来源**：prime-agent `/refine` 四桶 + before/after 快照、opencode 自然语言合成 agent、kilocode 五内置 agent 模板
- **验收**：用户在 Histos 对话中描述新编排 → 生成草案 → 批准后出现在 agent_spec 图上且可 `invokeNode` 规划；未经批准的草案不可运行。

### P4 repo source 适配器（项目理解类）

- **工作项**：`histos-repo-source.js`——纯文本启发式扫描（目录结构 + import/require 解析 + README/docs 抽取 + 语言检测）→ 文件/模块节点 + 依赖边 → 可选 condense 蒸馏模块摘要 → 工件；`nodeId = workspaceId + 相对路径`，内容 hash 变更出新 revision。
- **借鉴来源**：`histos-web-source.js` 的 contentSha256 + `linkNodeRevisionParents` 模式直接照搬（nodeId 从 URL 换成文件路径）；kilocode System Context 的 baseline + 增量模型；oh-my-pi pi-walker 的缓存键设计（`(root, options)` + TTL）作后续优化参照
- **验收**：clone 一个项目 → 索引后画布出现模块地图；修改文件重扫 → 变更文件出新 revision 且旧版可查；模块摘要可冻结成 ContextSet 附加到新会话。

### P5 观测与其余

- `diagnostic_observed` 事实（文件 × 严重度 × 时间 → Fact Graph，参照 omp diagnostics ledger 的 absPath 去重）；`fact_triples` FTS5 全文索引（参照 hermes）；GoalState 接 worker 主流程（契约已在 `goal-state.js`）；费用 usage triple。

---

## 4. 文档关系

| 文档 | 角色 |
|---|---|
| 本文 | 信息架构 + 追溯模型 + 路线图（设计定稿） |
| `ravel-histos-next-cycle.md` | 当前实现状态快照（每轮实现后更新） |
| `ravel-feature-inventory.md` | 功能全景 + 接入状态清单 |
| `ravel-core-design-and-next-slices.md` | 产品不变量（规范，优先级最高） |
| `ravel-history-archive.md` | R0–R5 / S2–S4 / 借鉴决策的历史骨架 |
