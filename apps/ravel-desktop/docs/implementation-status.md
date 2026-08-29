# Ravel Desktop 当前实现状态

更新日期：2026-08-29
权威状态入口：[`../../../docs/ravel-histos-next-cycle.md`](../../../docs/ravel-histos-next-cycle.md)

本文只说明桌面端落点和验证命令；完整产品不变量、Histos 契约与未完成边界以仓库根状态文档为准。代码优先于历史快照。

## 1. 当前架构

```text
Renderer（React；无 fs/Git/凭据/SQLite/Node 原生权限）
  → preload 窄桥 + IPC allowlist
  → Main（窗口、路径安全、Git、凭据和进程路由）
    → Agent utilityProcess（Pi runtime、session JSONL、事实单写者）
    → Histos utilityProcess（node:sqlite、索引、durable artifacts、图/Flow）
    → PTY utilityProcess（node-pty）
```

安全基线：`contextIsolation`、无 `nodeIntegration`、CSP、sender 校验、路径 containment、Project Trust、permission profile 和审批成对事实。`apps/ravel-desktop/electron/session-facts.js` 是 durable facts 的唯一写者。

## 2. 已验证的桌面能力

- 会话列表/加载/分页、树导航、fork/clone、压缩恢复、事件 replay 和 worker generation 隔离。
- 四档权限、Project Trust、持久 per-tool 规则、资源中心本地安装与安全编辑。
- Git Review、snapshot/stage/commit、worktree、checkpoint 的 fail-closed 事后校验（checkpoint 在当前 PortableGit 上仍有失败测试）。
- MCP stdio、streamable HTTP、OAuth callback、safeStorage vault；skill/plugin registry 下载采用 staging + SHA + 人审安装。
- Plan 文件 + `plan_exit` 人审、Goal round-cap continuation、只读 task/subagent（深度/时限受限）。
- Histos 图、ContextSet freeze/import/suggest、Flow Convert→Validate→Approval→Pi、结构化 Graph diff、Web source 和 eval_result 投影。
- Histos worker 的 semantic provider relay：worker → Main → 就绪 Agent worker；模型/凭据缺失时返回 `semantic_provider_unavailable`。
- Electron `app://` 加载、renderer typecheck、桌面 IPC/安全测试以及 packaged/migration smoke 入口。

## 3. 不能宣称已完成的能力

- `skill-inject` 在 `electron/histos-capability.js` 中仍为 `wired: false`；接口和 dry-run 不等于生产接入。
- `orchestrator` 仍为 `wired: false`；DAG 规划、memoKey 和 fake runner 测试不等于 workflow 生产编排。
- memo 仅为 `runOrchestration` 的注入式 lookup/write 接口；没有 durable memo 产品或持久事实协议。
- 真实 provider/OAuth/网络 registry/Git remote、签名、公证和发布流水线均未由本地离线门禁证明。
- 嵌套 Sub Flow 交互、超窗收缩 UX、crashReporter 上传仍未完成。

## 4. 当前验证结果

从仓库根执行：

```bash
npm run --workspace=@ravel/desktop typecheck
npm run --workspace=@ravel/desktop typecheck:renderer
npm test --workspace=@ravel/desktop
npm run check
git diff --check
```

本次快照：

- `typecheck`：通过。
- `typecheck:renderer`：通过。
- 桌面测试：442 项，439 通过、3 失败；失败均为 `test/checkpoint-service.test.mjs`，PortableGit `git update-ref` 表面成功但 ref 未落盘，代码事后校验后正确 fail-closed。
- 根 `npm run check`：因 `electron/histos-web-source.js:199` 的 `workspaceId` 未使用警告而失败；需代码任务修复，不能写成全绿。

外部环境依赖请单独记录，不要把 fake runner、relay、dry-run 或接口存在作为生产证据。

## 5. 维护要求

- 修改 Histos/IPC/权限实现时，同步更新根状态文档的文件落点与验证快照。
- 不复活已删除的 Scout/Workflow 假面板，不新增第二套事实/审批/记忆存储。
- 不删除 `.workbuddy` 项目数据、源码、测试、package-lock 或必要构建文件。
- 详细架构历史见 [`system_design.md`](./system_design.md)；该文包含已过时 V1 章节，冲突时以当前代码和根状态文档为准。
