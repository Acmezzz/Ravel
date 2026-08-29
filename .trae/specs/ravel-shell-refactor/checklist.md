# Checklist — Ravel Shell 前端重构

> 逐条核对代码/行为后打勾。任一失败则回写 tasks.md 新增修复任务，修复后重新核对。

## 基线 / 协调层
- [x] 任务一：新增两个 renderer 纯函数测试通过；`surfaceMode` 默认 `chat`；事件排序按 `generation → runtimeEpoch → sequence`。
- [x] 任务一：未改变 IPC 协议、事件字段或主进程代码。
- [x] 任务三：`App.tsx` 收敛为组合组件（Provider/Bootstrap/事件桥接/快捷键/Shell/overlay host）。
- [x] 任务三：事件 `switch` 已拆为可测 reducer/handler，保留 background session、stream bucket、optimistic、recovery 逻辑。
- [x] 任务三：`SurfaceRouter` 仅按 `surfaceMode` 返回三 Surface，不复用 `agent.mode`。（chat 已接，ide/histos 为占位）

## 视觉 token
- [x] 任务二：颜色/背景/边框/状态色/圆角/阴影/动效统一到 `--ravel-*`；`tokens.ts` 不再新增 `omega` 颜色源。
- [x] 任务二：业务代码无新增 `#hex`/`rgb()`/`hsl()` 颜色与 `--omega-*` 引用；Tailwind 4 使用 CSS-first token。
- [x] 任务二：持久化 key 收敛为 `ravel-shell-layout-v1` / `ravel-theme`，旧 key 仅在迁移入口读一次。

## 统一 Shell
- [x] 任务四：三栏 grid、resize handle、折叠、Focus Mode、compact drawer、`inert`、宽度持久化均保留。
- [x] 任务四：统一 Chrome（monogram、工作区、分支、三模式 tabs、主题、Freeze Context、账户、菜单）。
- [x] 任务四：活动栏提供 chat/history/files/graph/search/extensions/settings，`data-nav-key`/`data-active` 一致。
- [x] 任务四：按钮 hover/focus-visible/aria-label；drawer 打开时背景 `inert` + 焦点恢复。

## 三 Surface
- [x] 任务五：Chat 组合会话列表/消息流/Composer/上下文抽屉；保留 message start/end、delta、tool、compaction、abort/retry、optimistic、后台 activity。
- [x] 任务五：长列表 TanStack Virtual；streaming 用 `stream-live.ts` 批处理，不逐 token 写全局 store；工具卡状态完整；空态/错误/重试/无权限/恢复可见。
- [x] 任务六：IDE 实现文件树/tabs/CodeMirror/Diff/Worktree/终端；Renderer 无 `node:fs`/`node:path`/`node:sqlite`/`node-pty`/Pi SDK 引用。
- [x] 任务六：CodeMirror/Xterm/高频输出留在组件/hook；路径 containment、trust、Diff stale 防护、PTY resize/kill 清理保留。
- [x] 任务七：Histos 组合 lens/统计/Refresh/Rebuild/Freeze/布局切换 + 导入条（hash/URL/进度）。
- [x] 任务七：Inspector 含节点摘要/证据/关联边/transcript 跳转/Convert to Flow/Run Flow/Schedule/Suggest。
- [x] 任务七：图谱仅经 `GraphRevision → Convert to Flow → Validate → Approval → Pi 执行 → JSONL` 执行；SQLite 仅在 Histos host/worker。
- [x] 任务七：保留 React Flow + ELK worker，不引入 Canvas 2D。

## IPC / 状态
- [x] 任务八：`ipc` 聚合导出保留；DTO 无凭据/内部句柄/未净化路径/完整 thinking/过大 PTY 输出；查询带 request key/epoch。
- [x] 任务八：无新增未经 preload allowlist、schema、sender 校验的通道。
- [x] 任务九：单一 Zustand store 按 slice 组织；UI-local 状态留在 hook；selector 精确订阅避免跨表面重绘。

## 验证 / 验收
- [x] 任务十：Shell 三模式切换、active session 保持、drawer focus、Escape 恢复、Focus Mode、缩放通过。（e2e/refactor/shell-modes）
- [x] 任务十：Chat/IDE/Histos 各自 Electron 场景（optimistic、streaming merge、Diff stale、PTY、lens、stale graph、Convert to Flow 审批门）通过。（e2e/refactor/chat-streaming、ide-files、histos-graph）
- [x] 任务十：无障碍（landmark、tab 语义、`aria-modal`、`aria-live`、键盘导航、非颜色状态、reduced motion）满足。
- [x] 任务十：性能门槛（80 tok/s 不全局重绘、200 条虚拟滚动、500 节点图谱、Xterm 不入 Zustand）满足；10k JSONL rebuild 需 Electron 实测。
- [x] 最终：`npm run check` 全绿；`npm run typecheck:renderer` 通过；仅运行指定场景的 Electron/Playwright 测试；未运行 `npm run build`/完整 `npm test`。
- [x] 界面视觉与用户上传的三模式设计参考一致（对话/IDE/Histos）。