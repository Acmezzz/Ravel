# Tasks — Ravel Shell 前端重构

> 每个任务先（或同时）运行其指定纯函数/包测试，失败先修再进下一阶段；每次 Renderer 改动后运行 `npm run check` 与 `npm run typecheck:renderer`。实现由子代理承担，任务间无依赖的尽量并行。

## 任务一：建立重构基线与测试夹具
- [x] Read `AGENTS.md`、`apps/ravel-desktop/package.json`、`src/renderer/App.tsx`、`src/renderer/store/useAppStore.ts`、`src/renderer/ipc/client.ts`。
- [x] Create `apps/ravel-desktop/test/renderer-surface-state.test.mjs`：`surfaceMode` 默认 `chat`、`agent.mode` 与 `surfaceMode` 不互相覆盖。
- [x] Create `apps/ravel-desktop/test/renderer-event-ordering.test.mjs`：旧事件判定按 `generation → runtimeEpoch → sequence`。
- [x] 记录当前行为（默认 Chat、session 切换、streaming、worker recovery、Graph stale、PTY 生命周期、drawer focus、主题同步）；不改变 IPC 协议/事件字段/主进程代码。
- [x] 验证：
  ```text
  node --test apps/ravel-desktop/test/renderer-surface-state.test.mjs apps/ravel-desktop/test/renderer-event-ordering.test.mjs
  ```

## 任务二：统一 Ravel 视觉 token
- [x] Modify `src/renderer/styles/global.css`、`src/renderer/theme/tokens.ts`、`tailwind.config.ts`；Read/adjust `test/base-ui-migration.test.mjs`。
- [x] 颜色/背景/边框/状态色/圆角/阴影/动效统一到 `--ravel-*`；保留亮/暗/system 主题；业务颜色只从 CSS Variables 读取。
- [x] `tokens.ts` 只保留几何与动效常量及 `var(--ravel-*)` 映射类型，不再新增 `omega` 颜色源；Tailwind 4 CSS-first token，不改第二套 `omega` 色板。
- [x] 持久化 key 统一为 `ravel-shell-layout-v1`、`ravel-theme`，仅在迁移入口读一次旧 key。
- [x] 验证：业务代码不新增 `#hex`/`rgb()`/`hsl()` 颜色与 `--omega-*` 新引用。

## 任务三：拆分 App 协调层
- [x] Create `app/AppBootstrap.tsx`、`app/AppEventBridge.tsx`、`app/AppKeyboardShortcuts.tsx`、`lib/events/event-ordering.ts`、`lib/events/agent-event-reducer.ts`、`lib/events/transport-event-reducer.ts`；Modify `App.tsx`。（`app/SurfaceRouter.tsx` 留待任务四面值齐备后创建）
- [x] `App.tsx` 收敛为组合组件；`refreshControlPlane`/`startNewSession`/settings 同步迁入 `AppBootstrap`，保留现有并发与 idle transcript reconcile。
- [x] 事件 `switch` 拆成可测 reducer/handler，保留 background session、generation/runtimeEpoch/sequence、stream bucket、optimistic message 逻辑。
- [x] 快捷键迁入 `AppKeyboardShortcuts`，沿用 `DEFAULT_KEYBINDINGS`/`matchesKeybinding`，不得硬编码。
- [x] `SurfaceRouter` 仅按 `surfaceMode` 返回 `ChatSurface`/`IdeSurface`/`HistosSurface`。（chat 已接，ide/histos 为占位，待任务六/七替换）
- [x] 验证：`npm run typecheck:renderer`，`node --test` 两个 renderer 新测试。

## 任务四：重构统一 Shell
- [x] Create `shell/RavelShell.tsx`、`ShellHeader.tsx`、`ShellSurfaceTabs.tsx`、`ShellLayout.tsx`、`ShellRail.tsx`、`ShellOverlayHost.tsx`；Modify `components/layout/Workbench.tsx`、`TitleBar.tsx`、`LeftNav.tsx`、`store/useAppStore.ts`。
- [x] 自 Workbench 保留三栏 grid、resize handle、折叠、Focus Mode、compact drawer、`inert`、宽度持久化。
- [x] 统一 Chrome：标题栏、Ravel monogram、工作区、分支、三模式 tabs、主题、Freeze Context、账户、更多菜单。
- [x] 活动栏提供 chat/history/files/graph/search/extensions/settings，统一 `data-nav-key` 与 `data-active` 状态来源。
- [x] 增加 `surfaceMode` 到 store（默认 `chat`），不复用 `agent.mode`/旧 `rightTab` 作表面选择；所有按钮 hover/focus-visible/aria-label，drawer 打开时背景 `inert` + 焦点恢复。
- [x] 验证：renderer 类型检查与现有布局/overlay 测试。

## 任务五：落地 Chat Surface
- [x] Create `surfaces/chat/ChatSurface.tsx`、`SessionSidebar.tsx`、`ChatTranscript.tsx`、`ChatComposer.tsx`、`useChatSurface.ts`；Modify/reuse `components/chat/ChatPanel.tsx`、`MessageList.tsx`、`ToolCard.tsx`、`Composer.tsx`。
- [x] 组合会话列表/中央消息流/Composer/上下文抽屉；保留 message start/end、text/thinking delta、tool execution、compaction、abort、retry、optimistic、后台 activity。
- [x] 长列表用 TanStack Virtual；streaming 用现有 `stream-live.ts` 与批处理，不逐 token 写全局 store；工具卡保留 queued/running/success/error、展开与输出访问。
- [x] 空态/错误/重试/无权限/worker 重连/上下文占用可见。
- [x] 验证：Chat 事件 reducer、session、stream 与 Electron smoke 测试。

## 任务六：落地 IDE Surface
- [x] Create `surfaces/ide/IdeSurface.tsx`、`EditorTabs.tsx`、`EditorGroup.tsx`、`WorkspaceTree.tsx`、`BottomPanel.tsx`、`useIdeSurface.ts`；Reuse/modify `components/files/*`、`components/panels/*`、`components/common/SnippetEditor.tsx`。
- [x] 用文件读取 IPC 与受控 DTO 实现文件树/tabs/CodeMirror/Diff/Worktree/终端；Renderer 不得 import `node:fs`/`node:path`/`node:sqlite`/`node-pty`/Pi SDK。
- [x] CodeMirror EditorView、Xterm 实例与高频输出留在组件/hook，不进全局 Zustand；保留路径 containment、trust、Diff snapshot stale 防护、PTY resize/kill 清理。
- [x] 验证：文件、Diff、PTY、Electron security 与 renderer model 测试。

## 任务七：落地 Histos Surface
- [x] Create `surfaces/histos/HistosSurface.tsx`、`HistosToolbar.tsx`、`HistosGraphWorkspace.tsx`、`HistosInspector.tsx`、`HistosFlowDrawer.tsx`、`useHistosGraphQuery.ts`、`useHistosContextActions.ts`；Reuse `components/panels/GraphPanel.tsx`、`GraphCanvas.tsx`；Modify `store/useAppStore.ts`。
- [x] 拆分 GraphPanel 的查询/selection/view state/context actions/flow actions，由 HistosSurface 组合；保留 React Flow + ELK worker，不提前引入 Canvas 2D。
- [x] 工具栏：lens、节点/边统计、Refresh、Rebuild、Freeze Context、布局切换；导入条显示 hash/URL/构建进度。
- [x] Inspector：节点摘要、证据、关联边、transcript 跳转、Convert to Flow / Run Flow / Schedule / Suggest。
- [x] 执行路径唯一：`GraphRevision → Convert to Flow → Validate → Approval → Pi 执行 → JSONL facts`，语义图不能直接运行。
- [x] 确认 SQLite 仅在 Histos host/worker 使用，Renderer 只消费 Graph DTO。
- [x] 验证：Histos import/index/process/canvas/suggest/flow 相关测试。

## 任务八：整理 IPC client 与类型边界 ✅
- Modify `ipc/client.ts`；Create `ipc/agent-client.ts`、`session-client.ts`、`workspace-client.ts`、`git-client.ts`、`pty-client.ts`、`histos-client.ts`；Modify `types/dto.ts`；Read/verify `electron/preload.js`、`ipc-registry.js`、`ipc-schemas.js`。
- 保留 `ipc` 聚合导出；DTO 无凭据/内部句柄/未净化路径/完整 thinking/过大 PTY 输出；每个查询带 request key/epoch，旧返回不覆盖当前状态。
- 不新增未经 preload allowlist、schema、sender 校验的通道。
- 验证：IPC schema、high-risk、security runtime、renderer model 测试。

## 任务九：完善状态 slice 与持久化 ✅
- Modify `store/useAppStore.ts`；Create `store/slices/chromeSlice.ts`、`surfaceSlice.ts`、`sessionSlice.ts`、`ideSlice.ts`、`histosSlice.ts`、`store/selectors.ts`。
- 保留单一 Zustand 实例按 slice 组织；全局 store 只存跨组件的轻量状态（surface/session/transcript/agent/selected graph node/layout/overlay）；UI-local 状态留在 hook。
- selector 精确订阅，避免 streaming 触发 IDE/Histos 重绘；迁移入口读旧布局 key 一次，统一写 `ravel-shell-layout-v1`。

## 任务十：端到端、无障碍与性能验收 ✅
- Create `e2e/shell-modes.electron.spec.mjs`、`chat-streaming.electron.spec.mjs`、`ide-files.electron.spec.mjs`、`histos-graph.electron.spec.mjs`；Modify `test/renderer-model.test.mjs`、`electron-security.test.mjs`、`histos-canvas.test.mjs`。
- Shell：默认 Chat、三模式切换、active session 保持、drawer focus、Escape 恢复、Focus Mode、缩放。
- Chat：optimistic、streaming merge、message_end 替换、tool states、recovery、后台 unread。
- IDE：文件树、分页读取、搜索、Diff stale、Worktree、PTY 生命周期。
- Histos：lens、stale graph response、ELK layout、位置恢复、节点 Inspector、freeze、Convert to Flow 审批门。
- 无障碍：landmark、tab 语义、dialog `aria-modal`、`aria-live`、键盘导航、非颜色状态表达、reduced motion。
- 性能：80 tok/s 不全局重绘、200 条消息虚拟滚动、500 节点图谱可操作、10k JSONL rebuild 不冻结 UI、Xterm 输出不入 Zustand。
- 验证：按项目规则运行 `npm run check`；Electron/Playwright 仅运行指定场景；不运行 `npm run build`/完整 `npm test` 除非用户另行要求。

## Task Dependencies
- 任务一（基线/夹具） → 任务二、三
- 任务二（token） → 任务四（Shell）
- 任务三（协调层/SurfaceRouter） → 任务四、五
- 任务四（Shell） → 任务五/六/七（三 Surface）
- 任务八（IPC 边界）与任务九（store slice）可与任务五/六/七并行推进
- 任务十（验收）收敛全部并行任务后执行