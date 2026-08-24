# Omega 桌面端与仓库深度审查报告（2026-08-24）

> 审查方式：Electron 主进程（31 文件 / ~7400 行）、React 渲染层（49 文件）、全仓（1590 git 文件）三路深审 + 逐条源码抽查验证。
> 本文档同时作为修复清单使用，按阶段勾选。

## 总体结论

- 安全架构基本兑现文档红线（CSP / contextIsolation / sandbox / 路径包含检查 / git 参数化调用），但存在 **1 个权限旁路**。
- 测试共 126 个用例（阶段 1 新增 `appendSessionInfo`），当前 **126 通过 / 0 失败**。
- 存在 **5 个已证实的功能性 bug**、**约 30 个死代码符号 / 3 个死模块 / 10+ 冗余文件**。
- 质量门禁盲区：biome / 根 tsgo 均不覆盖 `apps/omega-desktop`；CI 仅 ubuntu，无 Windows 桌面构建。

---

## 阶段 1：测试修复 + 功能 bug（最高优先级）

- [x] T1 `test/renderer-model.test.mjs:475` R5 断言 `/打开资源中心/` 过期（设置页按钮现为「资源中心」）
- [x] T2 `test/custom-provider-ui.test.mjs` 断言 `不会联网 discovery` 过期（现为「本地 Provider 可离线使用」）
- [x] B1 `DiffViewer.tsx:119-124` 文件 Checkbox 同时绑 onClick+onChange 双触发 `onToggleFile`，勾选永远失效 → onClick 仅 stopPropagation
- [x] B2 `SessionInfoDialog.tsx:46` effect 依赖含 `agent` 且内部 `setAgent(新对象)` → getState 无限循环 → 依赖只留 `[open]`
- [x] B3 `FileViewer.tsx:106` 模板串写 `"\\n"`（字面反斜杠+n），翻页内容不换行 → 改真换行
- [x] B4 `SessionList.tsx:104` 右键任意会话重命名实际只改活动会话（`renaming.id` 未使用）→ IPC 链路补 sessionId
- [x] B5 `diff-service.js:50` `/\\r\\n/` 匹配字面量而非 CRLF → 改 `/\r\n/g`

## 阶段 2：安全修复

- [x] S1【高】`omega:bash` 绕过 permission-profile，渲染层可任意执行 shell → Main 在 RPC 前走 `createPermissionGuard`；守卫同时兼容 AgentSession 的 `toolName/input`
- [x] S2【中】`omega:addWorktree` 接受工作区外任意绝对路径 → 限制在已授权根 / repoRoot / 仓库兄弟目录
- [x] S3【中】资源中心可安装任意本地目录为扩展 → 仅允许用户 dialog 选择或已授权工作区内路径
- [x] S4【低】`credential-store.js` Linux 未校验 safeStorage backend → 拒绝 `basic_text`
- [x] S5【低】vault JSON 损坏时静默重建会覆盖全部凭据 → 先备份再报 `vault_corrupt`
- [x] S6【低】打包版保留 F12 开 DevTools → `!app.isPackaged` 包裹
- [x] S7【低】`file-transfer-service.js` realpath 检查与写入间 TOCTOU → 写后 `resolveExisting` 复检

## 阶段 3：正确性修复

- [x] C1 关闭序列进行中第二次 close 不 preventDefault → handling/busy 时一律拦截
- [x] C2 `isInsideWorkTree`/`isTracked` 同步 git 无 timeout → 走带 15s timeout 的 `git()`
- [x] C3 session-reader 三个缓存 Map 永不淘汰 → LRU 上限 200
- [x] C4 `evictToFit` 异步竞态可超 cap → acquire 串行化
- [x] C6 fileWatchers 无上限、切 workspace 不清理 → 上限 16，切工作区/关机清理
- [x] C7 `fileSelections` / `tokenCache` 慢性泄漏 → TTL + 容量上限
- [x] C8 多处 `void promise` 无 catch → 关闭/对话框/shell 补 catch
- [x] C9 worker uncaughtException 后不退出 → `process.exit(1)`
- [x] C10 prompt RPC 复用 120s 超时 → prompt 单独 30 分钟
- [x] C11 `setPermissionProfile` 失败不回滚 → 磁盘与 worker 一并回滚
- [x] C12 删除会话不清理事件缓存 → 清 Map / JSONL / `forgetSessionPath`
- [x] I1 `newPiSession/newSession` 与 `switchPiSession/loadSession` 抽 `createNamedSession`/`loadNamedSession`
- [x] I2 JS/TS ERROR_CODES 漂移 → 对齐 `invalid_prompt` / `not_found`
- [x] I3 preload/ipc-schemas 上限矛盾 → replay 300、git items 200

## 阶段 4：死代码与冗余文件清理

死模块（生产零引用）：
- [x] D1 `electron/persistence.js` 整模块 + main.js 死 import + 对应测试
- [x] D2 `electron/updater-service.js` **保留**（`scripts/release-gate.mjs` 使用 `validateManifest`）
- [x] D3 `electron/provider-latency.js` + 其测试
- [x] D4 `main.js` `normalizeGitItems`、`agentRunning` 死变量（阶段 3 已删）
- [x] D5 `agent-bridge.js` `streamToRenderer` 删除；`forgetSessionPath` 已接入删除会话（阶段 3）
- [x] D6 `ipc-contracts.js` 通道表随 D8 同步（`isIpcEnvelope` / ERROR_CODES 仍为活导出，保留）
- [x] D7 `path-security.js` `isSymlink` 删除；`worker.mjs` `resolveSessionPath` 方法注册删除。`isWorkerInit/isWorkerRequest` 仍被协议测试使用，保留；`DEFAULT_*` 阶段 3 已 un-export

渲染层死代码：
- [x] D8 8 条 IPC 死链路（getForkCandidates/inspectUploadTarget/sessionRpc/listPiSessions/newPiSession/switchPiSession/saveSession/diffWorkspace）整链删除；顺带删除 `listPiSessions`/`forkCandidatesOf`/`computeDiff` 孤儿实现
- [x] D9 store 死导出（usePalette/applyMessageStart/applyMessageDelta/applyToolStart/applyToolEnd）与死 action（setSessions/clearSessionUnread/appendThinkingDelta）、僵尸字段（diff/approval/sessionTreeIndex）
- [x] D10 `tokens.ts` 收敛为 STYLE_NONCE/fontFamily/monoFamily
- [x] D11 global.css 死变量（--omega-shadow/--omega-ease-spring/--omega-dur-slow）；未用 MUI 导入（ThinkingBlock IconButton、ScoutPanel Stack）

遗留文件：
- [x] D12 `apps/omega-desktop/renderer.js` + `styles.css`（React 前原型）
- [x] D13 根 `tui-plan.md`；scripts/ 9 个零引用脚本
- [x] D14 `pi-test.bat`/`pi-test.ps1` 删除；`pi-test.sh` 与 AGENTS.md / README 联动，保留
- [x] D15 **保留** `packages/server`、`packages/evals`（根 `npm run build` / `eval` 仍依赖）

## 阶段 5：质量门禁与文档

- [x] Q1 biome.json include 加 desktop `src/electron/test`，清死条目（packages/mom、`!!` 笔误）；desktop 用 nested biome（关 formatter/organizeImports，避免 180+ 风格重排）
- [x] Q2 根 tsconfig 删除 `packages/agent-old` 映射。desktop 不纳入根 tsgo（JSX + bundler resolution），继续走 `typecheck:renderer`
- [x] Q3 CI：加 Windows desktop job（typecheck + test + release-gate）。`electron-smoke` 依赖 unpacked 产物，不在无打包的 CI job 里跑
- [x] Q4 重写根 README（Omega 简介 + 上游致谢）；CONTRIBUTING/AGENTS/SECURITY 补 Omega 边界说明
- [x] Q5 `apps/omega-desktop/README.md` 结构图更新（删 renderer.js/styles.css）
- [x] Q6 `implementation-status.md` 更新日期/提交/测试数字
- [x] Q7 根 package.json 改名 omega-monorepo（同步 lockfile）；LICENSE 加 Omega 条目

## 阶段 6：性能与体验优化

- [ ] P1 Markdown 流式解析按 rAF/50ms 批量 flush；React.memo + 模块级 components
- [ ] P2 `SessionInfoDialog` 等 getState 轮询收敛；DiffViewer 30s 定时器依赖修复
- [ ] P3 scrollMemory / draft-store Map 修剪；Composer atTimer 卸载清理
- [ ] P4 ExtensionUIHost 非活动会话请求回 cancel，避免 worker 挂起
- [ ] P5 设置自定义快捷键：实现生效或改只读展示
- [ ] P6 可点击 div 补 role/tabIndex/键盘支持（TreeRow/TreeOverlay/FileViewer tabs/ModelPicker 等）
- [ ] P7 Header 思考档位 Chip disabled 无效 → 改受控样式
- [ ] P8 乐观气泡消费后保留 `optimistic-*` id，历史分页去重失效 → 消费时替换为真实 id
- [ ] P9 双 token 体系收敛：bgHover 与 --omega-hover-fill 二选一，palette 死字段清理

## 已核实无问题（无需改动）

- main.js 安全基线：nodeIntegration=false / contextIsolation / sandbox / setWindowOpenHandler 全拒 / 81 个 handler 全带 senderAllowed
- git 调用全部 execFileSync 参数数组，无命令注入；commit message 走 stdin
- 渲染层 80 个 window.omega.* 调用与 preload 一一对应，无拼写漂移
- 组件均为细粒度 store selector，无整店订阅；App 三路事件订阅 cleanup 完整
- .gitignore 覆盖 release/dist/node_modules，无大文件被误跟踪
- localStorage 两个 key 读写自洽
