# Ravel Agent 前端重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 逐任务执行本计划，并在每个阶段完成验证后再进入下一阶段。步骤使用复选框（`- [ ]`）跟踪。

**Goal:** 将现有 Ravel Desktop Renderer 落地为统一的 Ravel Shell，并提供 Chat、IDE、Histos 三种可切换表面，同时保持 Electron 隔离、JSONL 事实权威、Histos utilityProcess 边界和现有 Agent/IPC 行为不变。

**Architecture:** 保留现有 Electron 主进程、preload allowlist、IPC DTO、Agent worker、JSONL writer 和 Histos utilityProcess。Renderer 侧新增独立 App 协调层、统一 Shell 和 Surface Router；三种表面共享 Chrome 与 Zustand store，领域数据继续通过 `src/renderer/ipc/client.ts` 获取。SQLite 只存在于 Histos worker，Renderer 只消费 Graph DTO。

**Tech Stack:** Electron 44、React 19.2、TypeScript 7、Vite 8.2、Tailwind CSS 4、Base UI、Zustand、Lucide React、CodeMirror、React Flow、ELK worker、TanStack Virtual、Xterm、node-pty、JSONL、`node:sqlite`。

---

## 当前状态分析

- `apps/ravel-desktop/src/renderer/App.tsx` 同时承担 bootstrap、事件桥接、流式消息归并、transport 状态、快捷键和主题同步，需要先拆出协调职责。
- `components/layout/Workbench.tsx` 已有三栏、拖拽宽度、折叠、Focus Mode、`inert` 和持久化能力，但中栏固定渲染 `ChatPanel`，需要改为 Surface Router。
- 现有 `TitleBar.tsx`、`LeftNav.tsx`、`RightPanel.tsx` 可作为 Shell 迁移来源；不要并行保留两套布局逻辑。
- 现有 Chat 组件包括 `ChatPanel.tsx`、`MessageList.tsx`、`MessageBubble.tsx`、`ToolCard.tsx`、`Composer.tsx`、`GoalBar.tsx`、`PlanReview.tsx`。
- 现有 IDE 相关能力包括 `FileTree.tsx`、`SearchPanel.tsx`、`FileViewer.tsx`、`DiffViewer.tsx`、`WorktreePanel.tsx`、`TerminalPanel.tsx`、`SnippetEditor.tsx`。
- 现有 Histos 能力包括 `GraphPanel.tsx`、`GraphCanvas.tsx`、`graph-projection.ts`、`graph-layout.worker.ts`，以及 Electron 侧 `histos-host.js`、`histos-worker.mjs`、`histos-engine.js`。
- `package.json` 已使用 React 19.2、Vite 8.2、TypeScript 7、Tailwind 4、Base UI、CodeMirror、React Flow、ELK、TanStack Virtual、Xterm 和 `node-pty`。
- `tokens.ts` 与 `global.css` 存在旧 `omega` 命名兼容痕迹；正式实现必须收敛到 `--ravel-*` 单一 token 源，避免业务组件硬编码颜色。

## 提议修改

### 任务 1：建立重构基线和测试夹具

**文件：**
- Read: `AGENTS.md`
- Read: `apps/ravel-desktop/package.json`
- Read: `apps/ravel-desktop/src/renderer/App.tsx`
- Read: `apps/ravel-desktop/src/renderer/store/useAppStore.ts`
- Read: `apps/ravel-desktop/src/renderer/ipc/client.ts`
- Create: `apps/ravel-desktop/test/renderer-surface-state.test.mjs`
- Create: `apps/ravel-desktop/test/renderer-event-ordering.test.mjs`

- [ ] 记录当前行为：默认 Chat、session 切换、streaming、worker recovery、Graph stale request、PTY 生命周期、drawer focus 和主题同步。
- [ ] 为纯函数测试准备固定输入，至少覆盖 `surfaceMode` 默认值为 `chat`、`agent.mode` 与 `surfaceMode` 不互相覆盖、事件排序按 `generation → runtimeEpoch → sequence` 判断旧事件。
- [ ] 运行指定测试，确认基线可执行：
  ```text
  node --test apps/ravel-desktop/test/renderer-surface-state.test.mjs apps/ravel-desktop/test/renderer-event-ordering.test.mjs
  ```
- [ ] 不改变 IPC 协议、事件字段或主进程代码。

### 任务 2：统一 Ravel 视觉 token

**文件：**
- Modify: `apps/ravel-desktop/src/renderer/styles/global.css`
- Modify: `apps/ravel-desktop/src/renderer/theme/tokens.ts`
- Modify: `apps/ravel-desktop/tailwind.config.ts`
- Read/adjust tests: `apps/ravel-desktop/test/base-ui-migration.test.mjs`

- [ ] 将颜色、背景、边框、状态色、圆角、阴影、动效变量统一到 `--ravel-*`。
- [ ] 保留亮色、暗色和 system 主题；业务颜色只从 CSS Variables 读取。
- [ ] `tokens.ts` 只保留几何与动效常量，以及映射到 `var(--ravel-*)` 的类型，不再新增 `omega` 颜色源。
- [ ] Tailwind 4 使用 CSS-first token；保留配置文件仅处理既有构建兼容，不再增加第二套 `omega` 色板。
- [ ] 统一持久化 key 为 `ravel-shell-layout-v1` 和 `ravel-theme`，仅在迁移入口读取一次旧 key。
- [ ] 验证业务代码不新增 `#hex`、`rgb()`、`hsl()` 颜色和 `--omega-*` 新引用。

### 任务 3：拆分 App 协调层

**文件：**
- Modify: `apps/ravel-desktop/src/renderer/App.tsx`
- Create: `apps/ravel-desktop/src/renderer/app/AppBootstrap.tsx`
- Create: `apps/ravel-desktop/src/renderer/app/AppEventBridge.tsx`
- Create: `apps/ravel-desktop/src/renderer/app/AppKeyboardShortcuts.tsx`
- Create: `apps/ravel-desktop/src/renderer/app/SurfaceRouter.tsx`
- Create: `apps/ravel-desktop/src/renderer/lib/events/event-ordering.ts`
- Create: `apps/ravel-desktop/src/renderer/lib/events/agent-event-reducer.ts`
- Create: `apps/ravel-desktop/src/renderer/lib/events/transport-event-reducer.ts`

- [ ] 将 `App.tsx` 收敛为 Provider、Bootstrap、事件桥接、快捷键、Shell 和 overlay host 的组合组件。
- [ ] 把 `refreshControlPlane`、`startNewSession` 和 settings 同步迁入 `AppBootstrap`，保持现有并发请求和 idle 时 transcript reconcile 行为。
- [ ] 把现有事件 `switch` 拆成可测试 reducer/handler；保留 background session 判断、generation、runtimeEpoch、sequence、stream bucket 和 optimistic message 逻辑。
- [ ] 将快捷键迁入 `AppKeyboardShortcuts`，继续使用既有 `DEFAULT_KEYBINDINGS` 和 `matchesKeybinding`，不得硬编码快捷键判断。
- [ ] `SurfaceRouter` 只根据 `surfaceMode` 返回 `ChatSurface`、`IdeSurface` 或 `HistosSurface`，不复用 `agent.mode`。
- [ ] 运行 `npm run typecheck:renderer`。

### 任务 4：重构统一 Shell

**文件：**
- Create: `apps/ravel-desktop/src/renderer/shell/RavelShell.tsx`
- Create: `apps/ravel-desktop/src/renderer/shell/ShellHeader.tsx`
- Create: `apps/ravel-desktop/src/renderer/shell/ShellSurfaceTabs.tsx`
- Create: `apps/ravel-desktop/src/renderer/shell/ShellLayout.tsx`
- Create: `apps/ravel-desktop/src/renderer/shell/ShellRail.tsx`
- Create: `apps/ravel-desktop/src/renderer/shell/ShellOverlayHost.tsx`
- Modify: `apps/ravel-desktop/src/renderer/components/layout/Workbench.tsx`
- Modify: `apps/ravel-desktop/src/renderer/components/layout/TitleBar.tsx`
- Modify: `apps/ravel-desktop/src/renderer/components/layout/LeftNav.tsx`
- Modify: `apps/ravel-desktop/src/renderer/store/useAppStore.ts`

- [ ] 从 Workbench 保留三栏 grid、resize handle、折叠、Focus Mode、compact drawer、`inert` 和宽度持久化。
- [ ] 统一 Shell Chrome：标题栏、Ravel monogram、工作区、分支、三模式 tabs、主题、Freeze Context、账户和更多菜单。
- [ ] 活动栏提供 chat/history/files/graph/search/extensions/settings，并使用 `data-nav-key` 与 `data-active` 的一致状态来源。
- [ ] 增加 `surfaceMode: "chat" | "ide" | "histos"`，默认 `chat`；不要复用 `agent.mode` 或旧 `rightTab`。
- [ ] 所有按钮具备 hover、focus-visible、aria-label；drawer 打开时保持背景 `inert` 与焦点恢复。
- [ ] 运行 renderer 类型检查和现有布局/overlay 测试。

### 任务 5：落地 Chat Surface

**文件：**
- Create: `apps/ravel-desktop/src/renderer/surfaces/chat/ChatSurface.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/chat/SessionSidebar.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/chat/ChatTranscript.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/chat/ChatComposer.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/chat/useChatSurface.ts`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/chat/ChatPanel.tsx`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/chat/MessageList.tsx`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/chat/ToolCard.tsx`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/chat/Composer.tsx`

- [ ] 组合会话列表、中央消息流、Composer 和上下文抽屉，匹配已完成页面设计。
- [ ] 保留 message start/end、text delta、thinking delta、tool execution、compaction、abort、retry、optimistic message 和后台 session activity 行为。
- [ ] 长消息列表使用 TanStack Virtual；streaming 使用现有 `stream-live.ts` 和批处理方式，不把每个 token 直接写入全局 store。
- [ ] 工具卡保留 queued/running/success/error 状态、详情展开和输出访问路径。
- [ ] 空态、错误、重试、无权限、worker 重连和上下文占用都提供可见状态。
- [ ] 运行 Chat 事件 reducer、session、stream 和 Electron smoke 相关测试。

### 任务 6：落地 IDE Surface

**文件：**
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/IdeSurface.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/EditorTabs.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/EditorGroup.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/WorkspaceTree.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/BottomPanel.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/ide/useIdeSurface.ts`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/files/FileTree.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/files/FileViewer.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/files/SearchPanel.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/panels/DiffViewer.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/panels/WorktreePanel.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/panels/TerminalPanel.tsx`
- Reuse/modify: `apps/ravel-desktop/src/renderer/components/common/SnippetEditor.tsx`

- [ ] 用现有文件读取 IPC 和受控 DTO 实现文件树、文件 tabs、CodeMirror 内容区、Diff、Worktree 和终端抽屉。
- [ ] Renderer 不得 import `node:fs`、`node:path`、`node:sqlite`、`node-pty` 或 Pi SDK；文件写入继续走现有 IPC/Agent 工具。
- [ ] CodeMirror EditorView、Xterm 实例和高频终端输出留在组件或 hook，不放入全局 Zustand。
- [ ] 保留路径 containment、trust、Diff snapshot stale 防护、PTY resize/kill 清理。
- [ ] 运行文件、Diff、PTY、Electron security 与 renderer model 测试。

### 任务 7：落地 Histos Surface

**文件：**
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/HistosSurface.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/HistosToolbar.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/HistosGraphWorkspace.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/HistosInspector.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/HistosFlowDrawer.tsx`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/useHistosGraphQuery.ts`
- Create: `apps/ravel-desktop/src/renderer/surfaces/histos/useHistosContextActions.ts`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/panels/GraphPanel.tsx`
- Modify/reuse: `apps/ravel-desktop/src/renderer/components/panels/GraphCanvas.tsx`
- Modify: `apps/ravel-desktop/src/renderer/store/useAppStore.ts`

- [ ] 将 GraphPanel 的查询、selection、view state、context actions、flow actions 拆开，再由 HistosSurface 组合。
- [ ] 保留 React Flow + ELK worker，不提前引入 Canvas 2D；性能阈值必须通过目标硬件 benchmark 决定。
- [ ] 工具栏提供 lens、节点/边统计、Refresh、Rebuild、Freeze Context、布局切换；导入条显示 Workspace hash、URL、构建进度。
- [ ] Inspector 显示节点摘要、证据、关联边、transcript 跳转和 Convert to Flow / Run Flow / Schedule / Suggest。
- [ ] Graph 只能通过 `GraphRevision → Convert to Flow → Validate → Approval → Pi 执行 → JSONL facts` 进入执行路径，不能直接运行语义图。
- [ ] 确认 SQLite 仅在 `histos-host.js → histos-worker.mjs` 中使用，Renderer 只消费 Graph DTO。
- [ ] 运行 Histos import/index/process/canvas/suggest/flow 相关测试。

### 任务 8：整理 IPC client 和类型边界

**文件：**
- Modify: `apps/ravel-desktop/src/renderer/ipc/client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/agent-client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/session-client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/workspace-client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/git-client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/pty-client.ts`
- Create: `apps/ravel-desktop/src/renderer/ipc/histos-client.ts`
- Modify: `apps/ravel-desktop/src/renderer/types/dto.ts`
- Read/verify: `apps/ravel-desktop/electron/preload.js`
- Read/verify: `apps/ravel-desktop/electron/ipc-registry.js`
- Read/verify: `apps/ravel-desktop/electron/ipc-schemas.js`

- [ ] 保留 `ipc` 聚合导出，业务组件继续从 `ipc/client.ts` 获取方法，避免暴露 `window.omega` 细节。
- [ ] 新增或修改的 DTO 必须无凭据、内部句柄、未净化路径、完整 thinking 或过大 PTY 输出。
- [ ] 每个查询带 request key/epoch，旧 workspace/session 的返回不得覆盖当前状态。
- [ ] 不新增未经 preload allowlist、schema、sender 校验的通道。
- [ ] 运行 IPC schema、high-risk、security runtime 和 renderer model 测试。

### 任务 9：完善状态 slice 和持久化

**文件：**
- Modify: `apps/ravel-desktop/src/renderer/store/useAppStore.ts`
- Create: `apps/ravel-desktop/src/renderer/store/slices/chromeSlice.ts`
- Create: `apps/ravel-desktop/src/renderer/store/slices/surfaceSlice.ts`
- Create: `apps/ravel-desktop/src/renderer/store/slices/sessionSlice.ts`
- Create: `apps/ravel-desktop/src/renderer/store/slices/ideSlice.ts`
- Create: `apps/ravel-desktop/src/renderer/store/slices/histosSlice.ts`
- Create: `apps/ravel-desktop/src/renderer/store/selectors.ts`

- [ ] 保留单一 Zustand store 实例，按 slice 组织，不引入第二个状态库。
- [ ] 全局 store 只保存跨组件的轻量状态：surface、session、transcript、agent、selected graph node、layout 和 overlay。
- [ ] UI-local 状态留在 hook：Dialog、CodeMirror、Xterm、React Flow viewport、Graph drag、输入内容和展开状态。
- [ ] selector 使用精确订阅，避免 Chat streaming 触发 IDE/Histos 重绘。
- [ ] 兼容读取旧布局 key 一次，然后统一写 `ravel-shell-layout-v1`。

### 任务 10：端到端、无障碍和性能验收

**文件：**
- Create: `apps/ravel-desktop/e2e/shell-modes.electron.spec.mjs`
- Create: `apps/ravel-desktop/e2e/chat-streaming.electron.spec.mjs`
- Create: `apps/ravel-desktop/e2e/ide-files.electron.spec.mjs`
- Create: `apps/ravel-desktop/e2e/histos-graph.electron.spec.mjs`
- Modify: `apps/ravel-desktop/test/renderer-model.test.mjs`
- Modify: `apps/ravel-desktop/test/electron-security.test.mjs`
- Modify: `apps/ravel-desktop/test/histos-canvas.test.mjs`

- [ ] Shell：默认 Chat、三模式切换、active session 保持、drawer focus、Escape 恢复焦点、Focus Mode 和缩放。
- [ ] Chat：optimistic message、streaming merge、message_end 替换、tool states、recovery、后台 session unread。
- [ ] IDE：文件树、分页读取、搜索、Diff stale、Worktree、PTY 生命周期。
- [ ] Histos：lens、stale graph response、ELK layout、位置恢复、节点 Inspector、freeze、Convert to Flow approval gate。
- [ ] 无障碍：landmark、tab 语义、dialog `aria-modal`、`aria-live`、键盘导航、非颜色状态表达、reduced motion。
- [ ] 性能：80 tok/s 不造成全局重绘、200 条消息虚拟滚动、500 节点图谱可操作、10k JSONL rebuild 不冻结 UI、Xterm 输出不进入 Zustand。
- [ ] 按项目规则运行：
  ```text
  npm run check
  ```
  不运行 `npm run build` 或完整 `npm test`，除非用户另行要求；Electron/Playwright 仅运行指定场景。

## 假设与决策

- 不更换 Electron，不把本地桌面系统服务化，不把 JSONL 事实源改成服务器数据库。
- Electron 主进程、Agent runtime、IPC allowlist、路径 containment、凭据隔离和 utilityProcess 边界视为已修复的稳定基础，不在本计划中重写。
- Base UI 是唯一 headless primitive family，不引入 Radix、MUI 或第二套组件原语。
- `surfaceMode` 表示产品表面，`agent.mode` 表示 Agent profile，二者永久分离。
- Chat、IDE、Histos 共享 Shell，但共享的是窗口 Chrome 和 session/workspace 上下文，不共享互相污染的局部状态。
- `--ravel-*` 是唯一视觉 token 前缀；历史 `--omega-*` 只允许在一次性迁移兼容入口出现，完成迁移后删除。
- 设计画布中的 3 个 HTML 页面作为视觉验收参考，不直接复制 CDN 原型代码到生产 Renderer。
- 生产环境保持 CSP：单一 IIFE renderer bundle、外部 CSS、无 inline script、无 HMR dev server。
- 不在首轮实现中增加多窗口、云端同步、复杂插件市场或自研 Canvas 引擎。

## 验证步骤

1. 每个任务先运行对应的指定纯函数或包测试；测试失败时先修复，不跨阶段堆积错误。
2. 每次 Renderer 代码改动后运行 `npm run check`，修复所有错误、警告和提示。
3. 运行 `npm run typecheck:renderer` 和 Electron 语法检查。
4. 运行指定的 session、stream、IPC、security、file、Diff、PTY、Histos 测试，不运行完整 vitest 套件。
5. 构建前确认 Vite 输出仍是单 IIFE、无 code splitting、相对 base、外部 CSS 和 worker 输出契约。
6. 使用 Playwright Electron 场景验证三模式和关键恢复路径；不使用浏览器预览替代 Electron 验证。
7. 检查 Renderer 源码不存在 `fs`、Git 子进程、SQLite、凭据、`node-pty` 或 Pi SDK 直接引用。
8. 检查 Histos SQLite 使用路径只在 `histos-host.js`、`histos-worker.mjs` 和受控 Electron 侧模块中存在。
9. 检查 `--ravel-*` token 单一来源、亮暗主题、reduced motion、144% 缩放和键盘焦点。
10. 最终运行 `npm run check`、指定测试和 Electron smoke；只在全部通过后交付。

## 覆盖检查

- 页面设计的三种模式：任务 4、5、6、7。
- 报告最终技术栈：任务 2、4、6、7、8、10。
- JSONL/SQLite/utilityProcess 权威边界：任务 7、8、验证步骤 7-8。
- Electron 安全和 Renderer 隔离：任务 6、8、10、验证步骤 7。
- Tailwind/CSS Variables/Base UI：任务 2、4、9。
- 流式消息、工具卡和恢复：任务 3、5、10。
- 图谱 React Flow/ELK/性能门槛：任务 7、10。
- CodeMirror、Xterm、TanStack Virtual：任务 5、6、10。
- 没有删除现有功能；旧字段只在三种表面验证完成后收敛。
