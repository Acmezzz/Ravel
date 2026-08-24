# Omega Desktop 前后端优化基线与实施路线图

> 日期：2026-08-24  
> 范围：`apps/omega-desktop`、`packages/coding-agent` 以及桌面端 CI / 打包门禁  
> 状态：阶段 0 基线

## 1. 目标与非目标

本计划将 Omega Desktop 继续演进为稳定的 Agent 工作台，同时保持当前安全边界和最小必要复杂度。

### 1.1 优化范围

- Renderer UI/UX、Workbench 布局、排版、流式渲染、可访问性和性能。
- Main / preload / IPC、WorkerHost、WorkerPool、worker runtime、agent bridge、session/replay。
- Agent turn、runtime replacement、prompt queue、错误恢复和资源上限。
- workspace、session、extension、permission profile 和文件路径安全。
- 单元测试、Renderer 行为测试、Electron 集成测试和 packaged smoke。
- CI、release gate、构建产物内容和启动验证。

### 1.2 明确不做

- 不复制 deepseek-harness 的完整 Cordis / Scope / plugin runtime。
- 不把 Hermes 的完整远程 backend、PTY Chat、SSH/WSL/Docker 路由和大型 docking 系统搬入 Omega。
- 不把 Electron IPC 当成远程 HTTP 的 Host/Origin trust fence。
- 不把 Pi 当前用户权限误称为沙箱；真正的隔离仍需 container、VM 或其他 sandbox。
- 不在普通 PR 门禁中强制依赖真实 provider、OAuth、网络下载、签名或发布凭据。
- 不让 Renderer 获得文件系统、Git、凭据或 Pi SDK 访问权限。

## 2. 当前架构基线

```text
React Renderer
  -> src/renderer/ipc/client.ts
  -> preload.js narrow bridge
  -> main.js ipcMain handlers
  -> WorkerHost / WorkerPool
  -> utilityProcess worker.mjs
  -> agent-bridge.js
  -> AgentSessionRuntime / AgentSession / SessionManager
  -> Pi JSONL session authority
```

### 2.1 Authority 划分

| 层 | 权威职责 |
|---|---|
| Pi JSONL / SessionManager | durable transcript、session tree、消息、时间戳和分支 |
| Worker runtime | 当前 Agent、turn、tool 和 extension 运行状态 |
| Main process | BrowserWindow、IPC、文件、Git、workspace、凭据和 Worker 生命周期 |
| Preload | 经过校验的窄能力桥 |
| Renderer | 受控 DTO 的 presentation、短期交互状态和投影缓存 |

Renderer 不维护第二份 transcript authority。任何本地 optimistic 状态都必须有明确的 client id，并最终与 authoritative session event 对账。

## 3. 统一运行与事件契约

### 3.1 事件元数据

后续事件契约应逐步收敛到以下字段；在兼容旧事件期间，新字段可选但必须由 Main / Worker 负责补齐或明确标记缺失：

```ts
interface EventMeta {
  eventVersion: 1;
  eventId: string;
  sessionId: string;
  runId?: string;
  turnId?: string;
  stepId?: string;
  generation: number;
  runtimeEpoch: number;
  sequence: number;
}
```

语义：

- `eventId`：事件唯一身份，用于去重。
- `sessionId`：事件所属 durable session。
- `runId`：一次 Agent run 的身份。
- `turnId`：一次用户 prompt turn 的身份。
- `stepId`：turn 内一个可恢复的工具或模型步骤。
- `generation`：Worker 进程代际。
- `runtimeEpoch`：同一 Worker 内 runtime/session replacement 的代际。
- `sequence`：同一 generation/runtimeEpoch 中的单调序号。

### 3.2 Phase 状态机

目标状态：

```text
idle -> running -> maintenance -> aborting -> restarting -> disposed
```

状态变化必须有明确来源和可观察结果：

- `idle`：没有活动 turn。
- `running`：模型或工具正在执行。
- `maintenance`：压缩、恢复、持久化或其他维护操作。
- `aborting`：正在停止当前 run，禁止新旧流继续写入。
- `restarting`：Worker/runtime 正在恢复。
- `disposed`：runtime 或 Worker 已不可继续使用。

### 3.3 Durable 边界

后续逐步引入以下逻辑边界：

```text
turn_start
step_start
tool_start
tool_end
turn_end
```

事件流必须区分 durable lifecycle event、流式 delta、诊断事件和 renderer-only presentation event，避免 Renderer 通过猜测事件顺序恢复状态。

### 3.4 Stale 与 writer 规则

以下事件不得更新当前 UI 或新 runtime：

- 旧 `generation`。
- 旧 `runtimeEpoch`。
- 已取消或已完成的 `runId`。
- 重复 `eventId`。
- 不满足当前 replay cursor 的 `sequence`。
- 已被新 prompt/retry/restart 取代的 writer。

每次 prompt、retry、abort、restart 或 runtime replacement 都应获得新的 writer token。只有当前 token 的 writer 可以写入 assistant delta、tool progress 和 completion。

## 4. Raw event、replay state 与 Renderer DTO

数据流统一为三层：

```text
raw JSONL / runtime event
  -> bounded replay state
  -> renderer DTO
```

### 4.1 Renderer 默认契约

Renderer 默认消费受控 summary，而不是 raw event：

- 消息正文、thinking、tool args/results、bash tail 和路径均有字段级大小上限。
- 默认展示 basename、摘要、状态、耗时、增删行统计和下一步动作。
- 完整工具详情通过受控 IPC 按需读取，并重新校验 session、tool call、snapshot 和 workspace。
- 64KB 等限制明确称为 payload cap，不等同于敏感信息净化。
- 未净化的异常、原始凭据、绝对路径和 raw extension output 不直接穿过 Renderer 边界。

### 4.2 投影层职责

- Raw event 保留恢复和诊断需要的完整性。
- Replay state 负责 bounded cache、去重、gap 检测和当前 turn 投影。
- Renderer DTO 负责 UI 展示、字段截断和用户操作 affordance。
- UI 需要更多详情时走明确的 detail request，而不是扩大默认事件 payload。

## 5. 前端 UI/UX 与排版方向

当前三栏 Workbench 是保留骨架：

- 左栏：sessions、files、worktrees。
- 中栏：conversation、composer、queue。
- 右栏：workflow、scout、diff、worktree。

### 5.1 从两个范例吸收的设计

- 使用语义化 UI block：Reasoning、Plan、ToolGroup、Approval、Diff、Terminal、Error。
- 使用有限 pane registry，避免所有功能继续堆进单一 `RightPanel`。
- Chat host 在面板或 session 视图切换期间保持连接和流状态。
- Focus Mode 只隐藏辅助栏，不改变 session authority。
- 右 rail 点击图标自动打开对应 tab；当前活动 tab 再次点击可折叠。
- 窄窗口自动隐藏、overlay 或 bottom-sheet 辅助栏，不能把中心内容压缩到不可读。

不直接复制：完整任意 docking、多窗口 HUD、PTY 主聊天、远程连接状态树和插件运行时。

### 5.2 排版规范

- 正文最大阅读宽度约 720–840px。
- Body、Label、Mono、Title 使用明确的字体语义。
- 间距采用 4/8/12/16/24/32 节奏。
- 普通消息优先使用间距分组，不给每一段都套卡片。
- Tool、Approval、Diff、Error 使用更强表面和边界。
- 蓝紫 / Iris 只表示焦点、选中和当前运行，不作为所有装饰色。
- 每个状态同时表达文本、视觉状态和下一步动作。

### 5.3 Workbench 具体优化

- 保证中心栏有最小可读宽度；窄窗口时隐藏或 overlay 左右辅助栏。
- Header 不再使用静默 `overflow: hidden` 裁掉后续操作，应提供 overflow menu。
- 布局偏好区分全局默认和 workspace override。
- 右栏 tab 的 open / selected / collapsed 语义保持一致。
- 增加 Focus Mode，保留 workspace、session、connection 和错误/审批状态。
- 消息、工具卡、Diff 和 Composer 各自保持合适的阅读宽度和密度。

## 6. Renderer 状态、消息流与性能

### 6.1 当前优先问题

- optimistic message 只有单一 `optimisticKey`，快速连续 prompt、steer、follow-up 可能错配。
- `MessageList` 和 `Composer` 订阅完整 `messages`，每个 delta 会触发无关区域重渲染。
- `streamingAssistantId` 是全局单值，缺少 run/turn 关联。
- ExtensionSurface 的 selector 在每次状态变化时返回新数组。
- streaming 期间反复 `smooth` scroll 可能堆积动画。
- 大 Diff、Scout proposal、Workflow registry 缺少折叠、分页或降级。
- FileTree、SessionList、FileViewer、WorktreePanel 有旧请求覆盖新 workspace/session 的风险。
- 颜色和 motion token 分散在 `tokens.ts`、`palettes.ts`、`global.css` 和组件硬编码中。

### 6.2 目标

- 为每次发送建立 `clientMessageId` / `promptId` / pending record。
- authoritative message 按 request id、entry id、payload 或明确 fallback 规则匹配 optimistic bubble。
- assistant/tool 流绑定 `sessionId`、`runId`、`turnId`、`writerToken`。
- Composer 只订阅必要的输入历史摘要，不订阅完整 transcript。
- MessageList 使用细粒度派生 selector 和按消息 id 的最小更新。
- 用户在底部时才自动滚动；流式 delta 使用单帧或 `auto`，新消息才考虑短促 smooth。
- 采用 keyset/pagination，避免组件重复复制整段 transcript。
- 大 Diff 采用文件/hunk 折叠和阈值降级。
- 所有异步读取使用 request epoch、AbortController 或等价 stale guard。
- 组件只使用语义 CSS token，不直接写颜色字面量。

## 7. Main / Worker 生命周期与恢复

### 7.1 重点风险

- runtime replacement 先销毁旧 runtime，创建失败后 Worker 仍可能呈现 ready。
- 同一 generation 的旧 queued prompt 可能在新 runtime/session 上执行。
- WorkerHost `postMessage` 同步抛错时 pending RPC 可能等待到 timeout。
- Worker 对 `uncaughtException` 有处理，但需要统一 `unhandledRejection` recovery。
- WorkerPool health check 与 disposeAll 存在 timer race。
- permission profile 重绑定不能重复触发完整 session initialization。
- credential update 失败不能删除原本有效的 credential。

### 7.2 目标

- runtime replacement 使用 prepare / commit / rollback；创建失败进入明确 dead/restarting/fatal 状态，禁止假 ready。
- 每次 runtime replacement 增加 `runtimeEpoch`，queued closure 捕获并验证 epoch。
- WorkerHost 对 postMessage、error、exit、timeout 统一 settle pending map。
- Worker lifecycle 使用统一状态和可重试错误码。
- permission profile 只更新 guard/context，不重复 session-start 副作用。
- credential 更新保留旧值，失败时事务性恢复。

## 8. Session、replay、event cache 与资源控制

### 8.1 重点风险

- 高频事件使用同步 append，event cache 可能无界增长。
- recentEvents 同步读整文件再取末尾，可能阻塞 Main。
- Worker init 重置 event sequence，重启和切换后可能重复或丢事件。
- message_start/end 和 transcript 缺少统一字段级 cap。
- snapshot 每次扫描整条 branch，长会话成本为 O(n)。
- session list、symlink directory 和文件扫描保护不一致。
- 大文件读取和 JSONL append 在高频流中阻塞。

### 8.2 目标

- event cache 按行数和字节数 bounded，使用 ring segment 或原子截尾。
- replay cursor 同时校验 generation、runtimeEpoch、sequence、eventId 和 gap。
- Session summary 与 message detail 分离，detail 按需分页。
- 持久化失败进入诊断，不抛出破坏 Main message handler。
- session reader、workspace reader、snapshot 都有文件数、字节数和时间上限。
- 保留 append-only 语义，同时用 per-session write queue 降低同步阻塞。

## 9. 安全、权限与扩展边界

### 9.1 必须修复

- workspace-only 从词法前缀升级为 canonical realpath containment。
- removeLocalResource 与 installLocalResource 使用同等授权来源、token 和 realpath 校验。
- session path 统一格式校验、root containment、symlink 拒绝和扫描上限。
- skill model invocation 采用 trust、realpath、原子写入和 busy guard。
- 非 regular file、FIFO、socket、device 默认拒绝读取。
- Renderer 默认不接收 raw tool output、绝对路径和未净化异常。

### 9.2 必须保持

- `contextIsolation: true`。
- `nodeIntegration: false`。
- `sandbox: true`。
- `webSecurity: true`。
- preload 窄桥和 IPC allowlist。
- 主进程执行文件、Git、凭据和权限操作。

## 10. 测试分层

### 10.1 模块与契约测试

覆盖 WorkerHost、runtime epoch、event cursor、payload cap、path guard、credential rollback 和 bounded cache。

### 10.2 Renderer 行为测试

引入最小 DOM 测试环境，覆盖：

- store action 和事件 reducer。
- 多条 prompt 的 optimistic matching。
- queue、steer、follow-up、rollback。
- MessageList scroll 和历史分页。
- Composer IME、附件、`@` completion 和 stale response。
- ToolCard loading/error/retry。
- Panel loading/empty/error/stale。
- keyboard/a11y、主题和 reduced motion。

### 10.3 Electron 集成测试

在隔离 workspace 和 fake provider 中加载真实 BrowserWindow、preload 和 index，验证：

- webPreferences 和 CSP。
- contextBridge 能力面。
- IPC round-trip 和来源拒绝。
- workspace/path denial。
- Worker ready、prompt、abort、restart、replay。
- close lifecycle 和错误恢复。

### 10.4 Packaged smoke

真实运行 `electron-builder --dir` 产物，验证：

- executable 启动。
- isolated userData/workspace。
- bootstrap / worker-ready 握手。
- renderer 加载和 CSP 无违规。
- `resources/omega-runtime`、extensions 和 coding-agent runtime 存在。
- 正常关闭、超时和退出码。

静态源码正则测试保留为补充，不再作为唯一正确性证明。

## 11. CI 与 Release Gate

Windows Desktop job 的目标顺序：

```text
build:renderer
-> typecheck
-> typecheck:renderer
-> test
-> package:dir
-> electron:smoke
```

`electron-smoke.mjs` 需要从“exe 存在性检查”升级为真实 spawn、握手、日志、资源和退出检查。真实 provider、签名、更新、网络下载放在 nightly/manual job，不阻塞普通 PR。

## 12. 指标、回滚与阶段完成定义

每阶段记录：

- renderer build 时间和 bundle size。
- 首次 ready 时间。
- streaming render 批次和刷新频率。
- event cache bytes/lines。
- Worker restart/recovery 结果。
- Main thread blocking 文件操作。
- 测试数量、失败和 flaky 情况。

每阶段必须：

1. 只改变一个可回滚主题。
2. 更新对应文档状态。
3. 运行 `git diff --check`。
4. 运行对应 typecheck/test/build gate。
5. 单独创建 git commit；远程链路可用时同步该阶段提交。

## 13. 分阶段实施计划

### 阶段 0：文档与契约基线

- 创建本文档。
- 修订 `docs/system_design.md` 的持久化、DTO、事件流和生命周期描述。
- 修订 `docs/implementation-status.md`、`docs/code-review-2026-08-24.md` 的测试数量和 packaged smoke 状态。
- 将 `docs/deep-review-examples-2026-08-24.md` 纳入稳定审查基线。

提交：`docs(omega): define frontend backend optimization baseline`。

### 阶段 1：消息与 Worker 身份正确性

Renderer：

- `clientMessageId` / `promptId` pending map。
- optimistic 按 id、payload 和 authoritative entry 精确匹配。
- 连续 send、steer、follow-up、IPC reject、Worker restart 的回滚语义。

Main/Worker：

- runtime replacement 的 `runtimeEpoch`。
- 旧 queue closure 不得跨 replacement 执行。
- replacement 失败进入明确 dead/restarting 状态。
- WorkerHost postMessage 失败及时清理 pending。
- Main event persistence 失败只上报诊断。

提交：`fix(omega): bind prompts and worker replacement to runtime identity`。

### 阶段 2：事件、Session 与资源边界

- bounded event cache/ring segments。
- generation/runtimeEpoch/sequence replay cursor。
- payload cap 和 detail IPC。
- session path/symlink/scan upper bounds。
- per-session persistence queue。
- 大文件受限分页读取。

提交：`fix(omega): bound replay and session resource usage`。

### 阶段 3：权限与扩展安全

- canonical realpath permission guard。
- remove resource authorization parity。
- session path root assertion。
- regular-file guard。
- skill model 原子写入和 trust 检查。
- permission profile rebind 不重复 session_start。
- credential rollback。

提交：`fix(omega): harden workspace and extension boundaries`。

### 阶段 4：Renderer 性能与 UI 状态模型

- 细粒度 Zustand selectors。
- transcript/tool/stream state 分层。
- Composer 脱离全量 messages 订阅。
- 稳定 ExtensionSurface selector。
- streaming scroll 单帧调度。
- 大 Diff 折叠/降级。
- FileTree、SessionList、FileViewer stale request guard。
- UI primitive state contract。

提交：`perf(omega): isolate renderer subscriptions and streaming work`。

### 阶段 5：Workbench、UI/UX 与排版

- 窄窗口 breakpoint、overlay 或自动隐藏侧栏。
- Header overflow menu。
- workspace-scoped layout preference。
- limited pane registry 和 Focus Mode。
- 720–840px 阅读宽度。
- typography、spacing、semantic color token 统一。
- ToolGroup、Reasoning、Plan、Approval、Diff、Terminal surface。
- Composer 的 queue/context/attachment/model/permission 状态。

提交：`feat(omega): refine workbench hierarchy and agent interaction surfaces`。

### 阶段 6：真实 Electron 集成与发布门禁

- Renderer DOM 行为测试。
- BrowserWindow/preload/IPC 集成 fixture。
- fake provider 和隔离 workspace。
- Worker crash/restart/replay E2E。
- CSP violation 监听。
- packaged smoke 启动、握手、资源和退出验证。
- Windows CI 加入 build、package、smoke 和 artifact/log upload。

提交：`test(omega): add electron integration and packaged smoke gates`。

### 阶段 7：观察与收尾

- 完整 desktop tests、renderer typecheck、build、package、smoke。
- 记录性能、缓存、流式渲染和 Worker 恢复指标。
- 清理过时静态测试和文档。
- 最终安全边界审查和 diff 审查。

提交：`chore(omega): finalize frontend backend optimization rollout`。
