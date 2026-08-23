# Omega Desktop 实施状态与剩余路线图

> 更新日期：2026-08-23
> 当前分支：`feat/omega-runtime-foundation`
> 最近提交：`8d225e53e feat(omega): add safe viewer modes`
> 当前验证：Electron syntax、Renderer TypeScript、Vite build、offline SDK smoke、桌面安全测试 **109/109**、release gate 均通过。
>
> Omega 保持 Electron Main → utilityProcess Worker → preload → React Renderer 架构；不迁移 Next.js/Tauri，不把 Pi CLI 交互直接复制成 slash command。

## 1. 产品与安全边界

- Pi JSONL / `SessionManager` 是 session、消息、tree、时间戳和分支的权威源。
- Omega 只持久化桌面设置、窗口状态、草稿、workspace allowlist、event cache 和必要 UI 缓存。
- Renderer 不拥有 raw filesystem、Git、凭据或 Pi SDK 访问权限。
- 所有特权操作经过 Main sender 校验、路径安全层和受控 DTO。
- 桌面能力优先使用侧栏、面板、Dialog、原生文件选择器、上下文菜单和系统通知。
- Git Review 是事后审查，不冒充执行前权限系统。
- 资源中心只接受本地安装；npm/git/http/ssh 联网安装明确拒绝。

## 2. 已完成归档

### 2.1 Workspace、路径和 Project Trust

- `electron/path-security.js` 统一 realpath containment、symlink/junction 防护、`..`/绝对路径拒绝和父目录校验。
- workspace registry 使用 `workspaceId / realRoot / displayPath`，持久化授权 allowlist，自动 prune 无效路径。
- Project Switcher 支持原生目录选择器、workspace 添加/切换/移除和切换后状态刷新。
- Project Trust 支持 trust once / always / never，未信任项目资源 dormant。
- Trust Center 支持集中查看所有工作区、批量设置信任决策和父目录继承提示。

### 2.2 Session authority、历史列表和消息分页

- Pi JSONL 是正常 session list/load/tree/transcript 的唯一权威源。
- `electron/session-reader.js` 直接扫描 JSONL，不启动 live AgentSession；按授权 workspace 过滤。
- session 列表支持 `{ items, total, nextOffset, treeIndex }` 分页、workspace/worktree 根目录分组、parent/child 关系和加载更多。
- `omega:readSessionMessages` 支持历史消息按 `sessionId / offset / limit` 分页，并使用 `mtime:size` 缓存。
- Chat MessageList 支持从磁盘加载更早消息并去重 prepend。
- 当前实时消息仍由 Pi `SessionManager` 负责，Omega 不维护第二份 transcript authority。

### 2.3 Worker、事件和关闭生命周期

- WorkerHost 状态：`starting / ready / stopping / dead / restarting`。
- Worker RPC 绑定 generation；迟到 response/event 被丢弃，pending RPC 在 Worker 失效时统一 reject。
- Prompt queue 绑定 generation，切换 session/workspace 时不会串 prompt。
- Worker 关闭顺序固定为 `abort → bounded flush → dispose → kill`。
- 运行中关闭提供等待、停止并退出、取消；flush 超时提供继续等待/强制退出风险提示。
- Worker ready 后先拉 authoritative snapshot，再按 session/run/generation/sequence 过滤事件。
- event cache 按 session 持久化到 `userData/event-cache`，支持内存为空时恢复和 `limit/nextAfter` replay 分页。
- WorkerSlot pool 默认 cap=3、idle TTL=5 分钟，支持后台运行状态、空闲回收、同 workspace 空闲 slot 复用、只读 `omega:sessionRpc` 和 unref health check。

### 2.4 Shared IPC 与安全协议

- `electron/ipc-registry.js` 是 invoke/push channel allowlist；Main handler、preload invoke 和 registry 有双向同步测试。
- `electron/ipc-contracts.js` 与 `src/shared/ipc-contracts.ts` 共享 channel/error vocabulary 和 IpcResult envelope。
- `electron/worker-protocol.js` 校验 Worker init/request/response/event envelope。
- 仍保留历史 handler 的兼容性参数形状；完整 JSON Schema 迁移属于后续质量增强，不影响当前边界。

### 2.5 桌面工作台、Git 和 FileViewer

- Session Sidebar：搜索、workspace/worktree 分组、running/unread/failed/compacting、父子 session、Clone、重命名、删除和加载更多。
- Session Tree：上下文预览、确认后 rewind、fork/clone、busy 防护。
- Worktree Manager：列表、原生目录选择器创建、dirty 删除确认。
- Git Review：snapshot token、stage/unstage、hunk 校验、commit、reject 和 stale snapshot 防护。
- FileViewer：源码/Markdown、行号、选区引用 `@file:start-end`、Reveal in Folder、多标签、图片/音频/PDF 受限预览、大文件按行分页、diff 视图、Mermaid/LaTeX 安全源码预览、Main `fs.watch` 实时刷新。
- Mermaid/LaTeX 当前只做源码安全预览，不执行 HTML、脚本或任意外部内容。

### 2.6 配置、生态和 Extension UI

- Model Center 第一轮：provider/model 列表、API key 添加/删除/测试选择；Electron `safeStorage` 优先，Renderer 不接触明文凭据。
- Skills/Plugins Center：列表、搜索、本地安装/移除、启用/禁用、skill model invocation、资源 reload；联网安装拒绝。
- Extension UI bridge：
  - Dialog：`select`、`confirm`、`input`、`editor`
  - Snackbar：`notify`
  - Header/status：`setStatus`
  - Chat surface：`setWidget`
  - title/composer：`setTitle`、`setEditorText`、`pasteToEditor`
  - 支持 session/run/generation、超时、取消和 Worker 重启清理
- Permission profiles：Trusted、Workspace-only、Read-only、Ask before command；Pi tool-call 执行前 guard 阻止写入、越界路径和未确认命令。

### 2.7 Native integration、Updater 和验证

- single-instance lock、second-instance focus。
- workspace/session 启动参数和 `omega://` 深链解析。
- window bounds 恢复、多显示器越界修正。
- renderer crash/unresponsive 处理、原生通知、open/save/reveal 基础能力。
- Updater core：semver、HTTPS-only manifest、受控文件名、SHA-256/size 校验、临时文件、原子 rename、单飞下载和失败清理。
- Windows electron-builder 目标为 unpacked `dir`，不使用 NSIS。
- `scripts/release-gate.mjs` 和 `scripts/electron-smoke.mjs` 已提供离线发布门禁。

## 3. 当前验证门禁

```text
Electron Node syntax check: 通过
Renderer TypeScript check: 通过
Vite renderer build: 通过
Offline SDK event projection smoke: 通过
Desktop/security tests: 98/98 通过
Release gate: 通过
git diff --check: 通过
```

真实 provider smoke 只有显式设置以下环境变量才运行：

```bash
OMEGA_LIVE_PROVIDER=1 npm run --workspace=@omega/desktop sdk-check
```

已知非阻塞项：Renderer bundle 约 883 kB，可通过面板级动态导入继续拆包。

## 4. 剩余任务

### 4.1 本地可继续完成

优先级 P1：

- thinking/tool detail 延迟读取已完成：ThinkingBlock 按 entryId 加载并缓存，ToolCard 展开时按 toolCallId 读取 args/result；首屏仍使用受控摘要。
- retry 中间状态已记录 attempt/maxAttempts/delay/error 到受限 sessionRecovery；更复杂的跨重启自动继续执行仍不启用。
- 删除父 session 时的非级联安全行为、右键菜单、重命名、复制 session ID 和删除已完成；孤立子 session 会被 Sidebar 提升为根节点。
- Git Review 已支持窗口 focus/30 秒自动刷新，并在 stale snapshot 时自动重取快照、提示重新选择；Worktree 更细粒度审查状态仍可继续增强。
- Worktree 按项目聚合会话、remote/fetch 需要跨 worktree/网络边界，暂列外部或后续增强。
- FileViewer DOCX 预览、上传及冲突处理。
- Model Center 自定义 provider/base URL/headers、model discovery、延迟测试和 catalog/recommendation。
- Skills/Plugins package 内部资源过滤编辑、安装进度展示。
- `electron/ipc-schemas.js` 已覆盖 workspace/session/file/replay/sessionRpc 常用入口；完整 JSON Schema 迁移到所有历史 handler 仍可继续推进。

优先级 P2：

- 语言设置；统一 keybindings 设置中心已支持命令中心/新建会话/停止 Agent 三个快捷键的 typed desktop settings 配置。
- 可选关闭到托盘策略。
- Renderer bundle 动态拆包和性能优化。
- Permission profile 的 Docker/Gondolin/WSL sandbox backend。

### 4.2 外部环境依赖

以下内容不能在当前“不联网、不需要 NSIS”的本地环境中诚实标记为完成：

- 真实 GitHub Release 检查/更新 UI。
- 更新下载进度、重启安装和回滚恢复。
- Windows Authenticode、macOS notarization。
- 完整 Electron 黑盒 E2E 和真实 unpacked launch smoke。
- CI dependency audit、release manifest 发布流水线。
- OAuth provider、真实在线 model discovery 和 live provider smoke。
- Git remote/fetch。

Updater 的本地安全核心和 release gate 已完成，但不会自动联网或安装更新。

## 5. 后续实施顺序

1. 更复杂的 retry 跨重启自动继续执行仍不启用。
2. Worktree 更细粒度审查状态、stale snapshot 自动刷新；跨 worktree 聚合与 remote/fetch 等待明确环境边界。
3. FileViewer DOCX/watch/upload conflict。
4. Model Center 自定义 provider/discovery/latency。
5. 完整 IPC JSON Schema 迁移和性能拆包。
6. 只有在允许联网、签名和 CI 发布环境后，才实施真实 updater UI、OAuth、remote/fetch 和完整 release E2E。

## 6. 明确不做

- 不迁移 Next.js。
- 不迁移 Tauri。
- 不把三个 example 项目直接拼接。
- 不把桌面内置功能全部实现成 `/xxxx`。
- 不把 Git 事后 diff 审查冒充执行前权限系统。
- 不把真实 provider/network smoke 的失败伪装成成功。
- 不在离线约束下伪造联网安装、OAuth、remote fetch、签名或发布成功。
