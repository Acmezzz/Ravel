# Agent Harness 体检报告（面向 Graph/Flow 地基）

日期：2026-08-26。审计基准：agent-harness-health-check rubric v1.5。特殊视角：**一切结论以「是否足以支撑 Graph/Flow 三层核心」为准**——事实层可寻址、凝练层可重建、时间可追溯。

## 一、体检范围

- 审计对象：Ravel monorepo 运行时代码（`packages/agent` harness、`apps/ravel-desktop/electron/*`、renderer store）、切片 0+1 最新实现、CI workflows、`packages/evals`、`docs/ravel-core-design-and-next-slices.md`
- 系统类型：single-agent coding 桌面应用（Electron 隔离 + utilityProcess Worker），规划中的凝练层/画布未实现
- 证据来源：运行时代码与测试（主）、CI 配置、设计文档
- 结论可信度：高。全部结论有本轮实现与测试的直接代码证据；仅「skill 内容 hash 身份」「真实故障注入行为」标注待确认

## 二、执行摘要

- 总体结论：**可内测，接近受控上线**。事实层地基（仅追加 JSONL、稳定 id、fail-closed 审批、reducer 校验、损坏 quarantine）已经达到能被 Graph 指回的质量；主要缺口集中在「决策的可解释性」「恢复的执行语义」「行为级安全门禁」三处，且这三处都会直接被凝练层放大。
- 当前阶段判断：**可内测**
- 最关键的 3 个问题：
  1. **决策记录不完整**：审批只落了 outcome，没落 `policy_profile` / `reason_code`。Graph 将来只能指回「批了没有」，指不到「当时凭什么规则」。这是 rubric 明确要求提升为系统级问题的 decision-record 缺口。
  2. **恢复面双权威未显式化**：schema/校验权威（AgentHarness record/reducer）与执行权威（Pi AgentSessionRuntime）已用 custom entry 桥接，但 resume 没有解释器——Worker 死亡后 open operation 只会被标记，不会被续跑或明确终结。Graph 的「时间可追溯」目前是「可读」，不是「可续」。
  3. **零行为级安全门禁**：CI 只有 lint/type/unit/smoke；`packages/evals` 存在但是模型依赖的手动跑件。审批边界（超时/取消/死亡）、scope escalation、recovery safety 没有任何回归样本。凝练层本质是「LLM 大量改写派生索引」，没有门禁就等于把索引质量交给运气。

## 三、总评分卡

| 维度 | 结论 | 风险等级 | 证据完整度 | 说明 |
|------|------|----------|------------|------|
| 边界与架构 | 部分符合 | P1 | 高 | 单 agent 边界清晰；双 runtime 权威需文档级显式化 |
| 工具与放权治理 | 部分符合 | P1 | 高 | 有 permission gate + workspace containment；无结构化 risk_tier/trust_level |
| 状态与恢复 | 部分符合 | **P0（对核心）** | 高 | checkpoint/facts/quarantine/reducer 强；resume 解释器缺位 |
| 上下文与交接 | 部分符合 | P2 | 高 | A11 已做；模型 surface 与人类 surface 分离未收口 |
| 观测与审计 | 部分符合 | P1 | 高 | transcript+facts+事件缓存可回放窗口；streaming 归属仍有全局单桶残留 |
| 安全与人工接管 | 部分符合 | **P0（对核心）** | 高 | 审批已成对落盘 fail-closed；decision record 缺 reason/policy 维度 |
| 评测与发布门禁 | 不符合 | P1 | 中 | 有 evals 包但非门禁；无 safety suite |

## 四、逐项体检

### 1. 边界与架构 —— 部分符合

- 发现：桌面链路 `main → WorkerHost → worker.mjs → Pi Runtime` 单 agent 闭环清晰；Scout/Workflow 已删，无伪 multi-agent。
- 证据：`electron/worker.mjs`（prompt 队列串行、runtime replacement epoch）、切片 0 删除记录。
- 为什么不符合：`packages/agent` 的 `Session/LaneRecord/reducer` 与 Pi 的 `SessionManager` 现在通过 `customType="ravel_record"` 桥接，但「谁是权威」只存在于实现者的脑子里。未来任何人改 Pi 写入路径或 reducer 校验都可能静默分裂事实。
- 当前风险：Graph 凝练层读取事实时无法断言两条写入路径不会产生矛盾日志。
- 建议改动：在设计文档 §10 增加「权威声明」小节：record vocabulary/reducer 归 `packages/agent`，物理持久化与执行归 Pi；`session-facts.js` 是唯一合法写入器。并在 `session-facts.js` 顶部 docstring 重申。
- 最小落地方案：纯文档 + 一条静态断言测试（已有 `resource-center.test.mjs` 先例），半小时工作量。

### 2. 工具与放权治理 —— 部分符合

- 发现：工具显式注册（`TOOLS` 数组 + Pi TypeBox schema）；permission gate 按 profile 分档；路径 canonical containment + symlink 防护。
- 证据：`permission-profiles.js`、`electron-security.test.mjs`。
- 为什么不符合：`MUTATING_TOOLS` 是隐式 risk tier；Project Trust 是工作区级信任，没有工具本体 `trust_level`，也没有 data/action/result boundary 声明。「read 类工具永远安全」这个假设没有被任何 schema 表达——扩展注册的自定义工具可以绕过这套分类（guard 只拦 bash/edit/write）。
- 当前风险：凝练层若给 LLM 注册新工具（如「下载论文」「写索引文件」），现有 gate 不会拦它们。
- 建议改动：把 risk 分类抽成数据表 `{ toolName → risk_tier }`，gate 读表；新增工具默认 `untrusted`（fail-closed 进 ask 分支），而不是默认不管。
- 最小落地方案：`permission-profiles.js` 内加一个 `TOOL_RISK_TIERS` 映射 + 「未知 mutating 工具默认 ask」分支，配 3 个单测。

### 3. 状态与恢复 —— 部分符合（核心视角下的最大缺口）

- 发现（强项）：JSONL 仅追加、torn-tail 修复、非尾部损坏 quarantine、reducer 12 种 corruption 校验、restore 投影、审批/operation 事实可寻址——这些是同类产品少有的质量。
- 证据：`packages/agent/src/harness/{reducer,agent-harness}.ts`、`jsonl/storage.ts`、383 项 harness 测试。
- 为什么不符合：`resume()` 到 `MissingIdentities`/`NothingToResume` 为止是安全的，但没有执行解释器。Worker 死亡后：open operation 永远悬置（UI 显示 suspended），既不重跑也不写终态。对比 rubric 维度 7：主恢复面存在（session JSONL + facts）但没有 continuation executor。
- 当前风险：Graph 时间轴会出现永久 open 的节点；「那次任务到底结束没有」不可判定。凝练层如果按 open operation 切 turn，会产生悬挂子图。
- 建议改动：不做完整 resume interpreter（那是大工程），先补**恢复终态化**：worker init 时扫描 facts 中 open operation 且对应 Pi 会话已 idle 的事实，追加一条带 `error.code="worker_recovered_unfinished"` 的 `operation_finished(outcome:"failed")`，让时间轴闭合。真正的续跑留给后续批次。
- 最小落地方案：`settleSessionFacts()` 已有挂点，加 ~30 行 + 4 个测试。

### 4. 上下文与交接 —— 部分符合

- 发现：压缩仅追加、原 entry 保留、人类时间线有压缩标记（切片 1b）；compaction state 按 session 隔离（activity map）。
- 证据：`agent-bridge.js sanitizeTranscript`、`test/session-facts-projection.test.mjs`。
- 为什么不符合：模型可见面仍由 Pi `buildSessionContext` 直接吃压缩摘要，「原始 surface 与模型 surface 分离」只完成了人类一半。片段索引（混合内容切分）按拍板未实现。
- 当前风险：低。凝练层本来就要自建取材管线（按 id 取文本送模型），Pi 的模型面不影响它。
- 建议改动：接受现状，把它记入凝练层前置条件清单即可，不在 harness 层修。
- 最小落地方案：无代码动作。

### 5. 观测与审计 —— 部分符合

- 发现：每次 run 有 `runId`（operation id）+ 事件 meta 五元组身份；事件缓存 300 条/4MiB 可重放窗口；transcript 即 trace。
- 证据：`worker-host.js` generation fence、`worker-protocol.js` 严格 meta、`App.tsx` 序列谓词。
- 为什么不符合：①streaming assistant 归属仍是全局单 id，多 prompt 并发且 `clientMessageId=null` 时 delta 可能串桶（A12 已知残留）；②跨 worker slot 的 RPC 没有 per-request 取消语义（abort 只作用于 agent，pending IPC 靠 timeout 120s 兜底）；③事件缓存裁剪即 purge，无分层保留声明。
- 当前风险：中。单用户桌面场景下 ③ 可接受；①② 在凝练层的「框选子图开会话」（多并发会话成为常态）时会从偶发 bug 变成系统性错误归因。
- 建议改动：P1 做 streaming 归属分桶（store 内 `streamingByRun: Map<bucketKey,id>`，bucketKey=`sessionId:epoch:runId`）；RPC cancellation 记入 backlog 不阻塞。
- 最小落地方案：分桶改造集中在 `useAppStore.ensureStreamingAssistant/appendDelta` + App.tsx 传 bucket，约 60 行。

### 6. 安全与人工接管 —— 部分符合（决策记录是硬缺口）

- 发现（强项）：审批已是运行时原语——ask 先于交互落盘、四种 outcome 闭集、超时/取消/异常/死亡全 fail-closed、恢复期补写 unavailable、late answer 无法二次 decide、UI 只投影到 toolCallId 卡片。这超过多数同类实现。
- 证据：`session-facts.js`、`permission-profiles.js confirmWithDurableFacts`、17 项专项测试。
- 为什么不符合（rubric 维度 14 直接命中）：decision record 缺三个字段——
  - `policy_profile`：当时生效的权限档没记。将来 Graph 问「这条 bash 当时凭什么被问」无法回答；
  - `reason_code`：outcome 只有结果没有原因分类（user_denied vs timeout_ui_gone 是不同事实）；
  - `request_ref`：durable record 与 extension-ui request id 没有关联，UI 层调试断链。
- 当前风险：Graph 的「时间可追溯」退化为「结果可追溯」；策略变更后历史审批无法按 policy 版本聚合分析。
- 建议改动：给 `approval_asked` 加 `policyProfile: string` 字段（codec 同步校验），给 `approval_decided` 加 `reasonCode`（闭集：`user-allowed` / `user-denied` / `ui-cancelled` / `timeout` / `no-answerer` / `append-failure`）与 `uiRequestId?: string`。旧记录无此字段视为合法（向后兼容读），新记录强制携带。
- 最小落地方案：schema+codec+adapter 各 ~20 行，测试 +6 例。

### 7. 评测与发布门禁 —— 不符合（相对核心目标）

- 发现：CI 有 lint/type/unit/desktop-smoke/release-gate workflow（含 artifact 拒绝检查，质量不错）；`packages/evals` 有 pi-harness + smoke/extensions 两类模型评测，但需要真实 provider、手动触发、不进门禁。
- 证据：`.github/workflows/*`、根 `check` 链、`packages/evals/README.md`。
- 为什么不符合：harness 的安全行为（审批四分支、恢复终态化、quarantine）只有单元级验证，没有「整轮行为」回归；rubric 要求的 approval edge cases / scope escalation / recovery safety 样本集为零。凝练层是 LLM-in-the-loop 的索引改写，没有行为基线就无法区分「索引变好还是变坏」。
- 当前风险：P1。当前手工内测可控；凝练层动工前必须补。
- 建议改动：分两层——①faux-provider 行为回归（复用 `test/suite/harness.ts` 模式，不需要真 key，可进 CI）：覆盖 ask→allow/deny/timeout/crash 四分支 + 恢复终态化 + quarantine 后继续可用；②provider-backed eval 留在 `packages/evals` 作为手动基线，等凝练层有了再定义 pass 标准。
- 最小落地方案：①约 6–8 个用例，全部离线，挂进 desktop `npm test`。

## 五、优先级整改路线

> 2026-08-26 更新：P0 两项与 P1 的 3/4/5/6 已当日落地并通过 `npm run check`、桌面 node:test 179/179、jsonl/reducer 定向测试；实施明细见 `docs/ravel-core-design-and-next-slices.md` §10「体检整改」。P2 三项按原计划延后。

- **P0（凝练层动工前必须）**
  1. decision record 补 `policyProfile` / `reasonCode` / `uiRequestId`（§6）
  2. open operation 恢复终态化，消灭永久悬挂节点（§3）
- **P1（短期进研发计划）**
  3. 工具 risk_tier 数据表 + 未知工具 fail-closed 默认（§2）
  4. streaming 归属按 run 分桶（§5）
  5. faux-provider 行为回归进 CI（§7）
  6. 双权威声明写入设计文档 + 静态断言（§1）
- **P2（不阻塞受控试运行）**
  7. RPC per-request cancellation
  8. 事件缓存保留分层声明（hot=300 条即可，写明无 archive）
  9. skill 内容 hash 物化为资源 id（等 Graph 需要 skill 节点时做）

## 六、最小可上线方案

- 先补哪 3 项：P0 两项 + P1-5（行为回归进 CI）。
- 补完后能达到的阶段：**可受控上线**——高风险动作可拦截且可解释、长任务中断后时间轴闭合、安全行为有回归防线。恰好满足 rubric 的「可受控上线」三条判据。
- 仍然不能自动放开的边界：Worker 死亡后的任务续跑（仍只终态化不重跑）；扩展自定义工具的自动放权；凝练层的索引改写质量（需另行建 eval）。

## 七、上线前门禁建议

- 必须补齐：审批四分支行为回归、quarantine 后 session 可用性回归、open-operation 终态化幂等性（重复 init 不产生第二条 finish）。
- 可以延期：性能基线、多 worktree 并发、跨平台路径矩阵（已有 2 个已知 Windows 基线失败待修）。
- 建议监控：per-session fact 追加失败的 console.error 计数；extension UI 超时率（timedOut 哨兵触发频次）；quarantine 目录增长。

## 八、待确认项

- 缺失证据 1：skill 的 `content hash` 是否已在某处物化为身份（当前只见 name+filePath）。→ 若要做 skill 节点需确认 Resource Center 是否存 hash。
- 缺失证据 2：真实 Worker 崩溃（非模拟）下 custom entry 写入的原子性行为——单元测试用 fake sessionManager，未做过 kill -9 级故障注入。
- 建议补充材料：一次真实长时间使用产生的 session JSONL 样本（用于验证 facts 在真实负载下的体积与读取成本）。
