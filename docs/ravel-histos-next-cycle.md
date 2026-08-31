# Ravel × Histos 当前状态与执行入口

更新日期：2026-08-31（终版快照）
基线：`main` @ `fe4417716`（P0–P8 全路线 + 审查修复周期全部完成；基线问题已核完成）

本文是当前唯一的项目状态入口。状态依据当前源码、桌面测试和仓库质量门禁；历史计划、竞品报告和旧测试数字不覆盖本文。未经过真实环境验证的能力不标记为生产完成。P0–P8 执行周期与 2026-08-31 三方审查+修复周期的完整记录已归档至 [`ravel-history-archive.md`](./ravel-history-archive.md) §4/§5；本文只保留当前状态与剩余任务。

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
- Fact graph（2026-08-30，借鉴 oh-my-pi Mnemopi / prime-agent Refinement）：`FactGraphBackend` 契约（`histos-fact-graph.js`）+ sqlite 后端（`histos-sqlite-fact-graph.js`，同库 `fact_triples` 表）+ 事实派生投影（`histos-fact-derivation.js`）。`applySessionFacts` 派生 triple（best-effort，失败不回传）；引擎暴露 `queryFacts` / `writeFacts` / `factStats` / `clearFacts`；IPC 四通道 `omega:histos{QueryFacts,WriteFacts,FactStats,ClearFacts}`；Histos 事件总线（`histos-event-bus.js`，BeforeX/AfterX 命名）经 worker → Main → renderer `histos:event` 推送。`operation_finished` 支持可选 `previousStateRef` + `appliedEdits`。GoalState / AutonomousGate 契约落点 `goal-state.js`，P5 已接 worker 主流程。
- P0 追溯层（2026-08-31，Phase 0 收口）：`tombstones` 表 + `tombstones_target_lookup` 索引并入 schema（`IF NOT EXISTS` 旧库自动补表）；引擎 `archiveEntries(kind, ids, reason)` / `restoreEntries(tombstoneIds)` / `purgeEntries(kind, ids)`，四条读路径（`graphRows`/`queryFacts`/`getNode`/`suggestContext`）join 墓碑过滤，审批节点/triple 归档与单独抹除均 fail-closed 拒绝；`rebuild` 重放墓碑表；purge 经 main 转发 agent worker 由 `session-facts.js` 单写者落 `purge_record` 账目事实（记录级抹除提示会话级删除）；IPC 三通道 `omega:histos{Archive,Restore,Purge}` 六方同步 + 事件 `on_entries_archived/restored/purged` 广播到 renderer；节点/边投影支持 asOf 时间旅行（`created_at` + `revision_parents` DAG，`fact_triples.asOf` 语义不变）。
- P1 配置类（2026-08-31）：`config_changed` 事实（domain 七值闭集 + action 三值 + targetId + reason）经单写者落 JSONL；六写入点接线（资源安装/卸载/启停/frontmatter、权限规则增删、Project Trust、MCP 增删/启停/OAuth、模式切换、provider/API key）；`histos-fact-derivation.js` 按 domain 投影为 `custom_config_<domain>` 谓词族；`mcp_config` 投影接线（`applyMcpConfigs` + content-addressed revision）。
- P2 Fact Graph 表面 UI（2026-08-31）：`useHistosFactPanel`（查询/统计/过滤/归档/复原/抹除 + `on_entries_*` 事件即时刷新）；Inspector「事实」页签（triple 列表 + 关联 triples + 行级归档/抹除）；Toolbar triple 统计；图节点右键归档/抹除菜单（P0 能力首次暴露）。
- P3 策略共创（2026-08-31）：`histos-strategy.js` 草案三重建（schema/权限/预算 fail-closed）；`createStrategyDraft` / `approveStrategyDraft`（批准落 agent_spec 节点新 revision，可 invokeNode；未批准无运行入口；skill-inject/orchestrator 保持未接线拒绝）。
- P4 repo source（2026-08-31）：`histos-repo-source.js` 纯文本启发式扫描（目录结构 + import/require 依赖边 + README/docs 抽取 + 语言检测），`repo:<相对路径>` 内容寻址 revision 链；`omega:histosIndexRepo` 六方同步（root 由 Main 解析授权工作区）；repo 选区可冻结 ContextSet。
- P5 观测（2026-08-31）：`diagnostic_observed`（absPath 去重投影 + `recordDiagnosticObserved` 单写者）、`fact_triples` FTS5 全文索引（`ftsSearch` 短语转义）、GoalState 契约接入 worker 主流程（`createGoalState`/`recordGoalTurn`/`isGoalBudgetExceeded` + `goal_state` 账目事实）、`usage_observed` 费用 triple（token/耗时/成本显式缺失语义）。
- P6 图会话（2026-08-31）：`histos-selection.js` L0 骨架 + L1 凝练 prompt 构建器（体积可验证）+ `expandEvidence` span 级原文提取（预算 fail-closed）；`histos_expand` agent 工具（agent-bridge TOOLS + worker customTool，预算守卫）；`proposeSkillEdit`/`approveSkillEdit` 对话式编辑（草稿不落盘，批准 tmp+rename 原子替换）；`compaction_anchors` 压缩记忆锚点（摘要 + 可导航 entry id）。
- P7 能力与知识（2026-08-31）：`histos-capability-flow.js` 确定性解析 skill/extension/MCP → 触发条件→执行步骤→产出工件（hash 变更新 revision）；`applyProjectKnowledge` 版本化 AGENTS.md/.ravel 规则（版本链 + user/project 生效范围 + 蒸馏摘要，可归档）。
- P8 成果与交接（2026-08-31）：`createHandoff`（交接文档工件，compaction-entry 式，busy 时 fail-closed 拒绝，可冻结 ContextSet 跨会话附加）；`listArtifacts` 工件库；`handoff` 加入 ARTIFACT_KINDS。

### 2.3 当前明确未完成或未宣称

以下项目不能从“代码存在”推导为完整生产能力：

- **P3/P7/P8 与 P4 的引擎方法无生产调用方（用户路径未接线）**：`createStrategyDraft`/`approveStrategyDraft`/`applyCapabilityFlows`/`applyProjectKnowledge`/`createHandoff`/`listArtifacts`/`ftsSearch` 及 `omega:histosIndexRepo` 通道在 2026-08-31 三方审查中确认只有 worker 分发 + 单测，渲染层零调用。spec 已诚实标注“引擎就绪、产品未接线”（`bdde66529`）；是否补 IPC+UI 需产品决策。
- **Task 24.2 Inspector「展开原文」与 25.2 图选区生成 skill 草稿**：渲染层入口未实现（spec 保留未勾选）。
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
- Histos/Agent/eval/web/IPC 相关测试：已纳入桌面测试套件并通过（含 tombstones / purge / asOf / 事件广播新测试）。
- 根 `npm run check` 首步 biome：全绿。两处 fixable（`noUselessTernary` @ `HistosFlowDrawer.tsx`、未用函参 @ `histos-repo-source.test.mjs`）已自动修复；`global.css` 两处 `noDescendingSpecificity` 加无副作用 suppression 豁免（通用/无关选择器层叠结果本正确）。`packages/ai` 原 11 个 TS 错误在现行 HEAD（`fe4417716`）上已不存在（`tsc --noEmit` 全绿）。

### 当前失败

执行 `npm test --workspace=@ravel/desktop`：**553 tests / 553 pass / 0 fail**。原唯一失败 `p1-cjk-lucide.test.mjs` 已修复（同步过期字体栈断言到现行 Geist 优先 + `HarmonyOS Sans SC` 的 CJK 回退 token；CSS 为现行真源，测试曾断言旧 `Noto Sans CJK SC`）。3 个 PortableGit checkpoint 失败已修复（`42169d125`，ref 直接写 loose ref 文件 + `rev-parse --verify` fail-closed）。根 `npm run check` 通过。

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

## 5. 下一步（当前周期：审查修复后的收尾与产品决策）

P0–P8 全路线与 2026-08-31 三方审查+修复周期均已闭环（提交链 `b8ef00dc1` → `22b3ccd6b`，553 tests / 552 pass）。**本节是唯一的前进入口**；执行记录与审查细节已归档（见 [`ravel-history-archive.md`](./ravel-history-archive.md) §4/§5）。

### 5.1 需要产品决策的接线项（引擎就绪，无用户路径）

- **P3 策略共创 / P7 能力流程与项目知识 / P8 成果浏览与 handoff / P4 repo 模块地图**：9 个引擎方法（`createStrategyDraft`/`approveStrategyDraft`/`applyCapabilityFlows`/`applyProjectKnowledge`/`createHandoff`/`listArtifacts`/`ftsSearch`/`buildSelectionPrompt`/`expandEvidence`）与 `omega:histosIndexRepo` 只有 worker 分发 + 单测。选项：(a) 补 IPC + 渲染层入口激活（每项独立切片）；(b) 正式在文档降级为“引擎就绪，产品未接线”。spec 已诚实标注，等产品拍板。
- **Task 24.2 Inspector「展开原文」** 与 **25.2 图选区生成 skill 草稿**：渲染层入口，待补。
- **`recordConfig` 无活动 session 时的持久化策略**：当前静默丢弃（14 处写入点），需决策是否降级持久化。

### 5.2 真实环境独立验收（不把测试 fake runner 当生产证据）

- 真实 provider 端到端（语义凝练、goal 续跑、usage triple）。
- OAuth provider 登录闭环、在线 skill registry 下载、Git remote/fetch。
- 嵌套 Sub Flow 交互 UX、超窗收缩 UX、crashReporter 上传。
- 签名、公证、打包与发布流水线（`ravel-release.md` 门禁）。

### 5.3 基线既有（已核完成，2026-08-31 复查）

1. `p1-cjk-lucide.test.mjs` 字体栈测试失败：**已修复**（同步过期断言到现行 Geist 优先 + `HarmonyOS Sans SC` 的 CJK 回退 token；553 tests 全绿）。
2. `packages/ai` 11 个基线 TS 错误：现行 HEAD 已不存在，`tsc --noEmit` 通过。
3. 根 biome：已全绿（2 处 fixable 自动修复 + `global.css` 2 处 `noDescendingSpecificity` suppression）。

### 5.4 长期遗留（不随 P 周期关闭）

1. 为 capability / orchestration 决定实际生产接入边界；`skill-inject`、`orchestrator` 与 durable memo 保持未接线（草案/编排校验层已按 R17 fail-closed 拒绝这些 executor）。
2. 维持文档单一入口；更新时同步 HEAD、测试计数和失败原因，删除过时快照而不是复制旧路线图。

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
