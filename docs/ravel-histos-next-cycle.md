# Ravel × Histos 下一周期

更新日期：2026-08-28
状态：**当前执行入口。** 本文冻结接入契约，并只排本周期切片。R0–R5 验收仍认 [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md)。产品不变量仍认 [`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md)；冲突时以核心设计为准，但核心设计 §1「记忆」行以本文勘误为准。

没有备选架构。不换壳、不换 JSONL、不换 Pi 运行时、不新增第二套审批库、本周期不新增 artifact kind。

---

## 0. 一句话

Ravel 先是一个不依赖画布也能干活的编码 Agent。Histos 是同一套事实之上的记忆、图和受控编排层：会话自动入库，资源由用户触发，跨工作区只搬运已经 freeze 的 ContextSet。

```text
编码热路径（无 Histos 也必须通）
  prompt → 工具 → 审批事实 → JSONL → Git / PTY / MCP
                    │
                    ▼ 只消费，不阻断
Histos（记忆 / 图 / 剖面）
  SourceSet + Lens + 预算
    → GraphRevision / ContextSet / FlowRevision / ViewState
    → 建议草稿 → 人审 freeze → context_attached
    → Convert → Validate → Approval → Pi
```

杀掉 Histos utilityProcess 时：读、改、跑、审批、commit 仍可用；画布、检索、Convert to Flow 进入诊断。不另做一套记忆产品。

---

## 1. 冻结决策

| 决策 | 选择 |
|---|---|
| 文档职责 | 先冻结接入契约，再只排本周期切片 |
| Agent 完整性 | 无 Histos 也必须能完成编码任务；Plan 先是会话能力 |
| Histos 角色 | 记忆 / 图 / 受控编排，不是执行前提 |
| 入库边界 | 每个用户发起的持久动作产生 fact 或工件；时间线、画布、遥测是可丢弃投影 |
| 会话 | 强制结构透镜；语义透镜按预算批量 |
| 资源 / skill / 插件 | 资源中心由用户触发；产出 GraphRevision + 可选 ContextSet 草稿；默认不执行 |
| 图形态 | 同一工件家族 + 处理剖面，不新开数据库 |
| 工件种类 | 本周期不新增 kind。计划 = 带剖面的 GraphRevision |
| 同工作区记忆 | durable 工件可检索；开会话最多给建议性 ContextSet 草稿；人审 freeze 才 `context_attached` |
| 跨工作区记忆 | 源工作区先 freeze ContextSet；当前会话再过一遍预算；禁止静默注入原文 |
| 语义端口 | 本周期接通生产 `semanticProvider`；默认用工作区对话模型；以后可拆 |
| 模式 | 冻结 `ModeProfile`；本周期只交货 Plan；Goal 等占稳定 id，未接线时按无 Histos 会话模式跑 |
| 本周期包 | 包 A（见 §4）；嵌套 Sub Flow、定时 Flow、每工具 override、分享/导入、PR 面板、结构化 diff 推迟 |

勘误：核心设计「先不设计跨项目记忆」不再读成「Histos 不做记忆」。正确读法是：**不另做记忆产品；记忆就是 Histos。** 同工作区默认可检索、可建议。跨工作区不是禁区，但只能显式搬运已 freeze 的 ContextSet，禁止把外库原文灌进当前 prompt。

---

## 2. 两条回路，不得焊死

### 2.1 编码 Agent 回路（热路径）

权威：Pi JSONL + Git 工作区 + skill / 插件 / `mcp.json` 文件。桌面唯一事实写者仍是 `session-facts.js`。

必须在无 Histos 时可用：

- 会话 CRUD、fork/clone/navigate、压缩、恢复
- 七个编码工具 + MCP stdio 桥（走既有审批）
- 四档权限、Project Trust、成对审批事实
- Git 快照 / commit / worktree、shadow-git checkpoint
- 隔离 PTY、资源中心本地安装
- Plan 模式（只读探索 → 人审 → 执行）

Histos 失败、未凝练、用户从不打开画布，都不得阻断这条回路。

### 2.2 Histos 回路（派生）

权威不在 sqlite，也不在画布。

```text
SQLite = rebuild(JSONL facts, Git workspace, skill/plugin files, durable artifacts)
```

Engine 失败进入诊断，不得回滚已追加的 JSONL。语义图不能执行。要跑必须 Convert → Validate → Approval → Pi。

---

## 3. 接入契约

凡是用户能指出「当时发生了什么」的持久对象，必须能回到 FactAddress。凡是纯展示，必须能删掉重建。

### 3.1 进不进 Histos

| 对象 | 进事实层 | 进 Histos | 触发 |
|---|---|---|---|
| 用户 prompt / 助手回复 / 工具调用 | 是（JSONL） | 是 | 自动；每个 `operation_finished` 增量结构透镜 |
| 审批、压缩、导航、checkpoint | 是 | 结构索引引用已有 fact | 自动；不各自重跑 LLM |
| 文件变更 | Git 为权威 | 是，`sourceType=file` | 随会话操作；checkpoint 锚定 Git SHA |
| skill / 插件 / prompt 资源 | 文件 + content hash | 是 | **用户在资源中心触发** |
| MCP 配置 | `mcp.json` 即事实 | 是，`sourceType=mcp_config` | 配置变更可索引；工具调用仍走审批事实 |
| 会话遥测 / PTY 帧 / 布局宽度 | 否 | 否 | 投影或 UI 态。用量面板可读 Pi usage，不写 Histos |
| Activity 清除签名 | 否 | 否 | localStorage |

禁止：

- 把 sqlite 当原文
- 把画布手势直接当执行
- 无用户动作把 A 工作区内容送进 B 工作区 prompt
- 语义失败时写没有 evidence 的假节点
- 为 Plan/Goal/记忆再开第二套存储

本周期不扩展 `FACT_SOURCE_TYPES` 闭集。现有 12 类足够覆盖会话、文件、skill、MCP、checkpoint 和三类工件。缺的是剖面和触发，不是新 sourceType。

### 3.2 处理剖面

同一套 `GraphRevision` / `ContextSet` / `FlowRevision` / `ViewState`。差别在 SourceSet、Lens、预算、是否跑 LLM。

| 剖面 id | 输入 | Lens | LLM | 产出 | 触发 |
|---|---|---|---|---|---|
| `session.structural` | 当前会话 facts | 结构，确定性 | 否 | GraphRevision（结构） | 每个 `operation_finished` |
| `session.semantic` | 结构图 + 选定 evidence | 语义 | 是，按预算 | GraphRevision（语义） | 批量 job；失败 `semantic_provider_unavailable` |
| `resource.distill` | 用户选中的 skill/插件原文 | 语义，证据指向文件 | 是，按预算 | GraphRevision + 可选 ContextSet 草稿 | 资源中心显式动作 |
| `memory.suggest` | 本工作区 durable 工件 | 检索，不直接注入 | 可选 | 建议性 ContextSet 草稿 | 开会话或用户检索 |
| `memory.freeze` | 草稿或选择集 | 预算裁剪 | 否（确定性） | ContextSet + `context_attached` | 人审确认 |
| `memory.import` | 外工作区已 freeze 的 ContextSet hash | 再预算一次 | 否 | 当前会话 `context_attached` 或 `budget_exceeded` | 用户显式挂入 |
| `plan.explore` | 只读探索会话 | 结构；语义按预算 | 可选 | 带 `plan` 剖面的 GraphRevision | Plan 模式结束且 Histos 可用 |
| `flow.convert` | 任一可执行 GraphRevision | Validate | 否 | FlowRevision | 用户 Convert；无 Histos 则入口不可用，不阻断普通 prompt |

检验：新内容只新增剖面，不新增索引库。剖面未接线时，对应入口要么不出现，要么按无 Histos 会话能力降级，禁止报假成功。

### 3.3 ModeProfile

模式是会话策略，不是第二运行时。本周期冻结契约，只交货 `plan`。

```text
ModeProfile {
  id            稳定 id：plan | goal | ...
  title         显示名
  writeAccess   read-only | workspace-only | ask-before-command
  tools         允许的工具名闭集；未知工具仍 untrusted
  budget        轮次 / token 硬帽（可空，空则用会话默认）
  completion    human-review | evidence | round-cap
  histosProfile 可选：plan.explore | session.semantic | flow.convert
}
```

行为：

- 无 Histos：`plan` 仍必须能只读探索、出可审计划、人审后切到执行。计划正文落在会话 JSONL，不依赖画布。
- 有 Histos：同一次 Plan 额外跑 `plan.explore`，产出带 evidence 的 GraphRevision。批准后可 Convert；不 Convert 也能按会话计划执行。
- `goal` 本周期只占 id。调用未接线剖面时按普通会话跑，UI 标明未接入，不假装实据续跑已完成。
- 以后新增模式 = 新增 profile 记录 + 剖面绑定，不新增 artifact kind，不做模式 IDE。

### 3.4 记忆

记忆不是独立子系统。可召回的只有 durable 工件和它们指向的 FactAddress。

同工作区：

1. 检索语料 = 本工作区 GraphRevision、用户处理过的 skill 图、已冻 ContextSet。
2. 开会话最多生成**建议性 ContextSet 草稿**。
3. 人审 freeze 后才写 `context_attached`。
4. 无命中、检索失败、provider 不可用：如实显示，不静默注入。

检索命中 ≠ 已进入上下文。进入上下文的唯一写操作是 freeze。

### 3.5 跨工作区

外工作区磁盘受 path containment 限制，禁止为了记忆去读对方仓库。

跨库最小单位是源工作区已经 freeze、已经裁过的 ContextSet（或其 SHA-256）。流程：

```text
源工作区 freeze ContextSet
  → 用户按 hash 挂入当前会话
  → 当前会话再跑一遍 freeze 预算
  → 通过则 context_attached
  → 超窗则 budget_exceeded，不自动再扩、不回落到原文全量
```

当前 prompt 只增长「一个已预算的包」。解析失败的 FactAddress 标 `missing`，不得静默补全文。

### 3.6 语义端口与失败

- Provider：工作区当前默认对话模型。未配置则整个语义 job 失败。
- 硬帽：沿用现有 Engine 上限（128 节点 / 32k 字符量级）。超帽不写工件。
- 不可用：返回 `semantic_provider_unavailable`，结构透镜不受牵连。
- 禁止用本地小模型顶上，禁止静默降级成乱写节点。
- 本周期不做凝练 eval 产品化；会话用量继续走现有遥测面板。

### 3.7 checkpoint

`createCheckpoint` 在 `git update-ref` 之后必须 `rev-parse --verify`（或等价）确认 ref 存在。exit 0 但 ref 不在 = 失败，不得把假 checkpoint 写进 facts 当成功。这是热路径健康，不是 Histos 功能，但本周期 P0。

---

## 4. 本周期切片（包 A）

一次只推进下表顺序。前一项的验收不过，后一项不得假装完成。

| 切片 | 内容 | 无 Histos | 有 Histos | 验收 |
|---|---|---|---|---|
| **N0** | checkpoint fail-closed 后置校验 | 必须 | 无关 | update-ref 成功但 ref 缺失时 API 失败；相关测试在当前 Git 下绿 |
| **N1** | 生产 `semanticProvider` 接入 Histos worker | 会话不依赖它 | 语义剖面可跑 | 配置了默认模型则可凝练；未配置返回 `semantic_provider_unavailable`，无假节点 |
| **N2** | `session.structural`：每个 `operation_finished` 增量更新 | JSONL 仍完整 | 画布结构图随操作增长 | Engine 挂了不阻断 prompt；重连后可从 facts 补投影 |
| **N3** | `ModeProfile` 契约 + `plan` 会话模式 | Plan 可只读探索、人审、执行 | 可选 `plan.explore` 投影 | 无画布也能 Plan；Goal id 存在但标明未接线 |
| **N4** | `resource.distill` | 资源仍可安装/编辑 | 用户触发后得到 GraphRevision + 可选草稿 | 默认不执行；Convert 仍走 Validate + 审批 |
| **N5** | `memory.suggest` + `memory.freeze` | prompt 不自动塞旧图 | 建议草稿 → 人审 → `context_attached` | 无命中可见；未 freeze 的检索结果不进模型 |
| **N6** | `memory.import` | 不读外库磁盘 | 只接受外库 ContextSet hash，再预算一次 | 超窗 `budget_exceeded`；missing evidence 可见 |

N2 可与 N1 并行准备，但语义剖面不得在 N1 验收前对用户宣称可用。N3 不得做成画布专用假面板。

---

## 5. 明确推迟

本周期不做，也不在本文验收：

- 交互式嵌套 Sub Flow UI、超窗收缩 UX 的完整 Composer 引导
- GraphRevision 结构化 diff / 时间轴回放
- 定时 / 事件 Flow、无人值守预授权
- 每工具 `allow/prompt/deny` override、档位热切换 UX
- 加密分享、竞品会话导入、PR/gh 面板
- Goal 实据续跑、模式可视化编辑器
- 凝练 eval 回归、crashReporter 上传、跨工作区静默同步

这些仍可在差距分析里当候选项。要做时必须走本文剖面，不另起权威。

---

## 6. 验收口诀

1. 停掉 Histos worker，仍能打开工作区、发 prompt、跑工具、审批、commit。
2. 打开 Histos，最近一次会话操作在结构图上有对应节点，且节点能跳回 transcript。
3. 未配置模型时语义凝练失败可见，sqlite 里没有无 evidence 的语义节点。
4. 资源中心处理 skill 得到可寻址 GraphRevision；不点 Convert、不经过审批，就不能改仓库。
5. 新会话可以出现记忆建议；不点 freeze，模型上下文里没有那份草稿。
6. 跨工作区只能贴 ContextSet hash；贴外库路径或未 freeze 的 GraphRevision 必须拒绝。
7. checkpoint 在当前 PortableGit 下不能再「exit 0 但 ref 不存在还报成功」。

---

## 7. 文档关系

| 文档 | 本周期地位 |
|---|---|
| [`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md) | 不变量仍有效；记忆行见本文勘误 |
| [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md) | R0–R5 / 锁定栈档案，已完成 |
| [`ravel-roadmap.md`](./ravel-roadmap.md) | 未完成工作索引；执行顺序改认本文 |
| [`ravel-design-activity-session-reference-mcp.md`](./ravel-design-activity-session-reference-mcp.md) | S2–S4 已完成档案 |
| [`ravel-release.md`](./ravel-release.md) | 发布策略，未改 |
| [`.workbuddy/artifacts/histos-gap-analysis-2026-08-28.md`](../.workbuddy/artifacts/histos-gap-analysis-2026-08-28.md) | 竞品调研有效；路线以本文为准 |
| [`.workbuddy/artifacts/agent-doc-evidence-2026-08-28.md`](../.workbuddy/artifacts/agent-doc-evidence-2026-08-28.md) | 竞品证据台账，不是实施计划 |
