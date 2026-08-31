# Checklist（P0–P8 全路线）

## Phase 0：P0 追溯层 + 质量门禁

- [x] T0.1：`histos-schema.js` 含 `tombstones` 表与 `tombstones_target_lookup` 索引；字段与设计定稿一致（id 8-hex / target_kind 闭集 / target_id / reason ≤512 / created_at / revoked_at）
- [x] T0.1：旧库重开自动补表（`IF NOT EXISTS`），`validateHistosSchema()` 通过，既有数据完好；`test/histos-tombstones.test.mjs` 覆盖
- [x] T0.2：`archiveEntries(kind, ids, reason)` / `restoreEntries(tombstoneIds)` 实现且幂等
- [x] T0.2：归档后 `graphRows` / `queryFacts` / `getNode` / `suggestContext` 四条读路径均不可见；复原后重现且 `revoked_at` 留痕
- [x] T0.2：`kind='approval'` 节点及其关联 triple 归档被拒绝（fail-closed）；JSONL 原文未被归档改动
- [x] T0.3：归档 → `rebuild`（临时库 → swap）→ 对象仍不可见；墓碑在重建后库中存在
- [x] T0.4：`purgeEntries(kind, ids)` 物理删行 + 工件文件删除；审批账目拒绝单独抹除；JSONL 内敏感内容给出会话级删除提示
- [x] T0.4：`purge_record` 事实经 main → agent worker → `session-facts.js` 单写者落 JSONL；`test/histos-purge.test.mjs` 覆盖
- [x] T0.5：`omega:histosArchive` / `omega:histosRestore` / `omega:histosPurge` 三通道六方同步（ipc-contracts / ipc-schemas / ipc-registry / main / preload / dto+client）
- [x] T0.5：三通道通过 allowlist + sender 校验 + preload 双重校验；`test/histos-ipc.test.mjs` 与 `test/electron-security.test.mjs` 断言更新
- [x] T0.5：`on_entries_archived` / `on_entries_restored` / `on_entries_purged` 事件经 worker → Main → renderer `histos:event` 推送
- [x] T0.6：`graphRows` 支持 `created_at` + `revision_parents` DAG 的 asOf 过滤；`histosGetGraph` 可选 `asOf`；新 revision 后旧时点只返回旧版；`fact_triples` asOf 行为不变
- [x] 门禁：`npm test --workspace=@ravel/desktop` 0 fail（3 个 PortableGit checkpoint 失败已修复，事后 `rev-parse --verify` 与 fail-closed 语义保留）
- [x] 门禁：根 `npm run check` 全部通过（含 `packages/ai` `tsc --noEmit` 0 错误，仅类型/注册修正无行为变化）

## Phase 1：P1 config_changed 事实

- [x] `session-facts.js` 含 `config_changed` 事实类型（domain 七值闭集 + action 三值 + id + reason），单写者路径
- [x] `histos-fact-derivation.js` 含映射；Fact Graph triple 覆盖全部 domain；重启后从 JSONL 可重建配置变更时间线
- [x] 六写入点均落事实：资源安装/卸载/启停/frontmatter、权限规则增删、Project Trust 决策、MCP 增删/启停/OAuth、模式切换、provider 配置变更
- [x] `mcp_config` 节点投影接线（画布可见 MCP 配置节点）

## Phase 2：P2 Fact Graph 表面 UI

- [x] `HistosInspector` 含"事实"页签：triple 列表 + 按谓词/时间/来源过滤；从选中节点可查关联 triples
- [x] `HistosToolbar` 显示 triple 统计（`histosFactStats`）
- [x] 归档/抹除右键入口：归档含 reason 输入、抹除有不可逆二次确认；操作后画布/列表即时消失且可撤销（消费 `on_entries_*` 事件即时刷新）
- [x] e2e：从图节点查到关联 triples；归档一条 triple 后即时消失并可撤销

## Phase 3：P3 策略共创循环

- [x] 草案生成：`createStrategyDraft` 引擎方法 + 三重校验（注：无 Histos 对话 UI 入口；2026-08-31 审查标注"引擎就绪、产品未接线"）
- [x] 草案校验：schema/权限/预算三重校验，失败 fail-closed
- [x] 人审批准门：未批准草案不可运行（无 Run 入口）；批准落 `agent_spec` 工件新 revision
- [x] 实例化：批准后出现在 agent_spec 图上且可 `invokeNode` 规划（注：引擎+测试完成；无 IPC/UI 触发点，2026-08-31 审查标注为"引擎就绪、产品未接线"）

## Phase 4：P4 repo source 适配器

- [x] `histos-repo-source.js` 存在并注册进引擎：目录结构 + import/require 解析 + README/docs 抽取 + 语言检测
- [x] `nodeId = workspaceId + 相对路径`；contentSha256 变更出新 revision 且旧版可查
- [x] clone 项目索引后画布出现模块地图；模块摘要可蒸馏并冻结成 ContextSet 附加到新会话（注：`omega:histosIndexRepo` 六方同步但渲染层零调用点，需 UI 接线后用户才可达）

## Phase 5：P5 观测与其余

- [x] `diagnostic_observed` 事实按 absPath 去重入 Fact Graph
- [x] `fact_triples` FTS5 全文索引可用（关键词命中）
- [x] GoalState 接 worker 主流程：`appendGoalStateFact` + `runAutonomousGate` 生效，goal 续跑受 round-cap 预算封顶
- [x] 费用 usage triple 可查；token/耗时/估算成本显式缺失语义保持

## Phase 6：P6 图会话与编辑闭环

- [x] 选区会话：框选节点一键开会话，prompt 默认只含 L0 骨架 + L1 凝练（体积可验证，近零成本）
- [x] `histos_expand` 注册进 `agent-bridge.js` TOOLS：LLM 按需拉取 span 级原文；预算上限超限 fail-closed 并提示缩减选区
- [ ] Inspector"展开原文"用户通道（分页式）——**未实现**（2026-08-31 审查确认）
- [x] 对话式编辑 skill：新版本 → 人审 → 原子替换（tmp+rename）→ 新 revision 入图；旧版可经 P0 归档语义回滚；未批准草稿不落盘替换
- [ ] 图选区直接生成 skill 草稿——**未实现**（2026-08-31 审查确认）
- [x] compaction 摘要嵌入 FactAddress/节点 id 锚点；`histos_expand` 全会话生效；压缩后 LLM 可取回具体原文细节
- [x] 压缩前可选冻结 ContextSet；压缩前后 token 占用可见对比；压缩全程不破坏 FactAddress 回溯

## Phase 7：P7 能力运作流程 + 项目知识

- [x] skill/extension/MCP 内容解析为"触发条件 → 执行步骤 → 产出"结构化工件
- [x] 内容 hash 变更重解析出新 revision；画布能力节点挂流程视图（注：为 push API `applyCapabilityFlows`，无监听/无画布流程视图；无生产调用方，2026-08-31 审查标注"引擎就绪、产品未接线"）
- [x] AGENTS.md / `.ravel/` 规则 / 上下文源版本化入图：版本链 + 生效范围 user/project + 蒸馏摘要
- [x] 全部新工件可归档（P0 语义）

## Phase 8：P8 成果浏览 + handoff

- [x] 工件库能力（`listArtifacts` 引擎方法 + handoff 冻结）；面板 UI 未接线（2026-08-31 审查标注"引擎就绪、产品未接线"）
- [x] handoff 管线：交接文档以 compaction entry 落盘；busy（compaction 进行中）时明确拒绝（防竞态）
- [x] 交接文档可冻结为 ContextSet 跨会话附加

## 不变量（全路线逐周期复核）

- [x] `session-facts.js` 仍为 JSONL 唯一写者；Histos Engine 不写 facts；renderer 无直接 fs/Git/SQLite/node-pty 访问
- [x] SQLite 仍可删可重建（`rebuild = 重扫源 + 重放墓碑`）；审批 fail-closed 未放宽
- [x] 语义图无直接 Run 入口：Convert → Validate → Approval → Pi 管线全程有效；未批准草案/草稿不可运行、不落盘替换
- [x] 凭据明文未入 Histos；易变运行时状态只入事件流

## 诚实口径与文档

- [x] 未把 relay/dry-run/fake runner/接口存在/测试通过写成生产接入；`skill-inject` / `orchestrator` / durable memo 保持未接线状态（需用户决策）
- [x] 真实 provider / 嵌套 Sub Flow UX / 超窗收缩 UX / crashReporter 上传保持独立验收标注，离线测试未伪造成功
- [x] 每周期收口更新 `docs/ravel-histos-next-cycle.md`（HEAD、测试计数、完成状态）与 `docs/ravel-feature-inventory.md`；无平行状态文档
- [x] 分类学六大类（记忆/能力/策略/成果/账目与观测/配置）全部子类在 P0–P8 覆盖核对完成

## 提交纪律

- [x] 每个 Task 独立提交（不混提交）；提交前跑该任务验收命令
- [x] 用户未提交内容（`.workbuddy/`、`verify-packaged.mjs`、`ravel-ui-refresh/`）未被 add / 回滚 / 修改
- [x] 全局收口（Task 30）验证序列全绿：`npm run build:offline` / `typecheck` / `typecheck:renderer` / `npm test --workspace=@ravel/desktop` / `npm run check` / `git diff --check`
