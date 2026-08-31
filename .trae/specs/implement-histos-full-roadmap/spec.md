# Ravel × Histos 全路线执行规范（P0–P8 完整周期 + 质量门禁 + 长期遗留）

change-id: `implement-histos-full-roadmap`
编写日期：2026-08-30
执行依据（优先级从高到低）：
1. `docs/ravel-core-design-and-next-slices.md`——产品不变量（冲突时以它为准）
2. `docs/ravel-histos-design-and-roadmap.md` §1–§3——信息架构 + 追溯模型 + P0–P8 路线图（设计定稿）
3. `docs/ravel-histos-next-cycle.md` §5——当前周期切片级计划（P0 T0.1–T0.6）+ §5.3 长期遗留
4. `docs/ravel-feature-inventory.md`——功能缺口清单（§6/§7/§12 的未投影/未实现项）

代码基线：`main` @ `2c75a12f5`。已验证代码现状：tombstone / archiveEntries / restoreEntries / purgeEntries / purge_record / asOf 节点投影 / config_changed 事实 / histos-repo-source / Fact Graph 表面 UI 全部零存在；`histosQueryFacts` 通道、事件总线（17 事件）、`HistosSurface` 组件树、`agent-bridge.js` TOOLS 注册、`mode-profiles.js` 模式契约均已就位（接口就绪，供后续周期接线）。

本规范取代 `.trae/specs/p0-traceability-cycle/`（单周期版本），覆盖 **完整路线**：P0 追溯 → P1 配置事实 → P2 表面 UI → P3 策略共创 → P4 repo source → P5 观测 → P6 图会话与压缩统一 → P7 能力流程与项目知识 → P8 成果与 handoff，外加两个活跃质量门禁阻塞与长期遗留项。P1–P8 每周期开工时按本规范细化到切片级（沿用 next-cycle §5 的模式），本规范锁定各周期的目标、落点、验收与依赖。

## Why

1. **追溯是横切前提**：删除语义（归档/抹除）与 asOf 优先于一切功能开发（design-and-roadmap §2 原文），P1–P8 全部周期都建立在 P0 之上。
2. **路线图已定稿但零实施**：P0–P8 覆盖内容分类学六大类（记忆/能力/策略/成果/账目与观测/配置）全部子类的规划已经用户逐轮确认收敛（2026-08-30），设计定稿，只差按序实施。用户明确要求完整规范而非单阶段。
3. **诚实基线被阻塞**：当前 `npm test --workspace=@ravel/desktop` 为 442 tests / 439 pass / **3 fail**（PortableGit checkpoint）；根 `npm run check` 被 `packages/ai` 11 个基线 TS 错误阻塞。全路线开工前必须恢复全绿。

## What Changes（按周期）

### Phase 0 = P0 追溯层 + 质量门禁（当前执行周期）
- **T0.1** `tombstones` 表 + `tombstones_target_lookup` 索引并入 `histos-schema.js`（`IF NOT EXISTS` 旧库自动补表 + `validateHistosSchema()` 校验）
- **T0.2** 引擎归档/复原：`archiveEntries(kind, ids, reason)` / `restoreEntries(tombstoneIds)`；四条读路径（`graphRows`/`queryFacts`/`getNode`/`suggestContext`）join 墓碑过滤；`kind='approval'` 节点及关联 triple 拒绝归档
- **T0.3** `rebuild` 重放墓碑表（临时库 → swap 路径中搬运）
- **T0.4** 抹除：`purgeEntries(kind, ids)` 物理删行 + 工件文件删除；`purge_record` 账目事实经 main 转发 agent worker 由 `session-facts.js` 单写者落 JSONL（参照 `appendFlowTriggerFact` 模式）；整会级抹除复用 `omega:deleteSession`
- **T0.5** IPC 三通道 `omega:histos{Archive,Restore,Purge}` + 事件 `on_entries_archived/restored/purged`（六方同步：`ipc-schemas.js`/`main.js`/`preload.js`/`ipc-registry.js`/`src/shared/ipc-contracts.ts`/`src/renderer/types/dto.ts`+`src/renderer/ipc/client.ts`，参照 `histosQueryFacts` 形态）
- **T0.6** asOf 节点/边投影：`graphRows` 按 `created_at` + `revision_parents` DAG 过滤；`histosGetGraph` 可选 `asOf`
- **门禁修复**：3 个 PortableGit checkpoint 失败测试；`packages/ai` 11 个基线 TS 错误（cloudflare-ai-gateway 流类型 + kimi-k2.6 等 ModelId 注册）

### Phase 1 = P1 `config_changed` 事实（配置类接入，覆盖 feature-inventory §12 全部 7 项缺口）
- `session-facts.js` 新增 `config_changed` 事实类型：`domain`（resource/permission/trust/mcp/mode/provider/profile）+ `action`（create/update/delete）+ `id` + `reason`
- 六个写入点接 fact：资源中心（安装/卸载/启停/frontmatter）`resource-center.js`+`worker.mjs setSkillModelInvocation`、权限规则增删、Project Trust 决策、MCP 增删/启停/OAuth、模式切换 `mode-profiles.js` 切换动作、provider 配置
- `histos-fact-derivation.js` 加映射；Fact Graph 可查"配置变更史"
- `mcp_config` 节点投影接线（画布已认识该类型，投影未接）

### Phase 2 = P2 Fact Graph 表面 UI
- `HistosInspector.tsx` 增加"事实"页签：triple 列表 + 按谓词/时间/来源过滤
- `HistosToolbar.tsx` 显示 triple 统计（`histosFactStats`）
- 归档/抹除右键入口（P0 能力首次暴露给用户，调用 T0.5 三通道，消费 `on_entries_archived/restored/purged` 事件即时更新）

### Phase 3 = P3 策略共创循环
- 模式/编排/工作流统一生命周期：基础示例 → Histos 内对话生成配置草案 → schema/权限/预算校验 → 人审批准 → 落 `agent_spec` 工件（新 revision）→ 实例化运行
- 未经批准的草案不可运行（fail-closed）

### Phase 4 = P4 repo source 适配器（项目理解类）
- 新建 `electron/histos-repo-source.js`：纯文本启发式扫描（目录结构 + import/require 解析 + README/docs 抽取 + 语言检测）→ 文件/模块节点 + 依赖边 → 可选 condense 蒸馏模块摘要 → 工件
- `nodeId = workspaceId + 相对路径`，内容 hash 变更出新 revision（照搬 `histos-web-source.js` 的 contentSha256 + `linkNodeRevisionParents` 模式）

### Phase 5 = P5 观测与其余
- `diagnostic_observed` 事实（文件 × 严重度 × 时间 → Fact Graph，参照 omp diagnostics ledger 的 absPath 去重）
- `fact_triples` FTS5 全文索引（参照 hermes SessionDB）
- GoalState 接 worker 主流程（`goal-state.js` 契约就绪：`appendGoalStateFact` + `runAutonomousGate`）
- 费用 usage triple（token/耗时/估算成本字段保持显式缺失语义）

### Phase 6 = P6 图会话与编辑闭环（P3 的交互基座，可提前与 P2 并行）
- **选区会话**：图选区（`HistosSurface` selection）→ 注入选区上下文的会话；渐进式披露三层——L0 骨架（选区子图结构，默认注入，近零成本）、L1 凝练（condense/distill 产物，次级默认）、L2 原文（沿 FactAddress 含 span selector 按需提取，两条通道：LLM 经 `histos_expand` agent 工具主动拉取（预算上限，超限 fail-closed）；用户在 Inspector 点"展开原文"）
- 工作项：选区会话 prompt 构建器（L0+L1 默认注入）；`agent-bridge.js` TOOLS 注册 `histos_expand`（经 histos-host 调 engine，FactAddress 原文提取，预算上限）；Inspector"展开原文"（复用 `readFilePage` 式分页）；Histos 内对话式编辑 skill（新版本 → 人审 → 原子替换 → 新 revision 入图）；图选区直接生成 skill 草稿
- **会话压缩统一**：compaction 摘要嵌入被压缩范围的 FactAddress/节点 id 锚点（上下文从"摘要文本"升级为"摘要 + 可导航记忆指针"）；`histos_expand` 全会话生效；压缩前可选冻结重要子图为 ContextSet 工件（摘要引用工件 sha）

### Phase 7 = P7 能力运作流程视图 + 项目知识入图
- skill/extension/MCP 内容 → LLM 解析为结构化"触发条件 → 执行步骤 → 产出"工件；内容 hash 变更自动重解析出新 revision；画布能力节点挂流程视图（覆盖 feature-inventory §6"资源内容变更追踪未实现"缺口）
- 项目知识文件（AGENTS.md、`.ravel/` 规则、上下文源）版本化入图：版本链 + 生效范围 user/project + 蒸馏摘要

### Phase 8 = P8 成果浏览与会话交接
- 工件库面板：GraphRevision / 报告 / 导出 / Flow 实例的列表 + 预览 + Evidence 回溯原文 + 归档入口
- handoff 生成管线：把当前会话整理成交接文档，以 compaction entry 落盘，可冻结为 ContextSet；生成不与 compaction 竞态（busy 时明确拒绝）；交接文档可跨会话附加

### 长期遗留（不随 P 周期关闭，全路线全程跟踪）
1. capability/orchestration 生产接入边界决策（`skill-inject` / `orchestrator` 均 `wired: false`，durable memo 未形成持久协议）——**需用户显式决策，规范不自动接线**
2. 真实 provider、嵌套 Sub Flow 交互 UX、超窗收缩 UX、crashReporter 上传的独立验收（需显式外部环境，离线测试不得伪造成功）

**BREAKING**：无。SQLite 是可删索引（`IF NOT EXISTS` 自动补表）；IPC 仅新增通道；compaction 摘要锚点是新增字段；`packages/ai` 修复仅类型/注册不引入行为变化。

## Impact

- Affected specs（能力）：Histos 数据层（追溯模型、Fact Graph、投影）、IPC 表面（新增通道与事件）、Agent 事实写入（`purge_record` / `config_changed` / `diagnostic_observed` 类型）、Agent 工具集（`histos_expand`）、Renderer Histos 表面（Inspector/Toolbar/选区会话/工件库）、compaction 语义
- Affected code（核心落点，按周期）：
  - Phase 0：`electron/histos-schema.js`、`histos-engine.js`、`histos-worker.mjs`、`histos-host.js`、`main.js`、`session-facts.js`、`histos-event-bus.js`、六方 IPC 文件、`checkpoint-service` 相关、`packages/ai/src/providers/cloudflare-ai-gateway.ts` 等
  - Phase 1：`electron/session-facts.js`、`resource-center.js`、`worker.mjs`（setSkillModelInvocation 等）、`mode-profiles.js`、MCP 管理、信任决策、provider 配置模块、`electron/histos-fact-derivation.js`
  - Phase 2：`src/renderer/surfaces/histos/HistosInspector.tsx`、`HistosToolbar.tsx`、`HistosGraphWorkspace.tsx`（右键/选区）、`src/renderer/ipc/histos-client.ts`
  - Phase 3：`electron/histos-agent-spec.js`、`histos-capability.js`（`wired:false` 的边界保持，只加共创管线）、Inspector 对话栏
  - Phase 4：`electron/histos-repo-source.js`（新建）、`histos-engine.js`（source 注册）
  - Phase 5：`electron/histos-engine.js`（FTS5）、`goal-state.js`、`worker.mjs`、诊断来源模块
  - Phase 6：`electron/agent-bridge.js`（TOOLS）、`worker.mjs`（`histos_expand` 实现经 histos-host 调 engine）、`src/renderer/surfaces/histos/HistosSurface.tsx`、`useHistosGraphQuery.ts`、`HistosInspector.tsx`、compaction 入口（worker 侧）、`src/renderer/components/chat/Composer.tsx`（选区上下文注入链路）
  - Phase 7：skill/extension/MCP 内容解析模块（新建，参照 `histos-web-source.js` 模式）、项目知识入图模块
  - Phase 8：工件库面板组件（Histos 表面新增）、handoff 管线（参照 prime-agent SessionHandoff）
- 不触碰：用户未提交的工作区内容（`apps/ravel-desktop/.workbuddy/`、`apps/ravel-desktop/scripts/verify-packaged.mjs`、`ravel-ui-refresh/`）——不回滚、不修改、不提交

## 记忆勘误（记忆中过时内容以本规范与 docs 为准）

- 记忆"包 B B4–B8 推进中"已过时：B1–B8 均已交付（next-cycle §2.1），当前周期是 P0 追溯起步。
- 记忆"先不设计跨项目记忆"已由 core-design 勘误：记忆=Histos，同工作区可检索/可建议，跨工作区仅显式搬运已 freeze 的 ContextSet。
- 记忆/历史文档"244 项全绿"快照已过时：真实快照是 **442 tests：439 pass / 3 fail**（checkpoint-service PortableGit）。
- 记忆中"前端 redesign 琥珀工匠体系"为已交付状态（feature-inventory §11 主题已完成），不是本路线待办。

## ADDED Requirements

### Requirement: R1 墓碑表（P0/T0.1）
系统 SHALL 在 Histos schema 中提供 `tombstones` 通用表与 `tombstones_target_lookup` 索引，字段：`id TEXT PRIMARY KEY`（8-hex）、`target_kind TEXT NOT NULL`（'triple'|'node'|'edge'|'artifact'|'session_index'）、`target_id TEXT NOT NULL`、`reason TEXT`（≤512 字符）、`created_at INTEGER NOT NULL`、`revoked_at INTEGER`（非空=已撤销）。旧库重开 SHALL 经 `CREATE_SCHEMA_SQL` 的 `IF NOT EXISTS` 自动获得该表并被 `validateHistosSchema()` 校验通过。

#### Scenario: 新库建表与校验
- **WHEN** 初始化新工作区 Histos 库
- **THEN** 表与索引存在；`validateHistosSchema()` 通过；`HISTOS_TABLES` 导出含 `tombstones`

#### Scenario: 旧库自动补表
- **WHEN** 旧 schema 既有库重新打开
- **THEN** 自动创建表且既有数据完好；校验通过

### Requirement: R2 归档/复原引擎语义（P0/T0.2）
引擎 SHALL 提供 `archiveEntries(kind, ids, reason)` 与 `restoreEntries(tombstoneIds)`。归档后 `graphRows`/`queryFacts`/`getNode`/`suggestContext` 四条读路径 SHALL join 过滤（不可见，`revoked_at IS NULL` 才算已归档）；复原 SHALL 重现对象并写 `revoked_at` 留痕。`kind='approval'` 节点及其关联 triple SHALL 拒绝归档（fail-closed 抛错）。JSONL 原文 SHALL 永不因归档改动。

#### Scenario: 归档后不可见、复原后重现
- **WHEN** 归档对象后执行四类查询，再撤销墓碑
- **THEN** 归档期间不可见；复原后重现；`revoked_at` 非空可查

#### Scenario: 审批账目保护
- **WHEN** 尝试归档 approval 节点或其关联 triple
- **THEN** 拒绝并抛错；审批事实保持可见

### Requirement: R3 rebuild 重放墓碑（P0/T0.3）
`rebuild`（临时库 → swap）SHALL 搬运/重放墓碑表，重建后继承归档状态。

#### Scenario: 归档跨重建存活
- **WHEN** 归档 → rebuild → 查询
- **THEN** 对象仍不可见；墓碑在重建后库中存在

### Requirement: R4 抹除与账目（P0/T0.4）
引擎 SHALL 提供 `purgeEntries(kind, ids)`：物理删 `fact_triples`/`node_revisions`/`edge_revisions` 行与对应工件文件。每次 purge SHALL 经 main 转发 agent worker 调 `recordPurgeFact`，由 `session-facts.js` 以 `purge_record` 类型落 JSONL（单写者不变量）。整会级抹除 SHALL 复用 `omega:deleteSession`。审批账目 SHALL 不可单独抹除。

#### Scenario: 物理删除与账目留痕
- **WHEN** purge 一条 triple 及其工件
- **THEN** 行物理消失、工件文件删除；JSONL 落一条 `purge_record`；JSONL 内敏感内容给出"原文属于会话 X，彻底删除请删除该会话"提示

### Requirement: R5 IPC 三通道与事件（P0/T0.5）
系统 SHALL 新增 `omega:histosArchive`/`omega:histosRestore`/`omega:histosPurge` 三通道，六方同步，参照 `histosQueryFacts` 既有形态（ipc-schemas payload 校验 + registry allowlist + main sender 校验 + preload 双重校验）。归档/复原/抹除 SHALL 经事件总线广播 `on_entries_archived`/`on_entries_restored`/`on_entries_purged`，沿 worker → Main → renderer `histos:event` 推送。

#### Scenario: 六方一致与安全断言
- **WHEN** 通道注册完成
- **THEN** `histos-ipc.test.mjs` 与 `electron-security.test.mjs` 断言覆盖三通道（含 allowlist）；renderer 收到 `histos:event` 事件

### Requirement: R6 asOf 时间旅行（P0/T0.6）
`graphRows` SHALL 支持按 `created_at` + `revision_parents` DAG 过滤的 asOf 投影；`histosGetGraph` SHALL 接受可选 `asOf`；`fact_triples` asOf 行为 SHALL 保持不变。

#### Scenario: 历史时点查询
- **WHEN** 节点出新 revision 后以旧时点 asOf 查询
- **THEN** 仅返回旧版投影；不带 asOf 返回当前版

### Requirement: R7 配置变更事实（P1）
`session-facts.js` SHALL 新增 `config_changed` 事实类型（`domain`: resource/permission/trust/mcp/mode/provider/profile + `action`: create/update/delete + `id` + `reason`），走单写者路径。六个写入点（资源安装/卸载/启停/frontmatter、权限规则增删、Project Trust 决策、MCP 增删/启停/OAuth、模式切换、provider 配置变更）SHALL 落事实。`histos-fact-derivation.js` SHALL 加映射使 Fact Graph 可查配置变更史。`mcp_config` 投影 SHALL 接线。

#### Scenario: 六写入点落事实且可重建
- **WHEN** 任一写入点发生配置变更后重启
- **THEN** JSONL 含 `config_changed` 事实；从 JSONL 可重建配置变更时间线；Fact Graph triple 覆盖全部 domain

### Requirement: R8 Fact Graph 表面 UI（P2）
`HistosInspector` SHALL 提供"事实"页签（triple 列表 + 按谓词/时间/来源过滤）；`HistosToolbar` SHALL 显示 triple 统计；用户 SHALL 可从图节点查到关联 triples；归档/抹除 SHALL 有右键入口且操作后画布/列表即时消失、可撤销（消费 P0 事件即时更新）。

#### Scenario: e2e 图到事实到归档闭环
- **WHEN** e2e 中从图上节点查关联 triples 并归档一条 triple
- **THEN** 画布/列表即时消失且可撤销恢复

### Requirement: R9 策略共创循环（P3）
模式/编排/工作流 SHALL 走统一生命周期：基础示例 → Histos 内对话生成配置草案 → schema/权限/预算校验 → 人审批准 → 落 `agent_spec` 工件（新 revision）→ 实例化运行。未经批准的草案 SHALL 不可运行。

#### Scenario: 共创到运行
- **WHEN** 用户在 Histos 对话中描述新编排并批准
- **THEN** 生成草案 → 批准后出现在 agent_spec 图上且可 `invokeNode` 规划；未批准草案无运行入口

### Requirement: R10 repo source 适配器（P4）
系统 SHALL 提供 `histos-repo-source.js`：纯文本启发式扫描（目录结构 + import/require 解析 + README/docs 抽取 + 语言检测）产出文件/模块节点与依赖边；`nodeId = workspaceId + 相对路径`；内容 hash 变更出新 revision；可选 condense 蒸馏模块摘要并可冻结成 ContextSet。

#### Scenario: 索引与增量重扫
- **WHEN** clone 项目索引后修改文件重扫
- **THEN** 画布出现模块地图；变更文件出新 revision 且旧版可查；模块摘要可冻结成 ContextSet 附加到新会话

### Requirement: R11 观测与 GoalState 接线（P5）
系统 SHALL 提供 `diagnostic_observed` 事实（文件 × 严重度 × 时间 → Fact Graph，absPath 去重）；`fact_triples` SHALL 有 FTS5 全文索引；GoalState SHALL 接入 worker 主流程（`appendGoalStateFact` + `runAutonomousGate`）；费用 SHALL 以 usage triple 呈现（显式缺失语义保持）。

#### Scenario: 诊断可查且全文检索
- **WHEN** 诊断产生并在 Fact Graph 查询全文关键词
- **THEN** diagnostic triple 按 absPath 去重后可查；FTS5 命中；goal 续跑受 round-cap 预算约束

### Requirement: R12 选区会话与渐进式披露（P6）
图选区 SHALL 一键开启注入选区上下文的会话：L0 骨架默认注入（近零成本）、L1 凝练次级默认、L2 原文按需。LLM SHALL 可经 `histos_expand` agent 工具（注册进 `agent-bridge.js` TOOLS）拉取 span 级原文（预算上限，超限 fail-closed）；用户 SHALL 可在 Inspector 点"展开原文"。对话改 skill SHALL 产生新 revision 且旧版可回滚（经 P0 归档语义）；未批准草稿 SHALL 不落盘替换。

#### Scenario: 框选会话与 expand 预算
- **WHEN** 框选节点开会话（prompt 只含骨架+摘要）且 LLM 调 `histos_expand` 超预算
- **THEN** prompt 体积验证只含 L0+L1；expand fail-closed 并提示缩减选区；span 级原文可达

### Requirement: R13 会话压缩与记忆统一（P6）
compaction 摘要 SHALL 嵌入被压缩范围的 FactAddress/节点 id 锚点（摘要 + 可导航记忆指针）；`histos_expand` SHALL 全会话生效；压缩前 SHALL 可选冻结重要子图为 ContextSet 工件（摘要引用工件 sha）。压缩全程 SHALL 不破坏 FactAddress 回溯。

#### Scenario: 压缩后可取回细节
- **WHEN** compaction 后 LLM 需要早期细节
- **THEN** 经 expand 按锚点取回具体原文；锚点 id 在图中真实存在；压缩前后 token 占用可见对比

### Requirement: R14 能力运作流程与项目知识（P7）
skill/extension/MCP 内容 SHALL 被解析为结构化"触发条件 → 执行步骤 → 产出"工件；内容 hash 变更 SHALL 自动重解析出新 revision；画布能力节点 SHALL 挂流程视图。项目知识文件（AGENTS.md、`.ravel/` 规则、上下文源）SHALL 版本化入图（版本链 + 生效范围 + 蒸馏摘要）。全部 SHALL 可归档（P0 语义）。

#### Scenario: skill 变更出新流程 revision
- **WHEN** skill 内容变更后
- **THEN** 其运作流程工件出新 revision；AGENTS.md 修改可查历史版本与生效范围

### Requirement: R15 成果浏览与 handoff（P8）
工件库面板 SHALL 列出/预览/回溯（Evidence）任意工件（GraphRevision/报告/导出/Flow 实例）并提供归档入口。handoff SHALL 把当前会话整理成交接文档以 compaction entry 落盘，可冻结为 ContextSet 跨会话附加；生成 SHALL 不与 compaction 竞态（busy 时明确拒绝）。

#### Scenario: 工件回溯与防竞态 handoff
- **WHEN** 在工件库预览工件并触发 handoff 于 compaction busy 时
- **THEN** 可沿 Evidence 回溯原文；handoff 被明确拒绝；交接文档可跨会话附加

### Requirement: R16 质量门禁全绿（Phase 0 收口）
实施完成后 SHALL 满足：`npm run build:offline`、`npm run --workspace=@ravel/desktop typecheck`、`typecheck:renderer`、`npm test --workspace=@ravel/desktop`（0 fail，含修复 3 个 PortableGit checkpoint 失败且保留事后 `rev-parse --verify` 与 fail-closed）、根 `npm run check`（含 `packages/ai` `tsc --noEmit` 0 错误）、`git diff --check` 全部通过；离线测试不得伪造成功。

#### Scenario: 全绿快照
- **WHEN** 运行完整验证序列
- **THEN** 全部通过且结果如实记录（外部环境依赖项单独注明）

### Requirement: R17 长期遗留独立验收（诚实边界）
`skill-inject`/`orchestrator`（均 `wired: false`）与 durable memo 的生产接入边界 SHALL 由用户显式决策后另立规范，本路线不自动接线。真实 provider、嵌套 Sub Flow 交互 UX、超窗收缩 UX、crashReporter 上传 SHALL 保持"未完成"标注直至独立验收通过。

#### Scenario: 诚实口径保持
- **WHEN** 任何周期收口写文档
- **THEN** relay/dry-run/fake runner/接口存在/测试通过均不被写成生产接入；遗留项状态原样保留

### Requirement: R18 文档单一入口同步（每周期收口）
每周期收口 SHALL 更新 `docs/ravel-histos-next-cycle.md`（HEAD、测试计数、已完成切片、移除已关闭遗留项）与 `docs/ravel-feature-inventory.md` 对应状态；不复制旧路线图，不新建平行状态文档。

## 不变量与禁止事项（全路线全程有效）

1. `session-facts.js` 是 JSONL 唯一写者；墓碑/抹除/配置事实只经单写者路径；Histos Engine 可读 facts 不写 facts。
2. JSONL 单行永不重写；审批账目事实不可归档、不可单独抹除。
3. `SQLite = rebuild(JSONL facts, Git workspace, skill files, durable artifacts)` 重建等式保持：rebuild = 重扫源 + 重放墓碑。
4. renderer 不直接访问 fs/Git/凭据/SQLite/node-pty/Pi SDK；IPC 走 allowlist + sender 校验 + preload 双重校验。
5. 一切审批/删除/越权操作 fail-closed：失败路径拒绝放行，不静默降级。
6. 语义图不能执行：Convert → Validate → Approval → Pi 管线不变；未批准草案不可运行。
7. 凭据明文永不入 Histos；易变运行时状态只入事件流。
8. 完成判定诚实：契约存在 ≠ 生产接入；不为 `skill-inject`/`orchestrator`/memo "顺手接线"。
9. 借鉴边界：pi 基座（omp/prime）可直接携码；kilocode/opencode 取设计；永久不抄：HTTP agent server、第二权威（第二套 transcript/审批库/runtime）、云沙箱、computer use、图数据库、Monaco 节点内编辑、Radix 双轨。
10. 每周期开工时将切片细化进 next-cycle §5 后再实施；周期完成即更新状态文档——不抄近路。

## 范围外（本规范不做，防范围漂移）

- 明确不做区（feature-inventory §13 + core-design §2.7）：Neo4j/ArangoDB 图数据库、第二套 agent runtime、云沙箱、computer use、MCP 网络传输、Radix 双轨、Monaco 节点内编辑、Canvas 2D 远景层、协作/CRDT、语音输入
- 发布流水线（签名/公证/GitHub Release 上传）：遵循 `ravel-release.md`，开发未完成前不发安装包
- `skill-inject`/`orchestrator`/durable memo 生产接线：需用户决策（R17）
- 真实 provider/网络验收：需显式外部环境，单独记录
- 用户未提交的工作区内容（`ravel-ui-refresh/`、`.workbuddy/`、`verify-packaged.mjs`）
