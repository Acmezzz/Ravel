# Ravel 核心设计与下一刀

更新日期：2026-08-26

本文只记录已经拍板的产品不变量，以及下一刀要做的事。核心设计先落纸面，不在本文范围内实现 Graph/Flow 画布、凝练层、内容切分器。实现范围仅限切片 0 和切片 1。

对标过 Codex Desktop、Claude Desktop / Cowork / Code、Hermes Desktop，以及 `D:\project\agent\omega\example\` 下五个项目。借鉴的是不变量和编码工作台表面，不是换架构。

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

## 2. 核心设计（先不实现）

思想：一切皆可成网络。三层必须分清权威，不能把摘要、画布或索引当成真相。

### 2.1 事实层（权威）

完整原文，不可被图改写：

- 完整会话：仅追加 JSONL
- 完整 skill / 插件文件
- 完整工作区：代码库、小说设定 / 大纲 / 章节等真实文件

权威源就是这些对象本身。图、摘要、画布都是派生。

### 2.2 凝练层（派生索引）

用 LLM + agent 按不同细粒度抽出节点和边。节点是内容，边是关系。每个节点和边必须能在事实层找到依据，并索引到对应事实。

- 图是派生索引，改图不能改写事实
- 覆盖 skill 走新版本，旧版可删，时间可追溯
- 图变更只能追加索引，例如新会话产生的新内容
- 新 id 是对事实片段的索引更新，不是新的权威对象

### 2.3 可视 + 交互层（后做）

无限画布，不是把所有内容放进一个画布。大节点可以嵌套更小的 graph。用户可以对任意节点 / 边子集开启会话、生成 skill、改 skill、编排 sub-agent。

- 空间可追溯：指回事实层
- 时间可追溯：记录更改，不覆盖无痕

本层在事实层可索引之前不实现。现在做画布会把 LLM 摘要当成真相。

### 2.4 冻结的对象 id

对象本身静态不变。Graph 节点 id 以后派生，不反写这些 id。

| 对象 | 稳定 id |
|---|---|
| 会话条目 | `sessionId + entryId` |
| 一轮任务 | `sessionId + operationId`（复用现有 `operation_started` / `operation_finished`，不另写 `turn_*`） |
| 工具调用 | entry 内 `toolCallId` |
| 审批 | 成对 lane record id，指向 `toolCallId` |
| 文件 | `workspaceId + repo 相对路径`；有 checkpoint 后再加快照 id |
| Skill | `name + filePath + content hash`，覆盖即新版本 |

### 2.5 内容切分（先不实现切分器）

静态切分可以转为静态 / 动态混合切分，但只切内容索引，不切碎对象。

- 短内容不切
- 长内容按片段切。例如 10000 字先成 10 段；凝练时若用到其中 3300 字，再把这 3300 字拆成 n 个片段 id
- 需要完整用户输入时，取出该用户输入对象的全部片段 id，而不是把它拆成多条 JSONL 事实
- 动态片段 id 的形状是 `entryId + offset + length`（或静态段号范围）
- 派生索引单独存放，可与 session 同目录，**不是** JSONL transcript
- 原 entry 不动。索引可追加、可作废、可重建
- 模型打包和以后的 graph 共用这套索引；按 id 取出对应文本再送给模型
- 压缩不得把一条 entry 变成不可寻址碎片

### 2.6 明确不抄

- Next.js / Tauri sidecar、本地 HTTP agent 服务器
- Cordis 插件平台、Hermes Python gateway
- TUI 34 适配器层
- 云沙箱、messaging、voice、computer use
- 网络安装 skills、OAuth 当 MVP
- 用 Git Review 冒充执行前权限
- 没有 runtime 权威源的 Plan / Todo 假面板
- 现在做子 agent worktree
- 第二套会话权威、第二套 turn schema、第二套审批库

## 3. 和竞品的差距（只作背景）

Ravel 已经站住、不要推倒的：

- JSONL 会话权威、Electron 隔离、Worker 池、Project Trust
- 四档权限、事后 Git Review、本地资源中心、worktree 创建/删除
- 三栏工作台、模型/资源/信任中心

现在不到位、且和核心冲突或阻塞核心的：

- 对话是扁平气泡，不是可寻址的 operation/turn
- 工具卡过粗，edit 没有可靠行级 diff，工具类型没有专用块
- 压缩可能让人类 transcript 看起来被改写
- 事件身份在渲染层仍可能串气泡
- 审批是一次性 confirm，死 Worker 或拒答没有成对事实
- 右栏默认是 journal-workflow / exploration-scout 看板，和「事实可寻址、图是派生」冲突
- 没有变异前 checkpoint、没有可编辑队列、没有 `@file`、没有 worktree 头切换

这些后几项进路线图，不进切片 0+1。

## 4. 路线图中已圈定、但不在本刀实现的项

可进后续切片：A4、A6–A10、A13–A14、B1–B8、C3–C8、D1–D5、E1–E2、E4–E6。

明确不做：E3 Plan/Todo 假面板、D6 子 agent worktree、B9（笔误，无此项）。

C4 shadow-git checkpoint 很值钱，紧跟切片 1，不和 0+1 缠在一起。

## 5. 切片 0：删除 Scout / Workflow

目标：去掉和核心冲突的插件看板。右栏回到编码闭环。

### 删除

- `.pi/extensions/journal-workflow/`
- `.pi/extensions/exploration-scout/`
- `.pi/extensions/_shared/`（仅被上述二者使用）
- `apps/ravel-desktop/src/renderer/components/panels/WorkflowPanel.tsx`
- `apps/ravel-desktop/src/renderer/components/panels/ScoutPanel.tsx`

### 必须改

- `electron/agent-bridge.js`：去掉硬编码 `additionalExtensionPaths`
- 右栏 tab 与 `useAppStore` 的 `rightTab`：类型改为 `"diff" | "worktree"`，默认 `"diff"`
- `Workbench.tsx` 收起轨去掉 Workflow / Scout 图标
- i18n：`nav.tab.workflow` / `nav.tab.scout`
- DTO / `omega:queryExtensionState` / `electron/state-reader.js` 中的 workflow_*、scout_*
- `scripts/sdk-check.mjs` 不再断言这两个插件
- README、`system_design.md`、相关测试

### 不删

- Diff、Worktree、ApprovalBar、右栏壳
- Resource Center、通用 Extension UI
- `packages/coding-agent/examples/extensions/subagent/agents/scout.md`
- 用户磁盘上已有的 `~/.pi/agent/{journals,workflows,journal-backups,explorations}`（备份，不运营）

### 验收

- 启动后右栏默认 Diff
- 命令面板不再出现 `/wf-*`、`/exploration-scout`
- 未信任项目不再为这两个插件走特殊加载路径
- Diff / Worktree 仍可用

## 6. 切片 1：把 agent 基础做成可寻址事实

目标：让会话里的一轮任务、一次工具、一次审批都能被以后的 graph 指回来。仍然不实现画布和切分器。

### 6.1 A1 时间线：复用 operation，不当聊天气泡

现状：`MessageList` 按消息窗口扁平渲染，工具卡用 `afterMessageId` 挂靠。

要做：

- 读取侧按 `operation_started` / `operation_finished` 把 transcript 分成 turn
- 一个 turn = 一次 `kind: "run"` 的 operation
- compaction / navigation operation 不伪装成用户 turn
- 未完成的 open operation 显示为进行中的 turn
- 压缩不删除 operation record

不要做：新的 `turn_*` schema。

### 6.2 A2 / A3 工具卡

现状：通用 `ToolCard`，edit 用结果文本猜 `+/-`。

要做：

- 卡片主键是 `toolCallId`
- `read` / `edit` / `write` / `bash` / `search` 分块
- `edit` / `write` 展示行级 diff，而不是猜统计
- 审批状态如果存在，显示在该 `toolCallId` 上，不当独立看板

### 6.3 A11 压缩不毁日志

现状：压缩结束后桌面曾整表刷新 transcript，人类可见历史像被替换。

要做：

- JSONL 继续仅追加。compaction 结果是新的 compaction entry + operation 记录
- 人类时间线仍按原 entry 投影
- 模型可见面以后由派生索引 / surface 替换处理，切片 1 至少不得把原 user/assistant/tool entry 删掉或改写成摘要

### 6.4 A12 事件身份

现状：`clientMessageId`、`runtimeEpoch`、generation 已有；渲染层仍可能因 id 不一致出现重复气泡。

要做：

- 乐观气泡只按 `clientMessageId` 对账
- 迟到事件按 `sessionId + runId + generation + runtimeEpoch + sequence` 丢弃
- 切会话 / Worker 替换后旧事件不得写进当前时间线

### 6.5 C1 / C2 审批是操作事实

现状：`ask-before-command` 走一次性 `confirm()`。拒答、Worker 死亡、窗口关闭不会留下可寻址决策。

要做：仅追加 lane record，指向已有 `toolCallId`：

```text
approval_asked
  id, lane, seq, timestamp
  runId
  toolCallId
  toolName
  argsDigest

approval_decided
  id, lane, seq, timestamp
  runId
  toolCallId
  askedId
  outcome: allowed-once | rejected | cancelled | unavailable
```

规则：

- 无回答者、超时、Worker 死亡、窗口关闭：必须写 `unavailable`，不得放行
- 拒绝写 `rejected`，取消写 `cancelled`
- 只允许一次的放行写 `allowed-once`
- 界面沿用现有确认 UI，把结果投影到对应工具卡
- 不做审批看板，不另开审批库，不把审批写成 chat message

`LaneRecord` 需要扩展这两种类型，并让 reducer / restore 认识它们。未知审批 record 不得当成可忽略噪声而 fail-open。

## 7. 切片 0+1 明确不做

- Graph 画布、凝练、片段切分器、派生索引文件格式
- C4 checkpoint、可编辑队列、`@file`、worktree 头切换
- OAuth、自动更新 feed、托盘、完整英文
- 恢复 Scout / Workflow，或用 Plan/Todo 填右栏

## 8. 建议提交顺序

1. 切片 0：删除插件与右栏默认 Diff，单独可回滚
2. 切片 1a：审批 record schema + fail-closed 写入
3. 切片 1b：operation 时间线投影 + 工具卡分块 / diff
4. 切片 1c：压缩与事件身份收口

每步之后跑 `npm run check`。涉及测试的文件按仓库规则跑对应测试，不跑完整 `npm test`。

## 9. 理解核对

若以上与拍板一致，下一刀从切片 0 开始改代码。核心设计保持文档，不提前实现画布。

## 10. 实施状态（2026-08-26）

切片 0 与切片 1 已实现并通过验证（`npm run check`、桌面 node:test、agent harness 定向测试）：

- 切片 0：两插件及其面板、state-reader、`omega:queryExtensionState` 全链删除；扩展根改为通用目录枚举，未信任项目仍不加载。
- 切片 1a：`approval_asked` / `approval_decided` 进入共享 `LaneRecord`（codec + reducer fail-closed 校验）；桌面经 `electron/session-facts.js` 以 custom entry 追加事实，审批走 ask→decide 成对落盘，超时/取消/异常/Worker 死亡分别归一为 unavailable/cancelled/rejected/unavailable，未决 ask 在恢复时补写 unavailable。prompt 边界追加 run operation 事实；compaction 因 Pi API 只能事后得知 resultEntryId，采用完成后成对补记（仍然仅追加、可寻址）。
- 切片 1b：`sanitizeTranscript` 投影 operations/approvals/markers（压缩边界锚定前一条消息）；渲染层 `operation-timeline.ts` + `tool-diff.ts` 纯函数，MessageList 渲染轮次行与压缩标记，edit 工具卡用 oldText/newText 计算真实行级 diff 并显示审批结论 chip。
- 切片 1c：worker 流事件 meta 强类型校验（sessionId/runId/generation/runtimeEpoch/sequence/clientMessageId），乐观气泡只按 clientMessageId/key 对账，文本猜测与单 pending 回退已删除。

体检整改（2026-08-26，依据 `docs/ravel-harness-health-check-2026-08-26.md`）：

- 决策可解释性：`approval_asked` 携带 `policyProfile`；`approval_decided` 携带闭集 `reasonCode`（user-allowed/user-denied/ui-cancelled/timeout/no-answerer）与 `uiRequestId`。字段在共享 schema 中可选、写入端必填，旧记录保持可读。投影 `ApprovalFact` 透出 reasonCode/policyProfile。
- 恢复终态化：worker init/switch/recreate 时把无 finished 记录的 open operation 补写为 `failed`（error.code=`worker_recovered_unfinished`），时间轴不再有永久悬挂节点；不自动重跑。
- 工具风险分层：`riskTierOf` 把已知工具分为 read（read/grep/find/ls）/ mutating（bash/edit/write），其余一律 untrusted——workspace-only 与 read-only 下直接拒绝，ask-before-command 下走持久化审批。
- streaming 归属分桶：渲染层按 `${sessionId}:${runtimeEpoch}:${runId}` 分桶维护流式气泡，旧 run 的迟到 delta 无法污染新 run 的气泡。

### 权威声明（单一事实来源）

- record 词汇与校验语义（`LaneRecord`、codec、reducer corruption 判定）的权威是 `packages/agent/src/harness/session/*`；
- 物理持久化与执行的权威是 Pi `AgentSessionRuntime`（v3 JSONL 单写路径）；
- 桌面侧唯一合法的事实写入器是 `apps/ravel-desktop/electron/session-facts.js`（customType=`ravel_record`）。任何其他模块不得调用 `appendCustomEntry` 写事实——该约束由 `test/session-facts.test.mjs` 的静态断言守护。读取/投影（agent-bridge.js）只读不写。

尚未做：跨 epoch replay gap 的更严格基线、C4 checkpoint、Graph 画布/凝练层/片段索引。
