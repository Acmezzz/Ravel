# Ravel Shell 前端重构 Spec

> 本规范依据已评审的实施计划《[ravel-agent-frontend-implementation-plan.md](../../documents/ravel-agent-frontend-implementation-plan.md)》整理，作为可执行规范。涉及的三模式视觉参考来自用户上传的设计压缩包（对话模式 + IDE + Histos 共 3 个 HTML 页面）。

## Why

当前 Renderer 由 `App.tsx` 同时承担 bootstrap、事件桥接、流式消息归并、transport 状态、快捷键与主题同步，职责过重；`Workbench.tsx` 中栏固定渲染 Chat，无法承载 IDE 与 Histos 两种产品表面。需要将桌面端统一为可切换的 Ravel Shell，让 Chat / IDE / Histos 三种表面共享窗口 Chrome 与 session/workspace 上下文，同时严格保持 Electron 隔离、JSONL 事实权威、Histos utilityProcess 边界与现有 Agent/IPC 行为不变。

## What Changes

- **统一 Shell（新）**：新增 `surfaceMode: "chat" | "ide" | "histos"`（默认 `chat`），`SurfaceRouter` 仅依据 `surfaceMode` 返回对应 Surface，不复用 `agent.mode`。
- **App 协调层拆分（新）**：`App.tsx` 收敛为 Provider/Bootstrap/事件桥接/快捷键/Shell/overlay host 的组合；事件 `switch` 拆为可测 reducer/handler。
- **视觉 token 收敛（改）**：颜色/背景/边框/状态色/圆角/阴影/动效统一到 `--ravel-*` 单一源，`tokens.ts` 只保留几何与动效常量，历史 `--omega-*` 仅在一次性迁移入口读取。
- **三个 Surface（新）**：Chat（会话/消息流/Composer/上下文抽屉）、IDE（文件树/CodeMirror/Diff/Worktree/PTY）、Histos（React Flow + ELK graph、Inspector、Convert to Flow 审批门）。
- **状态切分（改）**：单一 Zustand store 保留，但按 slice 组织；UI-local 状态留在 hook，selector 精确订阅避免跨表面重绘。
- **IPC client 边界整理（改）**：`ipc/client.ts` 保留聚合导出，新增按域 client；DTO 无凭据/未净化路径/完整 thinking/过大 PTY 输出。
- **测试与验收（新）**：新增纯函数与 Playwright Electron 场景测试，建立性能/无障碍验收。

**BREAKING**：`LayoutState` 中旧的 `rightTab` 不被复用为表面选择；布局持久化 key 收敛为 `ravel-shell-layout-v1`；`agent.mode` 与 `surfaceMode` 语义分离。

## Impact

- **Affected specs / 能力**：Chat 事件 reducer、session、stream、IPC 安全、文件/Diff/PTY、Histos 图谱、无障碍、性能。
- **Affected code**：
  - Renderer：`App.tsx`、`store/useAppStore.ts`、`components/layout/Workbench.tsx`、`ipc/client.ts`、`styles/global.css`、`theme/tokens.ts`、`tailwind.config.ts`，以及 `components/chat|files|panels/*` 复用/改造。
  - 新增：`renderer/app/*`、`renderer/shell/*`、`renderer/surfaces/{chat,ide,histos}/*`、`renderer/lib/events/*`、`renderer/store/slices/*`。
  - 测试：`test/renderer-*.test.mjs`、`e2e/*.electron.spec.mjs`、既有 `base-ui-migration/electron-security/renderer-model/histos-*` 调整。
  - **不改**：Electron 主进程、Agent runtime、IPC allowlist、JSONL/worker、Histos host/worker 边界（视为已稳定）。

## 约束（沿用计划假设）

- 不更换 Electron、不服务化本地桌面、不改 JSONL 事实源。
- Base UI 是唯一 headless primitive 家族，不引入 Radix/MUI。
- 生产环境保持 CSP：单 IIFE renderer bundle、外部 CSS、无 inline script、无 HMR dev server。
- Renderer 不得 import `node:fs`/`node:path`/`node:sqlite`/`node-pty`/Pi SDK；SQLite 仅在 Histos worker 侧。
- 不删除现有功能；旧字段（`rightTab` 等）在三表面验证完成后才收敛。

## ADDED Requirements

### Requirement: Ravel Shell 与 Surface Router
系统 SHALL 提供统一 Shell，标题栏包含 Ravel monogram、工作区、分支、三模式 tabs、主题、Freeze Context、账户与更多菜单；活动栏提供 chat/history/files/graph/search/extensions/settings，并使用一致的 `data-nav-key` 与 `data-active` 状态来源。

#### Scenario: 三模式切换
- **WHEN** 用户点击 IDE / Histos / Chat 的表面 tab
- **THEN** 中栏渲染对应 Surface，active session 与 workspace 上下文保持，且 Chat 的 streaming 不触发 IDE/Histos 重绘

### Requirement: surfaceMode 与 agent.mode 分离
系统 SHALL 使用独立 `surfaceMode` 表示产品表面，默认 `chat`；`SurfaceRouter` 不得复用 `agent.mode`。

#### Scenario: 默认表面与互不覆盖
- **WHEN** 应用首次启动且 Agent 处于任意 mode
- **THEN** 默认表面为 Chat，`agent.mode` 变化不影响当前 Surface

### Requirement: 事件排序（generation → runtimeEpoch → sequence）
系统 SHALL 判定旧事件并按该三元组跳过，同时保留 background session、stream bucket 与 optimistic message 逻辑。

#### Scenario: 乱序/重放事件被忽略
- **WHEN** 收到 generation、runtimeEpoch 或 sequence 不大于当前值的旧事件
- **THEN** 该事件被忽略，不覆盖当前状态

## MODIFIED Requirements

### Requirement: App 协调层拆分
`App.tsx` 由单体改为 Provider + `AppBootstrap`（control plane/session 同步）+ `AppEventBridge`（事件 reducer）+ `AppKeyboardShortcuts`（沿用 `DEFAULT_KEYBINDINGS`/`matchesKeybinding`）+ `SurfaceRouter` + overlay host 的组合，行为保持一致。

#### Scenario: 行为不回归
- **WHEN** bootstrap、streaming、worker recovery、快捷键触发
- **THEN** 与拆分前的行为一致，`npm run typecheck:renderer` 通过

### Requirement: 统一视觉 token
`--ravel-*` 作为唯一 token 前缀；亮/暗/system 主题保留；业务代码不得新增 `#hex`/`rgb()`/`hsl()` 与 `--omega-*` 引用；持久化 key 收敛为 `ravel-shell-layout-v1` / `ravel-theme`。

## REMOVED Requirements

### Requirement: 旧 `rightTab` 作为表面选择与 `--omega-*` 色彩源
**Reason**：`surfaceMode` 取代 `rightTab` 承担表面切换；`--omega-*` 在新实现中禁止出现。
**Migration**：`rightTab` 保留用于 IDE 底部面板（diff/graph/worktree/terminal 等）内部 tab；`--omega-*` 仅在一次性迁移读取旧布局/主题 key 时兼容，完成后删除。