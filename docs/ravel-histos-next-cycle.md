# Ravel × Histos 当前状态与执行入口

更新日期：2026-08-30
基线：`main`

本文是当前唯一的项目状态入口。状态依据当前源码、桌面测试和仓库质量门禁；历史计划、竞品报告和旧测试数字不覆盖本文。未经过真实环境验证的能力不标记为生产完成。

## 1. 产品边界

Ravel 是本地优先的 Electron 编码 Agent 工作台；Pi JSONL、Git 工作区以及 skill/plugin 文件是事实权威。Histos 是同一事实之上的可删索引、内容寻址工件和受控投影，不是第二套 transcript、审批库或 Agent runtime。

```text
Renderer（无原生权限）
  → Main（窗口、IPC、路径安全、Git、凭据路由）
    → Agent utilityProcess（Pi session 与事实写入）
    → Histos utilityProcess（node:sqlite、索引、工件、图/Flow）
    → PTY utilityProcess（node-pty）
```

必须保持：`contextIsolation`、无 `nodeIntegration`、CSP、IPC allowlist、路径 containment、审批 fail-closed、`session-facts.js` 单一事实写者。SQLite 可以删除并从事实和 durable artifacts 重建；画布不是权威。

## 2. 当前已实现能力

### 2.1 Agent 与桌面

- Pi JSONL 会话、消息、树、fork/clone/navigate、压缩和恢复。
- Agent worker 生命周期、代际隔离、事件 replay、PTY 隔离和 bounded DTO。
- 四档权限、Project Trust、持久 per-tool allow/prompt/deny 规则；规则不能突破安全底线。
- Git snapshot、stage/unstage、hunk 校验、commit、worktree、checkpoint（当前 PortableGit 环境仍有失败测试，见 §5）。
- 本地 skill/plugin 资源中心；安装、编辑、启停和 frontmatter 修改均受授权根与原子写入约束。
- MCP stdio、streamable HTTP、OAuth callback 和 safeStorage vault；在线资源 registry 采用暂存、SHA 展示和人工安装。
- Plan 文件与 `plan_exit` 人审、Goal round-cap continuation、只读 task/subagent（同 worker、共享模型运行时，最大深度 2，最长 10 分钟）。

### 2.2 Histos 数据与投影

- `FactAddress`、12 类事实来源、revision DAG、Evidence M:N、可删 `index.sqlite`、SHA-256 GraphRevision / FlowRevision / ContextSet / ViewState 工件。
- 结构图投影、网页资源抓取与图投影、资源蒸馏接口、同工作区建议 ContextSet、跨工作区仅按已 freeze ContextSet SHA 导入。
- 语义凝练成本/节点/字符上限和 `semantic_provider_unavailable` fail-closed；Histos worker 的 provider relay 通过 Main 转发到 Agent worker。
- GraphRevision 结构化 diff：`added`、`removed`、`changed`、`moved`、`rerouted`。
- Convert → Validate → 持久审批事实 → Pi `session.prompt`；语义图本身无 Run 入口。
- Agent capability/spec 图、agent-loop 执行桥、workflow `flow-engine` 执行路径、DAG 波次、并发上限、超时、取消、memoKey 计算和仅复用已成功结果的内存接口。
- eval_result 规范化、SHA 地址、GraphRevision 投影与持久化；token、耗时、估算成本字段保持显式缺失语义。
- 定时 Flow 与预授权触发：每次触发记录 `flow_trigger`，按 scope、maxRuns 和 busy 状态 fail-closed。
- Fact graph（2026-08-30，借鉴 oh-my-pi Mnemopi / prime-agent Refinement）：`FactGraphBackend` 契约（`histos-fact-graph.js`）+ sqlite 后端（`histos-sqlite-fact-graph.js`，同库 `fact_triples` 表）+ 事实派生投影（`histos-fact-derivation.js`）。`applySessionFacts` 派生 triple（best-effort，失败不回传）；引擎暴露 `queryFacts` / `writeFacts` / `factStats` / `clearFacts`；IPC 四通道 `omega:histos{QueryFacts,WriteFacts,FactStats,ClearFacts}`；Histos 事件总线（`histos-event-bus.js`，BeforeX/AfterX 命名）经 worker → Main → renderer `histos:event` 推送。`operation_finished` 支持可选 `previousStateRef` + `appliedEdits`。GoalState / AutonomousGate 契约落点 `goal-state.js`（未接 worker 主流程）。

### 2.3 当前明确未完成或未宣称

以下项目不能从“代码存在”推导为完整生产能力：

- `skill-inject` executor 在 `histos-capability.js` 中明确 `wired: false`；只读 dry-run/规划能力不等于 skill 注入生产接入。
- `orchestrator` executor 明确 `wired: false`；DAG 规划、memoKey 和测试 fake runner 不等于 workflow orchestrator 已接入桌面生产路径。
- memo 目前是 `runOrchestration` 的注入式 `memoStore`/`memoLookup`/`memoWrite` 接口；未形成 durable memo 产品或持久事实协议，不能声称 memo durable 完成。
- 真实模型、OAuth provider、网络下载、远端 registry、Git remote/fetch、签名、公证和发布流水线未在本地门禁中验证。
- 嵌套 Sub Flow 的完整交互 UX、超窗后的用户收缩引导、crashReporter 上传仍未完成。

## 3. 关键文件落点

| 区域 | 入口 |
|---|---|
| Agent 运行时 | `apps/ravel-desktop/electron/worker.mjs` |
| 事实单写者 | `apps/ravel-desktop/electron/session-facts.js` |
| Histos 主进程桥 | `apps/ravel-desktop/electron/histos-host.js` |
| Histos worker/引擎 | `apps/ravel-desktop/electron/histos-worker.mjs` / `histos-engine.js` |
| capability 规划 | `apps/ravel-desktop/electron/histos-agent-spec.js` / `histos-capability.js` |
| Agent loop 执行桥 | `apps/ravel-desktop/electron/histos-agent-loop-executor.js` |
| orchestration 纯执行器 | `apps/ravel-desktop/electron/histos-agent-orchestrator.js` |
| eval 规范化与图投影 | `apps/ravel-desktop/electron/histos-eval.js` |
| Web source 适配器 | `apps/ravel-desktop/electron/histos-web-source.js` |
| Flow 校验 | `apps/ravel-desktop/electron/flow-validation.js` |
| Fact graph 契约/后端/派生 | `apps/ravel-desktop/electron/histos-fact-graph.js`、`histos-sqlite-fact-graph.js`、`histos-fact-derivation.js` |
| Histos 事件总线 | `apps/ravel-desktop/electron/histos-event-bus.js` |
| Goal/预算门控契约 | `apps/ravel-desktop/electron/goal-state.js` |
| 主进程 IPC 注册 | `apps/ravel-desktop/electron/main.js`、`ipc-registry.js`、`ipc-schemas.js` |
| Renderer 类型与桥 | `apps/ravel-desktop/src/renderer/types/dto.ts`、`src/renderer/ipc/client.ts` |

持久数据位于 Electron `userData/ravel/histos/<workspaceId>/`：`index.sqlite` 是可删索引，`artifacts/<sha256>.json` 是内容寻址工件。不要把 `.workbuddy` 项目数据目录与运行时 userData 混淆。

## 4. 验证快照

### 已通过

- `npm run --workspace=@ravel/desktop typecheck`：通过。
- `npm run --workspace=@ravel/desktop typecheck:renderer`：通过。
- Histos/Agent/eval/web/IPC 相关测试：已纳入桌面测试套件并通过（含 fact-graph / event-bus / goal-state 新测试，244 项核心子集全绿）。
- 根 `npm run check`：biome、pinned-deps、ts-imports、shrinkwrap、install-lock 全部通过；`tsc --noEmit` 在 `packages/ai` 存在 11 个基线错误（`cloudflare-ai-gateway.ts` 流类型与 kimi-k2.6 等 ModelId 注册），与桌面端无关。

### 当前失败

执行 `npm test --workspace=@ravel/desktop` 得到 **442 tests：439 pass、3 fail、0 cancelled**。3 个失败均在 `checkpoint-service.test.mjs`，错误为 PortableGit 的 `git update-ref` 返回成功但没有持久化 `refs/ravel/checkpoints/...`；代码已做事后 `rev-parse --verify` 并按 fail-closed 抛错。该问题不能记录为测试全绿。

### 运行建议

```bash
npm run build:offline
npm run --workspace=@ravel/desktop typecheck
npm run --workspace=@ravel/desktop typecheck:renderer
npm test --workspace=@ravel/desktop
npm run check
git diff --check
```

需要真实 provider、网络、签名或打包时，必须显式注明外部环境，并单独记录结果；离线测试不得伪造成功。

## 5. 下一步

1. 修复并复验当前 PortableGit checkpoint 持久化失败；保持事后验证和 fail-closed。
2. 清除 `histos-web-source.js:199` 未使用变量，使根质量门禁恢复绿。
3. 为 capability / orchestration 决定实际生产接入边界；在接线前继续明确 `skill-inject`、`orchestrator` 和 durable memo 未完成。
4. 补真实 provider、嵌套 Sub Flow、超窗收缩 UX、crashReporter 上传的独立验收；不把测试 fake runner 当生产证据。
5. 维持文档单一入口；更新时同步 HEAD、测试计数和失败原因，删除过时快照而不是复制旧路线图。

## 6. 不变量与禁止事项

- 不把 SQLite、Graph、ContextSet 或 memo 当成 JSONL/Git/资源文件的替代权威。
- 不允许语义图绕过 Convert → Validate → Approval → Pi。
- 不允许 renderer 直接访问 fs、Git、凭据、SQLite、node-pty 或 Pi SDK。
- 不允许未审来源进入 loader，不运行在线资源安装脚本。
- 不允许把 relay、dry-run、fake runner、接口存在或测试通过写成 workflow 生产接入、skill-inject 已完成或 memo durable 已完成。

## 7. 文档关系

- 不变量：[`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md)。
- 信息架构与路线图：[`ravel-histos-design-and-roadmap.md`](./ravel-histos-design-and-roadmap.md)。
- R0–R5 / S2–S4 / 四库借鉴历史骨架（三篇已归档合并）：[`ravel-history-archive.md`](./ravel-history-archive.md)。
- 发布规范：[`ravel-release.md`](./ravel-release.md)。
- 调研/审查原始证据：`../.workbuddy/artifacts/`，仅作证据，不作状态入口。
