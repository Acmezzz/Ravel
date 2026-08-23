# Omega Desktop 实施状态与路线图

> 更新日期：2026-08-23
> 当前分支：`feat/omega-runtime-foundation`
> 当前状态：Milestone A 已完成，Milestone B 第一轮基础设施已完成。Project Trust、Session Sidebar 活动状态、IPC 注册表、会话列表分页、WorkerSlot pool、Model Center 第一轮、typed desktop settings、Session Tree/Clone、Worktree Manager、FileViewer 第一轮和 Plugins/Skills 资源中心第一轮已落地。后续进入 Extension UI、权限 profile 与产品化。
>
> Omega 保持 Electron Main → utilityProcess Worker → preload → React Renderer 架构，不迁移 Next.js/Tauri，也不把原生 CLI 交互直接复制成 slash command。

## 1. 产品边界

- Pi JSONL / `SessionManager` 是会话、消息、tree 和时间戳的权威源。
- Omega 只保存桌面偏好、窗口状态、草稿、workspace allowlist 和必要缓存。
- Renderer 无直接文件系统、Git、凭据或 Pi SDK 访问权限。
- 桌面能力优先通过侧栏、面板、Dialog、原生窗口、通知和上下文菜单实现。
- slash command 仅保留扩展命令、skill、prompt template 和少量文本快捷方式。
- Git Review 是事后审查，不冒充执行前权限系统。

## 2. 已完成归档

以下内容已经落地，不再作为待办重复追踪。

### 2.1 路径、workspace 与文件安全

- 新增 `electron/path-security.js`，统一 realpath containment 检查。
- 拒绝绝对路径、`..`、symlink/junction 越界和不存在目标的父目录逃逸。
- workspace 文件列表、读取和索引经过统一安全层，并限制文件大小、深度和数量。
- 新增 `electron/workspace-registry.js`。
- workspace 使用真实根目录归一化，并持久化 allowlist。
- 原生目录选择器可加入授权 workspace。
- 未授权 workspace 不进入 session 列表，也不能创建新 session。
- 运行中的 session 禁止静默切换 workspace/session。

### 2.2 会话 authority 与 disk-first preview

- Pi JSONL 成为正常 session list、load、tree 和 transcript 的唯一权威。
- 移除 Omega transcript JSON 作为 session list fallback。
- 本地 persistence 写入使用临时文件 + rename。
- session ID 白名单、记录大小上限、expected ID 校验已加入。
- manifest 之外的缓存记录不会被删除。
- 新增 `electron/session-reader.js`。
- 历史列表直接扫描 JSONL，读取 header、`session_info`、首条用户消息、消息数量、时间戳和父 session。
- 历史列表不启动 live AgentSession，并按已授权 workspace 过滤。

### 2.3 Worker 生命周期与关闭保护

- WorkerHost 具备 `starting / ready / stopping / dead / restarting` 状态。
- 监听 Worker `message`、`error`、`exit`。
- Worker 失效时统一拒绝 pending RPC。
- RPC 绑定 generation，迟到响应被丢弃。
- 自动重启次数有限制。
- Worker prompt queue 绑定 generation。
- Worker 重启会携带目标 `sessionId`，恢复同一个 Pi JSONL session。
- Worker 提供 `flush`。
- 运行中关闭提供“等待完成 / 停止并退出 / 取消”。
- 停止路径执行 `abort → bounded flush → dispose → kill`。
- 空闲关闭不弹确认，重复关闭受到保护。

### 2.4 Git Review 安全

- Git snapshot 返回短期 `snapshotToken`。
- stage、unstage、reject 只能使用当前 workspace 的有效 token。
- 文件路径和 hunk 必须存在于服务端快照，不能注入任意 patch。
- Git patch 通过 stdin 传递，不经过 shell 拼接。
- token 记录并校验 HEAD、index、Git status 和快照文件内容 hash。
- 快照生成后工作区被外部修改时返回 `stale_diff_snapshot`。
- untracked 文件删除仍然需要桌面二次确认。

### 2.5 Extension state 与事件可靠性

- projectKey 由主进程当前 cwd 推导，不信任 renderer 的项目身份。
- taskId 有字符集和长度限制。
- workflow/scout 状态只读取受控 DTO。
- 不向 renderer 暴露 scout `rawOutput` 或备份片段。
- Agent 事件携带 `sequence / sessionId / runId / generation`。
- Renderer 丢弃错误 session、旧 generation 和倒序事件。
- Worker 恢复 ready 后 renderer 重新拉取 authoritative snapshot。

### 2.6 IPC 契约与 smoke

- 新增 `src/shared/ipc-contracts.ts`。
- 新增 `electron/ipc-contracts.js`。
- 已统一第一轮 IPC channel、错误码和 IpcResult envelope vocabulary。
- Main 已校验 Worker RPC envelope。
- SDK smoke 已拆为 offline projection 和可选 live provider smoke。
- 默认不会把 provider/network 缺失误报为 SDK 功能失败。

## 3. 当前验证结果

最近一次完整验证：

- Electron Node syntax check：通过。
- Renderer TypeScript check：通过。
- Vite renderer build（`build:renderer`）：通过。
- 桌面和安全测试：**90/90 通过**。
- Offline SDK event projection smoke：通过。
- `git diff --check`：通过。

Live provider smoke 仅在显式设置以下环境变量时运行：

```bash
OMEGA_LIVE_PROVIDER=1 npm run --workspace=@omega/desktop sdk-check
```

已知非阻塞构建提示：renderer bundle 约 883 kB，后续可通过面板级动态导入拆包。

## 4. 当前未完成事项

### P0：补齐第一轮基础设施的产品化细节

#### 4.1 Workspace Project Switcher

已完成第一轮：Header 已接入 Project Switcher，可查看授权 workspace、通过原生目录选择器添加 workspace，并在空闲时切换到新 session。

仍需完善：

- workspace DTO 已完成第一轮：`workspaceId / realRoot / displayPath`，并兼容旧字符串 allowlist 文件。Project Switcher 使用稳定 workspaceId 渲染和切换。
- 切换 workspace 后已刷新 models、commands、extensions、Git snapshot、文件树和设置资源清单。
- Project Trust Dialog 已落地：Trust once / always / never，未信任时项目资源 dormant，决策写入 Pi `trust.json`。
- workspace 删除、移动、权限变化后 registry 会 prune，并支持从 Project Switcher 移除非当前工作区。
- Project Switcher 和会话列表会标明当前工作区；未信任项目显示「资源休眠」。

#### 4.2 关闭状态 UI 与测试

主进程关闭保护和 flush 超时风险提示已完成第一轮，但还缺：

- renderer 已区分 `closing / flushing / exiting` 三个阶段，并分别显示停止、保存会话和退出状态；Main 已发送对应 transport 状态。
- 关闭期间 Composer、模型/思考设置、分支、工作区切换和队列操作均被锁定。
- flush 超时后的用户可见风险提示和强制退出按钮仍待做。
- close Dialog 决策映射和 abort → flush → dispose → kill 顺序已有自动化测试。
- flush 阶段进度条仍待做。

#### 4.3 Worker 恢复后的 snapshot reconcile

精确 session 恢复已完成，但还缺：

- Worker ready 后先读取 authoritative snapshot，再决定是否按 session 回放最近事件；空闲快照不重复追加历史事件，gap 时保留权威快照并提示重新同步。
- Worker ready 后会把 queue、tree、compaction、model、usage 和 transcript 纳入同一份 authoritative snapshot；空闲恢复不重复追加历史事件。
- 未确认发送的 prompt 只提示用户手动重发，不自动重放。
- restart failure 已有可操作错误界面：自动重启失败后 Header 提供「重试 Worker」，不再吞掉 `.catch(() => {})`。
- Worker 崩溃前运行状态、未读状态和错误原因的持久化仍待做。

### P1：可靠多会话工作台

#### 4.4 Event snapshot/replay

事件 envelope、Main 最近事件缓存和 renderer ready 后补发已完成第一轮，但还缺：

- Main 最近事件缓存已完成按 session 分区和 gap 检测第一轮。
- renderer 已在 Worker ready 后先拉 authoritative snapshot，再按 session 请求补发；仅流式恢复状态回放，gap 时保留快照并提示重新同步。
- 仍需扩大缓存持久化、补发分页和窗口重新激活流程。
- reload、窗口重新激活和 Worker restart 后的 snapshot/replay 流程。
- snapshot 已包含 transcript、model、thinking、queue、compaction、usage、session tree；retry 未完成状态和窗口重新激活仍需完善。

#### 4.5 Shared IPC runtime schema

静态 channel/error vocabulary 已完成第一轮：

- 新增 `electron/ipc-registry.js`，作为 INVOKE/PUSH channel allowlist。
- main `ipcMain.handle`、preload `ipcRenderer.invoke` 与 registry 有双向同步测试。
- renderer/main 共享 `IPC_CHANNELS` 已覆盖窗口控制和 trust/retry 通道。
- 仍缺：preload、main、renderer 共用的运行时 schema。
- 仍缺：Worker init/request/response/event 的统一 schema。
- 仍缺：统一错误码到所有 handler 的迁移。

#### 4.6 Disk-first session reader 完善

第一轮 JSONL 摘要读取已完成：

- mtime + size cache 已完成第一轮内存缓存。
- `omega:listSessions` 返回 `{ items, total, nextOffset, treeIndex }` 分页对象。
- Session Sidebar 支持「加载更多」，store 以 replace/append 合并分页。
- session tree 磁盘索引已按 parentSessionId 生成 `treeIndex`。
- 仍缺：历史消息按页加载。
- 仍缺：请求合并、大量 session 的后台扫描和取消。

#### 4.7 Session WorkerSlot pool

第一轮已落地：

- `electron/worker-pool.js` 维护 `Map<sessionId, WorkerSlot>`，默认 cap=3、idle TTL=5 分钟。
- 前台 session 立即切换；后台 running session 保留独立 Worker。
- 空闲 slot 可被回收；全部忙碌时返回 `worker_cap_exceeded`。
- load/switch 已有 session 会激活已有 slot，前台忙碌时再开新 slot。
- 关闭路径会对所有 slot abort/flush。
- 仍缺：同 workspace 复用策略、stale slot 主动健康检查、后台 slot 的独立 RPC 入口（当前 RPC 仍走前台 worker）。

### P1：桌面工作区和会话体验

- Session Sidebar 第一轮已完成：workspace 分组、当前工作区、unread/running/失败/压缩中、parent/child 缩进；当前会话可 Clone。
- Session Sidebar 仍缺：按 worktree 分组、完整右键菜单、删除父 session 时安全重挂。
- Session Tree 第一轮已落地：单击预览将继承的上下文、双击/确认后 rewind、busy 时禁止破坏性切换、Clone 当前分支。
- FileViewer 第二轮已落地：源码/Markdown 预览、行号、选区 `@file:start-end` 引用、Reveal in Folder、多标签、图片/音频/PDF 受限预览、大文件按行分页加载。仍缺 diff 模式、Mermaid/KaTeX/DOCX、文件 watch/live refresh、上传冲突处理。
- Worktree Manager 第一轮已落地：列表、创建（原生目录选择器）、删除、dirty 二次确认；仍缺 remote/fetch 和按 worktree 聚合会话。
- Git stale snapshot 自动刷新和更细粒度审查状态。

### P1：配置与生态

- Model Center 第一轮已落地：Header / Command Palette 打开桌面对话框，列出 provider、添加/替换/删除 API key、搜索并选择模型。明文 key 不回显、不返回 renderer。
- Electron `safeStorage` credential vault 已落地，并同步写入 Pi `modelRuntime.setRuntimeApiKey`，Agent 实际可用。
- 仍缺：OAuth 登录/登出、自定义 provider/base URL、model discovery、延迟测试、catalog/recommendation。
- Project Trust Dialog 第一轮已完成；完整 Trust Center（批量管理、父目录继承 UI）仍待做。
- Skills/Plugins Center 第一轮已落地：Header / 设置 / Command Palette 打开资源中心；可列表、搜索、启用/禁用、本地安装/移除、重载当前会话、切换 skill 模型可见性。npm/git 联网安装被拒绝。仍缺：联网更新、安装进度、package 内部资源过滤编辑。
- Extension UI bridge 第一轮已落地：Worker 绑定 Pi RPC UI context；select/confirm/input/editor 使用桌面 Dialog，notify 使用 Snackbar，status/widget/title/editor text 使用受控 renderer surface；请求支持 session/run/generation、取消和超时。暂不支持 TUI custom/footer/header/editor factory。
- 权限 profile 第一轮已落地：Trusted、Workspace-only、Read-only、Ask before command。设置保存在 typed desktop settings，并同步到所有 live Worker；Pi tool-call 执行前 guard 负责阻止写入、越界路径和未确认命令。可选 Docker/Gondolin/WSL backend 仍待做。

### P2：产品化与发布

- Typed desktop settings 第一轮已落地：`electron/desktop-settings.js` 管理 theme、worker cap/TTL、right panel、last session/workspace、window bounds；Settings Dialog 可改 worker 上限。
- Typed desktop settings 第一轮已落地：`electron/desktop-settings.js` 管理 theme、worker cap/TTL、right panel、last session/workspace、window bounds 和 permission profile；Settings Dialog 可改 worker 上限及权限 profile。
- Native integration 第一轮已落地：single-instance lock、second-instance focus、workspace/session 启动参数与 `omega://` 深链解析、window bounds restore、多显示器越界修正、renderer crash/unresponsive 事件处理、原生通知和 open/save/reveal 基础能力。
- 仍缺：语言和 keybindings 的统一权威边界、关闭到托盘策略。
- GitHub Release updater、下载进度、校验、失败恢复和忽略版本。
- Windows Authenticode、macOS notarization、版本 manifest。
- Electron E2E、electron-builder installer smoke、updater smoke、dependency audit 和 CI release gates。

## 5. 下一步实施顺序

1. Extension UI native bridge、权限 profile。
2. Model Center OAuth/custom provider/discovery、FileViewer 多媒体预览、native integration。
3. updater、签名发布和 Electron E2E。
4. 历史消息分页第一轮已落地：Main 通过 disk-first session reader 按 sessionId/offset/limit 返回受控消息页，使用 mtime:size 缓存；实时会话仍以 Pi SessionManager 为权威。仍缺 Renderer 聊天滚动触发的完整历史拼接和 thinking/tool detail 延迟读取。
5. IPC runtime schema、Worker 协议统一、WorkerSlot 同 workspace 复用和后台 session-specific RPC。

## 6. 明确不做

- 不迁移 Next.js。
- 不迁移 Tauri。
- 不拼接三个 example 项目。
- 不把桌面内置能力全部实现成 `/xxxx`。
- 不把 Git 事后 diff 审查冒充执行前权限系统。
- 不把真实 provider/network smoke 的失败伪装成 SDK 功能成功。
