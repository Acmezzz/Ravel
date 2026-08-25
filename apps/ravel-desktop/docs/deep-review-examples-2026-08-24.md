# DeepSeek Harness 与 Hermes Agent 设计深度审查（2026-08-24）

> 范围：只读审查 `D:\project\agent\omega\example\deepseek-harness`、`D:\project\agent\omega\example\hermes-agent`，并与 Omega Desktop 当前实现对照。
>
> 结论先行：Omega 不应复制两个范例的完整架构，而应吸收关键不变量：显式运行阶段、durable turn/step 边界、原始日志与 UI 投影分离、fail-closed 审批、集中式恢复状态、工具 checkpoint、流式单写者 token。第一优先级是统一 Omega 当前已经分叉的事件与安全契约。

## 1. 范例定位

### 1.1 deepseek-harness

这是一个以事件日志、Agent loop、session surface 和可组合 UI/插件为核心的平台化 harness。最值得学习的不是它的组件数量，而是它把运行时边界显式化：

- Agent phase：`idle`、`maintenance`、`running`。
- 输入 inbox：区分 next-step、next-turn、abort 等目标。
- turn/step durable boundary：在执行步骤前后建立可恢复边界。
- append-only、lossless session event log。
- 从原始日志投影出 model-visible surface，保留 provenance/replacement 信息。
- 用户审批策略 fold 到日志，审批问答成对持久化，异常时 fail closed。
- 连接握手、generation、指数退避和 sink 隔离。
- HTTP/WebSocket 场景的 Host/Origin/Fetch-Metadata trust fence。

关键证据：

- `example/deepseek-harness/packages/core/agent-loop/src/agent.ts:37-46,102-110,112-139,224-299`
- `example/deepseek-harness/packages/core/session/src/types.ts:33-55,60-98,231-299`
- `example/deepseek-harness/packages/core/session/src/surface.ts:1-7,25-37,69-113,115-140,183-240`
- `example/deepseek-harness/packages/interaction/user-approval/src/index.ts:80-116,119-146,187-256`
- `example/deepseek-harness/packages/client/connection/src/client/connection.ts:37-57,60-103,106-200`
- `example/deepseek-harness/packages/client/connection/src/api-request-trust.ts:1-12,53-57,95-122`

### 1.2 hermes-agent

Hermes 是面向生产复杂度的 Agent 服务，重点在长 turn、工具执行、恢复、网关状态和远程 artifact：

- `conversation_loop.py` 集中处理 turn 前置、context、计数、压缩、重试、预算和中断。
- `TurnRetryState` 把多个散落的恢复 bool 集中成可测试状态对象。
- `tool_executor.py` 集中参数解析、审批锁、并发上限、超时和进度持久化。
- `stream_single_writer.py` 用 writer token 防旧流污染新流。
- `gateway/session_state.py` 区分 turn、conversation、persistent 生命周期。
- `browser_control_artifacts.py` 使用 server-minted id、TTL、MIME/大小校验、SHA-256、scope 绑定、one-shot 和原子写入。

关键证据：

- `example/hermes-agent/agent/conversation_loop.py:1766-1799,1820-1864,1893-1943,1959-1994`
- `example/hermes-agent/agent/turn_retry_state.py:1-39,41-87`
- `example/hermes-agent/agent/tool_executor.py:0-9,115-153,163-178,198-225`
- `example/hermes-agent/agent/stream_single_writer.py:1-19,30-69`
- `example/hermes-agent/gateway/session_state.py:1-33,50-87,90-167,170-178`
- `example/hermes-agent/gateway/browser_control_artifacts.py:1-17,19-49,125-169`

## 2. Web UI 与客户端设计比较

### 2.1 deepseek 的 UI 设计优势

deepseek 将 UI 拆成大量窄职责 package，而不是让 Conversation 组件承载所有功能：

- `ui-conversation`：消息、Reasoning、Queue、Stats、Todo、Approval、Context Meter、Input Bar。
- `ui-primitives`：Button、DisclosureRow、DiffBlock、JsonTree、ReadBlock、SearchBlock、TerminalBlock、WebBlock、RiskConfirmation、Toast、Markdown。
- `ui-attachment`：拖拽遮罩、附件 rail、图片预览、lightbox。
- `ui-plan`、`ui-permission-presets`、`ui-model-selection`、`ui-deliverables`、`ui-jobs`、`ui-directory-picker-*`。
- 每个 UI package 都配有 client spec，组件行为以测试驱动。

代表路径：

- `example/deepseek-harness/packages/client/ui-conversation/src/client/chat/ChatView.tsx`
- `example/deepseek-harness/packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`
- `example/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.tsx`
- `example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx`
- `example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx`
- `example/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx`
- `example/deepseek-harness/packages/client/ui-primitives/src/markdown/MessageText.tsx`
- `example/deepseek-harness/packages/client/ui-primitives/src/DiffBlock.tsx`
- `example/deepseek-harness/packages/client/ui-primitives/src/RiskConfirmation.tsx`

可迁移价值：

1. 把 Omega 的 `MessageBubble`、`ToolCard`、`ThinkingBlock`、`ApprovalBar`、`DiffViewer` 进一步拆成协议明确的小组件。
2. 把 permission、plan、todo、queue、deliverables 从“面板内隐式状态”升级成稳定 surface。
3. 对每个交互 surface 使用行为测试，而不仅是静态源码正则。
4. 借鉴 `ReasoningRow` / `ContextMeter` / `QueueDock` 的信息密度：状态可见，但不让运行细节淹没主对话。

### 2.2 Hermes UI 与服务边界优势

Hermes 的客户端更偏“远程 Agent 控制台”：

- REST + WebSocket 同时承载查询与实时事件。
- session/conversation 状态在 gateway 分层管理。
- 大文件、浏览器控制截图和生成物通过 artifact id 传递，不直接塞进 WebSocket。
- UI 通过状态快照和增量事件组合恢复。

可迁移价值：

- 未来 Omega 增加 Web UI 或远程控制时，采用 artifact 引用而非通过 IPC/WS 搬运大字节。
- 对长生命周期 UI 采用 snapshot + event replay，而不是只依赖当前内存。
- 将 turn、conversation、persistent 三种状态分开，避免 session switch 时清理遗漏。

不应当前照搬：

- Omega 当前是本地 Electron，IPC 不是公开 HTTP/WebSocket；不应把 Host/Origin fence 当作 Electron 认证。
- 远程 artifact store 的 TTL/one-shot 设计只有跨进程/跨网络传输大对象时才必要。
- Hermes 的 UI/服务模型包含远程多主体、网关和浏览器控制语义，远超当前本地产品范围。

## 3. Omega 当前基线

Omega 已有成熟基础：

- Electron 主进程持有 fs、Git、凭据与 Worker RPC。
- `contextIsolation`、`sandbox`、`nodeIntegration:false`、CSP、导航拦截。
- preload 窄桥、`senderAllowed`、集中 IPC allowlist 和边界 schema。
- utilityProcess Worker、session-keyed worker pool、cap、idle TTL、health check、generation。
- workspace registry、Project Trust、realpath containment、symlink/traversal 防护。
- Pi JSONL session reader 分页与缓存。
- Zustand selector、三栏可拖拽工作台、流式 Markdown、草稿、队列、steer/followUp、Git Review。

关键证据：

- `apps/omega-desktop/electron/main.js:1-8,309-319,615-655,780-805`
- `apps/omega-desktop/electron/preload.js:1-13,61-101,135-240`
- `apps/omega-desktop/electron/ipc-registry.js:1-106`
- `apps/omega-desktop/electron/ipc-schemas.js:0-49`
- `apps/omega-desktop/electron/worker-host.js:13-89,91-127,129-193`
- `apps/omega-desktop/electron/worker-pool.js:1-18,52-83,134-175,197-250`
- `apps/omega-desktop/electron/path-security.js:16-80`
- `apps/omega-desktop/electron/session-reader.js:30-49,51-113,145-170`
- `apps/omega-desktop/src/renderer/App.tsx:26-75,145-175,177-307,313-400`
- `apps/omega-desktop/src/renderer/store/useAppStore.ts:38-140,214-289,332-355`
- `apps/omega-desktop/src/renderer/components/layout/Workbench.tsx:15-35,43-124,153-224`
- `apps/omega-desktop/src/renderer/components/chat/Composer.tsx:78-145,162-224,226-301`

## 4. 关键差距与高优先级问题

### P0-1：事件与安全契约自相矛盾

Omega 的早期系统设计写着 renderer 只收净化 DTO、不能收到 thinking/raw tool 参数和结果：

- `apps/omega-desktop/docs/system_design.md:5-7,17-21,193-214,433-435`

但文档后部又加入了 V3 full-fidelity 设计：

- `apps/omega-desktop/docs/system_design.md:612-620`

当前实现已经是偏 V3：

- `apps/omega-desktop/electron/agent-bridge.js:1-8,178-203,245-259`
- `apps/omega-desktop/src/renderer/types/events.ts:123-139`

当前事件可包含 thinking、完整工具 args/results、full paths、bash 输出；64KB 截断主要是内存/传输上限，不等于敏感数据净化。

**判断：** 这不是文字问题，而是威胁模型真相源冲突。必须先明确：

- renderer 是否允许 thinking 原文；
- 是否允许完整工具参数/结果；
- 是否允许绝对路径与 bash 输出；
- 64KB 是容量限制还是安全过滤；
- “进程隔离”与“内容净化”分别承担什么责任。

### P0-2：缺少轻量的 phase / turn / step durable 模型

Omega 当前有 connection、running、compacting、worker transport、settled 等分散状态，但没有一个统一状态机来规定 prompt、abort、compact、flush、restart、close、session switch 的合法顺序。

结果是：

- 关闭与 worker restart 的边界要在多个文件共同推断；
- abort 后的旧 delta 依赖 generation/sequence 过滤；
- prompt retry、compaction 和 session switch 容易形成隐式竞态；
- 发生 crash 时，当前 turn 是未开始、执行中还是已完成不够清晰。

建议先引入小型状态机，而不是完整 Cordis：

```text
idle -> running -> aborting -> idle
idle -> maintenance -> idle
any -> restarting -> ready | failed
any -> disposed
```

并定义 `turn_start / step_start / tool_start / tool_end / turn_end` 的 durable 边界。

### P0-3：恢复状态分散

Omega 当前已有 worker auto-restart、prompt timeout、compaction、retry、optimistic rollback，但恢复标志散落在 WorkerHost、App、Composer、Worker 和 close lifecycle。

建议借鉴 Hermes `TurnRetryState`，建立内部对象：

```ts
interface TurnRecoveryState {
  attempt: number;
  maxAttempts: number;
  retryReason: string | null;
  compactionAttempted: boolean;
  workerRestartAttempted: boolean;
  providerFallbackAttempted: boolean;
  staleGeneration: boolean;
  interrupted: boolean;
  persistenceFailed: boolean;
}
```

每个字段都要标明 turn/request/generation 生命周期，避免继续增加散落 boolean。

### P1-1：原始日志、运行时状态、Renderer 投影未完全分层

Omega 的 JSONL 是权威源，但 session reader、agent bridge、renderer store 同时承担事件解释和 UI 派生。建议明确三层：

```text
Pi JSONL / raw event log
        -> runtime replay state
        -> renderer transcript + ToolCard DTO
```

Renderer 不应成为 agent transcript authority；UI 重载、事件 replay、历史分页都应从 runtime projection 重建。

### P1-2：缺少 stream single-writer token

Omega 已有 `sessionId + runId + generation + sequence`，但还应为每条流增加 writer token：

- abort 后旧流不得追加 delta；
- worker restart 后旧流不得恢复写入；
- provider retry 不得重复追加；
- session switch 后旧流不得污染当前 store。

借鉴 Hermes `stream_single_writer.py`，对旧 writer 只做确定性拒绝，能力缺失时安全降级，不要用隐式全局锁。

### P1-3：审批需要 durable audit 与 fail-closed

Omega 已有 permission profiles、Project Trust 和 Git Review，但审批请求/结果需要绑定：

```text
sessionId + runId + generation + toolCallId + approvalId
```

worker 重启后旧审批自动失效；超时、无 answerer、generation 不一致都默认拒绝；asked/decided 结果应有可追踪记录。

### P1-4：测试层次偏静态

当前桌面测试大量使用 Node test + 源码正则断言。它们能防止通道删除和关键字符串漂移，但不能证明真实 Electron renderer/IPC 运行时安全。

需补：

- 真实 BrowserWindow + preload + IPC 集成测试；
- 恶意/异常 extension 测试；
- 多 worker 并发与 session switch 测试；
- worker crash/restart/replay 测试；
- 超长 transcript 与 64KB event 测试；
- UI keyboard/focus/streaming interaction 测试。

## 5. 重要但非阻塞的问题

### P2-1：文档与实现过时

系统设计仍写 V1 JSON 持久化和 `persistence.js`：

- `apps/omega-desktop/docs/system_design.md:20-21,129,138-140,456-474`

当前实现依赖 `~/.pi/agent/sessions` JSONL 和 `session-reader.js`：

- `apps/omega-desktop/electron/agent-bridge.js:83-90,442-444`
- `apps/omega-desktop/electron/main.js:1379-1390`

应删掉过时方案，明确 JSONL 是当前 authority，Omega 设置/缓存另行持久化。

### P2-2：release gate 不是真正 smoke test

`apps/omega-desktop/scripts/release-gate.mjs` 主要检查 manifest、版本和目标策略，未真正验证：

- 打包产物存在；
- 应用可启动；
- preload 可加载；
- CSP 生效；
- 关键 IPC 能调用；
- Windows 安装/portable 产物可运行。

应把 `electron-smoke` 接入打包后 gate，至少覆盖 unpacked 目录启动与退出。

### P2-3：固定 CSP nonce

当前 nonce 是构建期固定值：

- `apps/omega-desktop/index.html:6-19`
- `apps/omega-desktop/docs/system_design.md:36-38`

对于本地桌面攻击模型它不是首要问题，但它不等同于每次文档生成 nonce。应在文档中明确这是静态构建信任，不要把它描述成强随机 CSP nonce。

### P2-4：Renderer 路径与资源泄露面

`state-reader` 的 health roots/issues/path 等 DTO 可能把绝对路径展示到 renderer。当前同机 UI 可用，但应区分：

- UI 必须显示的 basename/display path；
- 仅诊断日志需要的绝对路径；
- 不应进入持久化事件的敏感路径。

### P2-5：长会话压力

事件单条有 64KB 截断，但长 transcript、工具卡、replay cache 仍可能造成累积压力。应增加：

- transcript 分页与窗口化；
- tool result 按需加载；
- replay gap 明确提示；
- session/worker 级内存指标；
- 大 payload 持久化上限与淘汰策略。

### P2-6：动态扩展安装扩大执行面

资源中心已限制联网来源并接入 trust，但“本地安装 + enable + reload”仍然会扩大 worker 执行面。应把安装、启用、执行分成状态：

```text
installed -> inspected -> trusted -> enabled -> loaded
```

每次 reload 记录 source、hash、trust decision 和 generation，避免竞态和不可追踪的代码变更。

## 6. 推荐吸收路线图

### P0-阶段 A：先统一真相源

- [ ] 决定采用当前实现接近的 V3 full-fidelity 还是回收为 sanitized DTO。
- [ ] 重写 `system_design.md` 的安全边界、事件字段、持久化权威源。
- [ ] 为事件增加 `eventVersion`，明确 `generation/sequence/replay` 语义。
- [ ] 明确 thinking、tool args/results、full path、bash 输出的存储/展示规则。
- [ ] 把“容量截断”和“敏感数据净化”拆成两个明确函数。

### P0-阶段 B：轻量 runtime phase/turn

- [ ] 在 worker 内建立 `idle/running/maintenance/aborting/restarting/disposed`。
- [ ] 定义 turn/step/tool durable boundary。
- [ ] 所有 prompt、abort、compact、flush、restart、close 走状态机。
- [ ] crash 时写入 `interrupted` 或等价恢复状态。

### P0-阶段 C：恢复与流一致性

- [ ] 引入 `TurnRecoveryState`，集中 retry/compaction/restart/persistence 状态。
- [ ] 引入 stream writer token，强化 session/run/generation/sequence 校验。
- [ ] 重启后旧审批、旧 prompt、旧 writer 一律失效。
- [ ] 未确认 optimistic message 显示“待确认/可重试”，不要静默删除。

### P1-阶段 D：数据投影与审批审计

- [ ] raw JSONL → runtime replay state → renderer DTO 三层化。
- [ ] 审批请求/结果 durable audit，超时/失联 fail closed。
- [ ] 扩展状态 installed/inspected/trusted/enabled/loaded 分层。
- [ ] Renderer 仅接收必要的 display path。

### P1-阶段 E：真实质量门禁

- [ ] BrowserWindow/preload/IPC 集成测试。
- [ ] worker crash/restart/replay E2E。
- [ ] 多 worker 并发、session switch、abort race。
- [ ] 超长 transcript、大工具结果、replay gap。
- [ ] 打包后 `electron-smoke` 与 portable/unpacked 运行验证。

### P2-阶段 F：未来远程化能力

仅当 Omega 增加 Web/远程控制后吸收：

- Host/Origin/Fetch-Metadata trust fence；
- WebSocket handshake/reconnect；
- artifact id + TTL + one-shot + SHA-256；
- 大文件不经消息通道搬运。

## 7. 最终判断

### 值得吸收

1. deepseek：显式 phase、turn/step durable boundary、append-only event + surface projection、fail-closed approval、generation reconnect。
2. Hermes：TurnRecoveryState、工具执行 checkpoint、stream single-writer、turn/conversation/persistent 生命周期分组、远程 artifact 的边界思想。
3. 两者共同点：把状态转换和持久化时机写成不变量，而不是靠组件之间的隐式约定。

### 不要照搬

1. deepseek 完整 Cordis/Scope/plugin runtime。
2. deepseek HTTP trust fence 作为 Electron IPC 认证。
3. Hermes 超大且 provider 特判密集的 conversation loop。
4. Hermes 并发工具线程模型。
5. Hermes 永不 eviction 的长驻 session dict。
6. Hermes 面向远程浏览器控制的 artifact store。

这两个范例真正提供的价值，是帮助 Omega 把“事件顺序、恢复边界、审批审计、单写者和状态生命周期”从隐式代码行为提升为明确架构不变量。
