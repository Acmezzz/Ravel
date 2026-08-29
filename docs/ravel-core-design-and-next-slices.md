# Ravel 核心设计

更新日期：2026-08-28
状态：**不变量仍有效。** 下一刀执行认 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)。铬件换栈、R0–R5 数据契约仍见 [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md)。

**记忆勘误：** §1「先不设计跨项目记忆」不再读成「不做记忆」。记忆就是 Histos：同工作区默认可检索、可建议；跨工作区只能显式搬运已 freeze 的 ContextSet。不另做记忆产品。

本文只记录已经拍板的产品不变量。冲突时以本文为准（记忆行以 next-cycle 勘误为准）。

切片 0 / 1 与 Histos R0–R5 已在 `feat/histos-r2-renderer-migration` 落地。本文不再把画布、切分器、sqlite 写成「下一刀才允许」。R5 hang-fix（H0）与锁定栈 T1–T5 亦已提交。下一刀是剩余产品深度缺口，不是重开不变量。

对标过 Codex Desktop、Claude Desktop / Cowork / Code、Hermes Desktop，以及 `D:\project\agent\omega\example\` 下五个项目。借鉴的是不变量和编码工作台表面，不是换架构。

---

## 1. 产品定位

| 决策 | 选择 |
|---|---|
| 第一用户 | 本地专业开发者：多仓库、Git、worktree、会话树、权限 |
| 主轴 | 赢本地编码工作台的完成度、控制感、可恢复性 |
| 第二约束 | Claude 式信任：默认不乱写、拒绝必须可见、失败不能放行 |
| 不做 | Codex 云账号 / 云任务 / 手机遥控；Cowork 非开发者文件夹代理 |
| Agent 边界 | 编码 Agent：仓库、命令、编辑、Git、会话、扩展 |
| 后续口子 | computer use、系统应用、浏览器操作、定时任务 |
| 信任模型 | Electron 隔离 + `workspace-only` / `ask-before-command` + 事后 Git Review |
| 不宣称 | OS / 容器 / VM 沙箱。Docker、WSL、VM 是更后阶段 |
| 记忆 | 先不设计跨项目记忆。现有 journal 磁盘当备份留着，不在产品里运营 |
| 架构 | 保持 Electron Main → utilityProcess Worker → preload → React。权威源是 Pi JSONL + Git 工作区 + skill/插件文件 |

DeepSeek 的 Cordis「一切皆插件」只作组织原则的例子：边界清楚、可组合。Ravel 的对应物不是插件内核，而是**一切可寻址事实，关系是派生索引**。

---

## 2. 核心设计

思想：一切皆可成网络。三层必须分清权威，不能把摘要、画布或索引当成真相。

### 2.1 事实层（权威）

完整原文，不可被图改写：

- 完整会话：仅追加 JSONL
- 完整 skill / 插件文件
- 完整工作区：代码库、小说设定 / 大纲 / 章节等真实文件

权威源就是这些对象本身。图、摘要、画布都是派生。

### 2.2 凝练层（派生索引）

用确定性投影 + LLM 按不同细粒度抽出节点和边。节点是内容，边是关系。每个节点和边必须能在事实层找到依据，并索引到对应事实。

- 图是派生索引，改图不能改写事实
- 覆盖 skill 走新版本，旧版可删，时间可追溯
- 图变更只能追加索引，例如新会话产生的新内容
- 新 id 是对事实片段的索引更新，不是新的权威对象
- 查找库（工作区 `index.sqlite`）可删，必须能从 JSONL + Git + skill + durable artifacts 重建
- 被用过的 GraphRevision / ContextSet / FlowRevision / ViewState 是内容寻址工件，不是 sqlite 行

形式化：

```text
SQLite = rebuild(JSONL facts, Git workspace, skill files, durable artifacts)
```

未落工件的探索性语义边允许消失。被用过的工件必须 round-trip。新凝练只追加新 sha，不得覆盖旧工件。

### 2.3 可视 + 交互层

无限画布，不是把所有内容放进一个画布。大节点嵌套更小的 graph。用户可以对任意节点 / 边子集开启会话、生成 skill、改 skill、编排 Flow。

- 空间可追溯：指回事实层
- 时间可追溯：记录更改，不覆盖无痕
- 画布是 GraphRevision 的交互投影，不是第二权威
- 自动布局坐标不是事实；用户手动排布落 ViewState 工件
- 语义图不能执行。要跑必须 Convert to Flow → Validate → Approval → Pi

结构画布已落地。Flow→Pi 执行（P6）与 ViewState 持久化（P5）已提交；生产语义凝练与交互式嵌套 Sub Flow UI 是剩余缺口，契约不变。

### 2.4 冻结的对象 id

对象本身静态不变。Graph 节点 id 派生，不反写这些 id。

| 对象 | 稳定 id |
|---|---|
| 会话条目 | `sessionId + entryId` |
| 一轮任务 | `sessionId + operationId`（复用现有 `operation_started` / `operation_finished`，不另写 `turn_*`） |
| 工具调用 | entry 内 `toolCallId` |
| 审批 | 成对 lane record id，指向 `toolCallId` |
| 文件 | `workspaceId + repo 相对路径`；revision 锚定 Git blob / commit |
| Skill | `name + filePath + Git blob 或 content hash`，覆盖即新版本 |
| 跨会话提及 | `session_reference` record id，target 是冻结 `sessionId` |
| 开会话选择 | ContextSet 工件 sha；新会话追加 `context_attached` |

### 2.5 内容切分

静态切分可以转为静态 / 动态混合切分，但只切内容索引，不切碎对象。

- 短内容不切
- 长内容按片段切。例如 10000 字先成 10 段；凝练时若用到其中 3300 字，再把这 3300 字拆成 n 个片段 id
- 需要完整用户输入时，取出该用户输入对象的全部片段 id，而不是把它拆成多条 JSONL 事实
- 动态片段 id 的形状是 `entryId + offset + length`（或静态段号范围）
- 派生索引单独存放，**不是** JSONL transcript
- 原 entry 不动。索引可追加、可作废、可重建
- 模型打包和 graph 共用这套索引；按 id 取出对应文本再送给模型
- 压缩不得把一条 entry 变成不可寻址碎片

### 2.6 权威声明（单一事实来源）

- record 词汇与校验语义（`LaneRecord`、codec、reducer corruption 判定）的权威是 `packages/agent/src/harness/session/*`
- 物理持久化与执行的权威是 Pi `AgentSessionRuntime`（v3 JSONL 单写路径）
- 桌面侧唯一合法的事实写入器是 `apps/ravel-desktop/electron/session-facts.js`（customType=`ravel_record`）。任何其他模块不得调用 `appendCustomEntry` 写事实
- Histos Engine 可读 JSONL / Git / skill，不能写 facts
- 读取/投影（agent-bridge、activity、graph-projection）只读不写

### 2.7 明确不抄

- Next.js / Tauri sidecar、本地 HTTP agent 服务器
- Cordis 插件平台、Hermes Python gateway
- TUI 34 适配器层
- 云沙箱、messaging、voice、computer use
- 用 Git Review 冒充执行前权限
- 没有 runtime 权威源的 Plan / Todo 假面板
- 现在做子 agent worktree
- 第二套会话权威、第二套 turn schema、第二套审批库
- Neo4j / 通用图数据库 / Monaco / 自研 Canvas 引擎
- Radix 与 Base UI 长期双轨；Vite 6 / TS 5 作为长期基线

> 2026-08-28 勘误：原「网络安装 skills、OAuth 当 MVP」「MCP 网络传输」不作为永久排除。MCP（含 http/sse 传输与 OAuth）、skills、plugin 是完整 Agent 的普遍能力，Ravel 必须有，纳入基线补齐（见 [`ravel-example-agent-borrowing.md`](./ravel-example-agent-borrowing.md) §3）。仍按设计排除的是：把这些执行挪出 Pi 审批管线、把凭据写进 JSONL、以及云沙箱/computer use。

---

## 3. 和竞品的差距（只作背景）

Ravel 已经站住、不要推倒的：

- JSONL 会话权威、Electron 隔离、Worker 池、Project Trust
- 四档权限、事后 Git Review、本地资源中心、worktree 创建/删除
- 三栏工作台、模型/资源/信任中心
- operation 时间线、工具卡真 diff、审批成对事实
- Histos 结构图、ContextSet 开会话、隔离 PTY、`app://`

现在不到位、且仍阻塞产品深度的：

- 生产 `semanticProvider` 未接入 Histos worker（桌面 semantic 凝练离线）；eval / 成本遥测未做
- 交互式嵌套 Sub Flow UI（递归 compound ELK 布局已落地）
- ContextSet 超窗后的用户收缩 UX（优先级裁剪与 `budget_exceeded` fail-closed 已落地）
- Electron crashReporter 上传（三进程本地崩溃诊断已落地）

铬件底层已是 Base UI、构建已是 Vite 8.2.2 + Rolldown + TypeScript 7 + Electron 44（T1–T5 已提交）。这些能力的历史落点见 [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md)；当前状态与剩余缺口以 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md) 为准。

---

## 4. 切片 0 与切片 1（已完成，契约保留）

切片 0：删除 Scout / Workflow。右栏回到编码闭环，默认 Diff。

切片 1：把 agent 基础做成可寻址事实。

- 时间线按 `operation_started` / `operation_finished` 分成 turn；compaction / navigation 不伪装成用户 turn
- 工具卡主键 `toolCallId`；`edit` / `write` 用 oldText/newText 真实行级 diff
- JSONL 仅追加。compaction 是新 entry + operation，人类时间线仍按原 entry 投影
- 乐观气泡只按 `clientMessageId` 对账；迟到事件按 `sessionId + runId + generation + runtimeEpoch + sequence` 丢弃
- 审批成对 lane record：`approval_asked` → `approval_decided`（`allowed-once | rejected | cancelled | unavailable`）。无回答者、超时、Worker 死亡、窗口关闭必须写 `unavailable`，不得放行

体检补强（仍有效）：

- `approval_asked` 携带 `policyProfile`；`approval_decided` 携带闭集 `reasonCode` 与 `uiRequestId`
- worker 恢复时把无 finished 的 open operation 补写为 `failed`，不自动重跑
- `riskTierOf`：已知工具 read / mutating，其余 untrusted
- streaming 按 `${sessionId}:${runtimeEpoch}:${runId}` 分桶

S2 / S3 / S4（已完成，设计见 [`ravel-design-activity-session-reference-mcp.md`](./ravel-design-activity-session-reference-mcp.md)）：

- S2 动态视图：零新事实，纯投影
- S3 `@session`：`session_reference` 边
- S4 MCP：配置文件即事实，stdio 桥，工具走既有审批

C4 shadow-git checkpoint 已落地：`appendCheckpointFacts` 写成 `operation_started(kind=navigation, targetId=40-char SHA)` + `operation_finished`。Git 失败不回滚、facts 失败不阻断 Git。

---

## 5. 实施状态（2026-08-28）

已在 feature 分支落地，尚未合进 `main`：

- 切片 0 / 1 / S2–S4
- Histos R0–R5：Engine utilityProcess、FactAddress、Evidence、revision DAG、工作区 sqlite、durable artifacts、React Flow、Convert to Flow / Validate、隔离 PTY、`app://`
- R5 hang-fix（`process.reallyExit(0)`、全树 unpack node-pty）已提交（`6ddb87bd1`）
- 锁定栈 T1–T5 已提交：Base UI、Vite 8.2.2 + Rolldown、TypeScript 7.0.2、Zustand 5.0.8、Electron 44.0.0
- P1/P5/P6/P7 已提交；P2/P3/P4/P8 深化已提交（剩余缺口见 roadmap）

剩余顺序只认 Histos 计划 §8，没有备选栈。
