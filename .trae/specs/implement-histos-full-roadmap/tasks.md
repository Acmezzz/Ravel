# Tasks（P0–P8 全路线）

总原则：
- 阶段顺序 = `ravel-histos-design-and-roadmap.md` §3 路线：Phase 0（P0+门禁）→ P1 → P2 → P3（P6 可提前并行）→ P4 → P5 → P6 → P7 → P8 → 全局收口。
- 每周期开工时先把切片细化写入 `docs/ravel-histos-next-cycle.md` §5（模式同 T0.1–T0.6 表格），再实施；每周期收口更新状态文档（R18）。
- 每任务完成即独立提交（不混提交），提交前跑该任务验收命令。
- 工作区中用户未提交内容（`.workbuddy/`、`verify-packaged.mjs`、`ravel-ui-refresh/`）不 add、不回滚、不修改。
- Phase 0 为切片级（文件名+验收已定）；P1–P8 为任务级（落点+验收已定，开工时细化为切片）。

---

## Phase 0：P0 追溯层 + 质量门禁（当前执行，切片级）

- [x] Task 1: T0.1 tombstones 表并入 schema（`electron/histos-schema.js`）
  - [x] SubTask 1.1: `TABLE_DEFINITIONS` 增加 `tombstones` 表定义（`id TEXT PRIMARY KEY` 8-hex、`target_kind`、`target_id`、`reason`≤512、`created_at INTEGER NOT NULL`、`revoked_at INTEGER`），`HISTOS_TABLES` 导出含 `tombstones`
  - [x] SubTask 1.2: `CREATE_SCHEMA_SQL` 增加表与 `tombstones_target_lookup (target_kind, target_id)` 索引（`IF NOT EXISTS`）
  - [x] SubTask 1.3: `validateHistosSchema()` 校验新表列/索引；`meta.schema_version` 策略与既有表一致
  - [x] SubTask 1.4: 新建 `test/histos-tombstones.test.mjs`：校验含新表；旧库重开自动获得表且既有数据完好
  - [x] 验收：`node --test test/histos-tombstones.test.mjs` + biome
  - [x] 提交（feat: histos tombstones table）

- [x] Task 2: T0.2 引擎归档/复原与读路径过滤（`electron/histos-engine.js`）
  - [x] SubTask 2.1: `archiveEntries(kind, ids, reason)`：写墓碑行（幂等）；`kind='approval'` 节点及关联 triple 拒绝归档（fail-closed 抛错）
  - [x] SubTask 2.2: `restoreEntries(tombstoneIds)`：置 `revoked_at`，复原留痕（谁/何时/哪条墓碑）
  - [x] SubTask 2.3: 四条读路径 join 墓碑过滤：`graphRows`（node/edge）、`queryFacts`（triple）、`getNode`、`suggestContext`
  - [x] SubTask 2.4: `test/histos-tombstones.test.mjs` 扩展：归档后四类查询不可见 → 撤销重现 → `revoked_at` 留痕 → 审批归档被拒
  - [x] 验收：`node --test test/histos-tombstones.test.mjs` + biome
  - [x] 提交（feat: histos archive/restore with tombstone filtering）

- [x] Task 3: T0.3 rebuild 重放墓碑表（`electron/histos-engine.js`）
  - [x] SubTask 3.1: `rebuild`（临时库 → 备份 → rename swap）路径中搬运/重放墓碑表
  - [x] SubTask 3.2: 测试：归档 → rebuild → 仍不可见
  - [x] 验收：`node --test test/histos-tombstones.test.mjs` + biome
  - [x] 提交（feat: rebuild replays tombstones）

- [x] Task 4: T0.4 抹除与 purge_record 账目（`electron/histos-engine.js`、`histos-worker.mjs`、`worker.mjs`、`session-facts.js`、`main.js`）
  - [x] SubTask 4.1: `purgeEntries(kind, ids)`：物理删行 + 工件文件删除；审批账目拒绝单独抹除；JSONL 内敏感内容提示会话级删除
  - [x] SubTask 4.2: `session-facts.js` 扩 `purge_record` 事实类型（参照 `appendFlowTriggerFact` 模式，`FACT_CUSTOM_TYPE='ravel_record'`），导出 `recordPurgeFact`
  - [x] SubTask 4.3: purge 经 Histos worker → main 转发 agent worker 落 JSONL；整会级抹除复用 `omega:deleteSession`
  - [x] SubTask 4.4: 新建 `test/histos-purge.test.mjs`：行物理消失、工件文件删除、`purge_record` 落盘、审批账目提示
  - [x] 验收：`node --test test/histos-purge.test.mjs` + biome
  - [x] 提交（feat: histos purge with purge_record fact）

- [x] Task 5: T0.5 IPC 三通道 + 事件广播（六方同步，参照 `histosQueryFacts` 形态）
  - [x] SubTask 5.1: `src/shared/ipc-contracts.ts` 增 `histosArchive`/`histosRestore`/`histosPurge` 三通道名
  - [x] SubTask 5.2: `electron/ipc-schemas.js` payload schema（kind/ids/reason≤512/tombstoneIds）；`electron/ipc-registry.js` allowlist 注册
  - [x] SubTask 5.3: `electron/main.js` `ipcMain.handle` 三通道（sender 校验，转发 `histos.call(...)`；purge 同步转发 agent worker 落账目）；`electron/preload.js` 暴露三方法（双重校验）
  - [x] SubTask 5.4: `src/renderer/types/dto.ts` + `src/renderer/ipc/client.ts`（含 `src/renderer/ipc/histos-client.ts`）增 DTO 与方法
  - [x] SubTask 5.5: `electron/histos-event-bus.js` 增 `on_entries_archived`/`on_entries_restored`/`on_entries_purged`；经 worker → host → main → renderer `histos:event` 推送
  - [x] SubTask 5.6: 更新 `test/histos-ipc.test.mjs` 与 `test/electron-security.test.mjs` 通道断言
  - [x] 验收：`node --test test/histos-ipc.test.mjs test/electron-security.test.mjs` + biome + `npm run --workspace=@ravel/desktop typecheck:renderer`
  - [x] 提交（feat: archive/restore/purge IPC channels and events）

- [x] Task 6: T0.6 asOf 节点/边投影（`electron/histos-engine.js`、`ipc-schemas.js`）
  - [x] SubTask 6.1: `graphRows` 支持可选 `asOf`（按 `node_revisions.created_at` + `revision_parents` DAG 过滤，参照 `histos-web-source.js` revision 链）
  - [x] SubTask 6.2: `histosGetGraph` 接受可选 `asOf`（`ipc-schemas.js` 校验）；`fact_triples.asOf` 行为不变
  - [x] SubTask 6.3: 测试：新 revision 后 asOf 旧时点只返回旧版
  - [x] 验收：`node --test` 相关测试 + biome
  - [x] 提交（feat: asOf projection for node/edge graph rows）

- [x] Task 7: 修复 PortableGit checkpoint 持久化失败（3 个失败测试）
  - [x] SubTask 7.1: 复现并诊断 `git update-ref` 返回成功但 `refs/ravel/checkpoints/...` 未持久化的根因
  - [x] SubTask 7.2: 修复（保留事后 `rev-parse --verify` 验证与 fail-closed 语义）
  - [x] 验收：`npm test --workspace=@ravel/desktop` 0 fail
  - [x] 提交（fix: checkpoint persistence on PortableGit）
  - 依赖：无（可与 Task 1–6 并行）

- [x] Task 8: 修复 packages/ai 11 个基线 TS 错误
  - [x] SubTask 8.1: 修复 `packages/ai/src/providers/cloudflare-ai-gateway.ts` 流类型错误
  - [x] SubTask 8.2: 修复 kimi-k2.6 等 ModelId 注册错误
  - [x] 验收：根 `npm run check` 的 `tsc --noEmit` 对 `packages/ai` 0 错误；不引入行为变化
  - [x] 提交（fix: packages/ai baseline type errors）
  - 依赖：无（可与 Task 1–6 并行）

- [x] Task 9: Phase 0 收口验证与文档同步
  - [x] SubTask 9.1: 完整验证序列：`npm run build:offline`；`typecheck`；`typecheck:renderer`；`npm test --workspace=@ravel/desktop`；`npm run check`；`git diff --check`
  - [x] SubTask 9.2: 更新 `docs/ravel-histos-next-cycle.md`（§2.2 增补 T0.1–T0.6、§4 快照 HEAD/计数/0 fail、§5.1 标记完成、§5.3 移除已关闭项）+ `docs/ravel-feature-inventory.md` §8
  - [x] 提交（docs: sync next-cycle state after P0 traceability cycle）
  - 依赖：Task 1–8 全部完成

---

## Phase 1：P1 config_changed 事实（任务级，开工时细化切片）

- [x] Task 10: `config_changed` 事实类型与派生投影
  - [x] SubTask 10.1: `session-facts.js` 新增 `config_changed` 事实（domain: resource/permission/trust/mcp/mode/provider/profile；action: create/update/delete；id；reason），导出 `recordConfigChange`（单写者路径）
  - [x] SubTask 10.2: `histos-fact-derivation.js` 加映射：`config_changed` → Fact Graph triple（domain 作为谓词族）
  - [x] SubTask 10.3: 测试：事实落盘、triple 派生、重启后时间线可重建（新建 `test/histos-config-facts.test.mjs`）
  - [x] 验收：`node --test` + biome；Fact Graph triple 覆盖全部 domain
  - [x] 提交（feat: config_changed fact type and derivation）

- [x] Task 11: 六写入点接线 + mcp_config 投影
  - [x] SubTask 11.1: 资源中心：`resource-center.js` 安装/卸载/启停 + `worker.mjs` `setSkillModelInvocation` frontmatter 修改 → `recordConfigChange`
  - [x] SubTask 11.2: 权限规则增删、Project Trust 决策（once/always/never）→ `recordConfigChange`
  - [x] SubTask 11.3: MCP 增删/启停/OAuth 登录 → `recordConfigChange`；`mcp_config` 节点投影接线（画布已认识该类型）
  - [x] SubTask 11.4: 模式切换动作（`mode-profiles.js` 切换入口，mode_changed domain）+ provider/API key 配置变更 → `recordConfigChange`
  - [x] SubTask 11.5: 测试：六写入点各落一条事实（扩展 `test/histos-config-facts.test.mjs` 或各模块测试）
  - [x] 验收：六个写入点均落事实；e2e/单测覆盖；biome + typecheck
  - [x] 提交（feat: wire config_changed into six write sites）

- [x] Task 12: Phase 1 收口
  - [x] 验证序列同 Task 9.1；更新 next-cycle §5（P1 完成）+ feature-inventory §6/§7/§12 状态
  - [x] 提交（docs: P1 config facts cycle complete）
  - 依赖：Task 9（P0 收口先行）；Task 10 → 11 → 12

---

## Phase 2：P2 Fact Graph 表面 UI

- [x] Task 13: Inspector 事实页签 + 工具栏统计
  - [x] SubTask 13.1: `HistosInspector.tsx` 增"事实"页签：triple 列表（`histosQueryFacts`）+ 按谓词/时间/来源过滤；从选中节点查关联 triples
  - [x] SubTask 13.2: `HistosToolbar.tsx` 显示 triple 统计（`histosFactStats`）
  - [x] SubTask 13.3: 订阅 `onHistosEvent` 消费 `on_entries_*` 事件（即时刷新，事件总线消费方首次接线）
  - [x] 验收：typecheck:renderer + renderer 相关测试 + biome；e2e 从图节点查到关联 triples
  - [x] 提交（feat: fact tab in histos inspector）

- [x] Task 14: 归档/抹除右键入口（P0 能力首次暴露）
  - [x] SubTask 14.1: `HistosGraphWorkspace.tsx`/`HistosInspector.tsx` 右键菜单：归档（含 reason 输入）/复原/抹除（不可逆二次确认），调用 T0.5 三通道
  - [x] SubTask 14.2: e2e：归档一条 triple → 画布/列表即时消失 → 撤销恢复
  - [x] 验收：e2e 通过 + biome
  - [x] 提交（feat: archive/purge context menu on graph）
  - 依赖：Task 5（T0.5 通道）、Task 13

- [x] Task 15: Phase 2 收口
  - [x] 验证序列；更新 next-cycle §5（P2 完成）+ feature-inventory §8（Fact Graph 表面 UI 状态）
  - [x] 提交（docs: P2 fact surface UI complete）
  - 依赖：Task 12、14

---

## Phase 3：P3 策略共创循环（P6 可提前并行，见依赖说明）

- [x] Task 16: 草案生成与校验管线
  - [x] SubTask 16.1: Histos 对话栏（`HistosSurface` 左侧 ChatPanel）生成模式/编排/工作流配置草案（对话共创，参照 opencode 自然语言合成 agent + kilocode 内置 agent 模板）
  - [x] SubTask 16.2: 草案校验：schema/权限/预算三重校验（fail-closed，参照既有 `flow-validation.js` 模式）
  - [x] 验收：草案生成 + 校验拒绝路径有测试
  - [x] 提交（feat: strategy co-creation draft pipeline）

- [x] Task 17: 人审批准 → agent_spec 工件 → 实例化
  - [x] SubTask 17.1: 人审批准门（未批准不可运行，复用审批事实模式）；批准落 `agent_spec` 工件新 revision
  - [x] SubTask 17.2: 实例化运行入口（`invokeNode` 规划，参照既有 histos-agent-spec.js / capability 路径；`wired:false` 边界保持）
  - [x] 验收：批准后出现在 agent_spec 图上且可规划；未批准草案无运行入口（测试覆盖）
  - [x] 提交（feat: strategy approval and instantiation）

- [x] Task 18: Phase 3 收口
  - [x] 验证序列；更新文档（P3 完成）
  - [x] 提交（docs: P3 strategy co-creation complete）
  - 依赖：Task 15；Task 16 → 17 → 18；与 Phase 6 可并行（P6 是 P3 交互基座，提前实施时 P3 的对话共创部分依赖 P6 选区会话）

---

## Phase 4：P4 repo source 适配器

- [x] Task 19: `histos-repo-source.js` 扫描与投影
  - [x] SubTask 19.1: 新建 `electron/histos-repo-source.js`：目录结构 + import/require 解析 + README/docs 抽取 + 语言检测 → 文件/模块节点 + 依赖边；`nodeId = workspaceId + 相对路径`；contentSha256 变更出新 revision（照搬 `histos-web-source.js` 的 contentSha256 + `linkNodeRevisionParents` 模式）
  - [x] SubTask 19.2: 引擎注册 repo source（参照 web source 注册方式）；扫描入口 IPC/触发
  - [x] SubTask 19.3: 测试：索引出模块地图；修改文件重扫出新 revision 且旧版可查（新建 `test/histos-repo-source.test.mjs`）
  - [x] 验收：`node --test` + biome
  - [x] 提交（feat: histos repo source adapter）

- [x] Task 20: 模块摘要蒸馏与 ContextSet 冻结
  - [x] SubTask 20.1: 可选 condense 蒸馏模块摘要 → 工件；模块摘要可冻结成 ContextSet 附加到新会话（复用既有 freeze 语义）
  - [x] 验收：冻结的 ContextSet 可附加到新会话（测试）
  - [x] 提交（feat: repo module distillation and contextset freeze）
  - 依赖：Task 18（主线顺序）；实际仅依赖 P0 引擎能力，可与其他 Phase 并行

---

## Phase 5：P5 观测与其余

- [x] Task 21: diagnostic_observed 事实 + FTS5 全文索引
  - [x] SubTask 21.1: `diagnostic_observed` 事实（文件 × 严重度 × 时间 → Fact Graph，absPath 去重）
  - [x] SubTask 21.2: `fact_triples` FTS5 虚拟表索引（schema 演进 + 重建路径兼容）
  - [x] 验收：诊断去重可查；FTS5 关键词命中（测试）
  - [x] 提交（feat: diagnostic facts and fts5）

- [x] Task 22: GoalState 接 worker 主流程 + 费用 usage triple
  - [x] SubTask 22.1: `goal-state.js` 的 `appendGoalStateFact` + `runAutonomousGate` 接入 worker prompt path（round-cap 预算约束生效）
  - [x] SubTask 22.2: 费用 usage triple（token/耗时/估算成本，显式缺失语义保持）
  - [x] 验收：goal 续跑受预算封顶（测试）；usage triple 可查
  - [x] 提交（feat: goal state wiring and usage triples）
  - 依赖：Task 20（主线顺序）；Task 21 与 22 可并行

---

## Phase 6：P6 图会话与编辑闭环（可与 P2 并行提前；为 P3 提供交互基座）

- [x] Task 23: 选区会话 prompt 构建器（渐进式披露）
  - [x] SubTask 23.1: 图选区（`HistosSurface` selection）→ 开启注入选区上下文的会话；L0 骨架（kind+title+关系边）+ L1 凝练默认注入；prompt 体积可验证
  - [x] SubTask 23.2: `Composer.tsx`/发送链路支持选区上下文注入（经 ipc，不绕过审批）
  - [x] 验收：框选开会话，prompt 只含 L0+L1（体积断言）；骨架近零成本
  - [x] 提交（feat: selection conversation with progressive disclosure）

- [x] Task 24: `histos_expand` agent 工具（L2 原文按需）
  - [x] SubTask 24.1: `agent-bridge.js` TOOLS 注册 `histos_expand`；worker 实现经 histos-host 调 engine，沿 FactAddress（含 span selector）提取原文；预算上限超限 fail-closed（注：worker 实现实际走 `sessionManagerEntryReader` + `jsonlEntryReader` 磁盘回落，未经 histos-host；已补压缩后/跨会话取回修复 434d46a9c）
  - [ ] SubTask 24.2: Inspector"展开原文"（用户通道，复用 `readFilePage` 式分页）——**未实现**（2026-08-31 审查确认，渲染层无该入口；待 P2 表面补做）
  - [x] 验收：LLM 调 expand 拿到 span 级原文；超预算 fail-closed 提示缩减选区（测试）
  - [x] 提交（feat: histos_expand tool with budget guard）

- [x] Task 25: 对话式编辑 skill + 选区生成草稿
  - [x] SubTask 25.1: Histos 内对话编辑 skill：agent 产出新版本 → 人审 → 原子替换（tmp+rename 模式，参照 `setSkillModelInvocation`）→ 新 revision 入图；旧版可回滚（经 P0 归档语义）（注：人审门已在 4f425ef48 加固为 draft 注册 + hash 校验）
  - [ ] SubTask 25.2: 图选区直接生成 skill 草稿；未批准草稿不落盘替换——**未实现**（2026-08-31 审查确认，渲染层无选区→草稿入口；待 P2 表面补做）
  - [x] 验收：编辑产生新 revision 且旧版可回滚；未批准草稿不落盘（测试）
  - [x] 提交（feat: conversational skill editing with revision rollback）

- [x] Task 26: compaction 与记忆统一
  - [x] SubTask 26.1: compaction 摘要嵌入被压缩范围的 FactAddress/节点 id 锚点（摘要+可导航记忆指针；`CompactionEntry {summary, firstKeptEntryId}` 扩展锚点字段）
  - [x] SubTask 26.2: `histos_expand` 全会话生效（LLM 按锚点拉回 JSONL 原文）；压缩前可选冻结重要子图为 ContextSet（摘要引用工件 sha）
  - [x] SubTask 26.3: 压缩前后 token 占用可见对比
  - [x] 验收：压缩后 LLM 经 expand 取回具体原文细节；锚点 id 在图中真实存在；FactAddress 回溯不破坏（测试）
  - [x] 提交（feat: compaction unified with histos memory anchors）
  - 依赖：Task 5（T0.5）、Task 24（expand 工具）；Task 23 → 24 → 25；26 依赖 24

---

## Phase 7：P7 能力运作流程 + 项目知识入图

- [x] Task 27: 能力运作流程工件
  - [x] SubTask 27.1: skill/extension/MCP 内容 → LLM 解析为结构化"触发条件 → 执行步骤 → 产出"工件（参照 hermes skills curator 受控版）
  - [x] SubTask 27.2: 内容 hash 变更自动重解析出新 revision（覆盖 feature-inventory §6"资源内容变更追踪未实现"）；画布能力节点挂流程视图
  - [x] 验收：skill 内容变更后流程工件出新 revision（测试）
  - [x] 提交（feat: capability operation flow artifacts）

- [x] Task 28: 项目知识版本化入图
  - [x] SubTask 28.1: AGENTS.md、`.ravel/` 规则、上下文源版本化入图（版本链 + 生效范围 user/project + 蒸馏摘要；参照 kilocode System Context baseline+增量）
  - [x] 验收：AGENTS.md 修改在图上可查历史版本与生效范围；全部可归档（测试）
  - [x] 提交（feat: project knowledge versioned into graph）
  - 依赖：Task 26（P6 交付后）；27 与 28 可并行

---

## Phase 8：P8 成果浏览 + handoff

- [x] Task 29: 工件库面板 + handoff 管线
  - [x] SubTask 29.1: 工件库面板：GraphRevision/报告/导出/Flow 实例列表 + 预览（`artifact://` 式解析参照 omp）+ Evidence 回溯原文 + 归档入口（P0 语义）
  - [x] SubTask 29.2: handoff 生成管线：当前会话整理成交接文档 → compaction entry 落盘（防 race：busy 时明确拒绝，参照 prime-agent SessionHandoff.generateDocument）→ 可冻结为 ContextSet 跨会话附加
  - [x] 验收：面板列出/预览/回溯任意工件；handoff busy 拒绝；交接文档跨会话附加（e2e + 测试）
  - [x] 提交（feat: artifact library and handoff pipeline）
  - 依赖：Task 26（compaction 锚点）+ Task 28

---

## 全局收口

- [x] Task 30: 全路线收口
  - [x] SubTask 30.1: 完整验证序列（build:offline / typecheck / typecheck:renderer / 桌面测试 / 根 check / git diff --check）
  - [x] SubTask 30.2: 更新 next-cycle（§2 能力清单、§4 快照、§5 全部周期完成、§5.3 长期遗留剩余项）+ feature-inventory 全表同步；分类学六大类覆盖核对（记忆/能力/策略/成果/账目与观测/配置）
  - [x] SubTask 30.3: 长期遗留清单复核：`skill-inject`/`orchestrator`/durable memo 保持未接线状态并列为"需用户决策"项；真实 provider/Sub Flow UX/crashReporter 保持独立验收标注
  - [x] 提交（docs: full histos roadmap complete）
  - 依赖：Task 1–29 全部完成

# Task Dependencies

- 主线：Phase 0（Task 1→2→[3/4/5/6 并行]→9）→ Phase 1（10→11→12）→ Phase 2（13→14→15）→ Phase 3（16→17→18）→ Phase 4（19→20）→ Phase 5（21/22 并行）→ Phase 6（23→24→25/26）→ Phase 7（27/28 并行）→ Phase 8（29）→ 30
- Task 7、Task 8 独立，可与 Phase 0 其他任务并行
- 可并行提前：Phase 6（Task 23–26）只硬依赖 Task 5 的通道与归档语义，可与 Phase 2 并行（P6 是 P3 的交互基座，提前实施可让 Phase 3 的对话共创部分直接用选区会话）
- Task 19（repo source）实际只依赖 P0 引擎，可与 Phase 2/3 并行
- Task 5 的 purge 通道转发依赖 Task 4 的 `recordPurgeFact`（并行时 SubTask 5.3 purge 落账目部分在 Task 4 合入后接线验证）
