# Ravel 历史归档（骨架）

更新日期：2026-08-30
本文是三篇已归档历史文档的精简骨架（原文完整内容见 git 历史）：

- `ravel-histos-refactor-plan.md`（R0–R5 生产计划，794 行）→ 归档于本文件 §1
- `ravel-design-activity-session-reference-mcp.md`（S2–S4 设计，266 行）→ §2
- `ravel-example-agent-borrowing.md`（四库借鉴决策，83 行）→ §3

三篇均已"完成"或被现行为文档取代，保留结论与证据指针，细节从 git 历史查（`git log --follow -- docs/ravel-history-archive.md` 前的对应文件名）。

---

## 1. Histos 生产计划（R0–R5 / H0 / T1–T5）——已全部交付

**结论**：底座（JSONL 事实、Electron 隔离、Pi 运行时）不换；换的是铬件表皮、派生查找层和语义图工件化。产品循环：Anything Addressable → Fact Space → SourceSet+Lens+Granularity → Distillation → GraphRevision → Graph/Flow/Nested Graph → Selection → Conversation/Edit/Skill/Flow/Agent Run → New Facts → Histos。

**切片与验收（全部完成）**：
- R0 虚拟化 + 事件 rAF 批 + skill SHA-256 + checkpoint facts
- R1 React 19 + Tailwind 4 + `--ravel-*` token + 自持原语 + ∞ 图腾
- R2 绞杀 MUI/Emotion/nonce；CSP `style-src 'self' app:`
- R3 Histos Engine utilityProcess + 工作区 `index.sqlite` + FactAddress + Evidence M:N + revision_parents DAG + durable artifacts + ContextSet/`context_attached`
- R4 GraphCanvas + 六类节点 + elkjs worker + 框选 + 节点跳回 transcript；语义图无 Run
- R4.5 Convert to Flow → FlowSpec Draft → Validate → 审批门
- R5 node-pty 仅 PTY utilityProcess、xterm、CodeMirror 仅 SnippetEditor、`asarUnpack`
- `app://` 打包加载协议

**锁定栈（已装齐，不退回）**：Electron 44、Vite 8.2.2 + Rolldown、TS 7.0.2、React 19.2.8 + Compiler、Base UI 1.7.0、Zustand 5.0.8、@xyflow 12 + elkjs、xterm 5.5 + node-pty 1.1.0 隔离、`node:sqlite`。

**关键提交**：T1 `bf455eb7a`、T2 `b538026ae`、T3 `7b99944cd`、T4 `36cfd7b66`、T5 `7a964b1c2`；PTY hang-fix `6ddb87bd1` / `1e89737ee`。

**延续有效的契约**：§7 数据契约（FactAddress、12 类事实来源、Evidence、revision DAG、工件 kind）与 §1 不变量表已并入 [`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md) 与 [`ravel-histos-design-and-roadmap.md`](./ravel-histos-design-and-roadmap.md)；Canvas 2D 远景层的三条实测判据（可见简单节点 >2000、拖拽 P95 >16ms、elk+裁剪+回收不够）仍在。

## 2. S2–S4 设计（动态视图 / @session 引用 / MCP 管理）——已交付

- **S2 动态视图**：跨会话活动行纯投影，零新事实；从 durable facts 派生（restart 路径 `deriveActivityFromFacts`）。
- **S3 @session 引用**：prompt 追加模型可见路由块（`===== BEGIN/END RAVEL SESSION REFERENCES =====`）+ `session_reference` 成对事实；`clientMessageId` 幂等。
- **S4 MCP 管理**：`omega:mcp*` 通道族；stdio + streamable HTTP；OAuth 深链回调；safeStorage 凭据。
- 实施状态（2026-08-26）：三者均已落地并纳入桌面测试；细节被 `ravel-feature-inventory.md` 取代。

## 3. 四库借鉴决策（prime-agent / kilocode / oh-my-pi / opencode）

**立即采纳（已随 N* 交付）**：T1–T5 锁定栈、elkjs worker 布局、审批 UI 模式等。
**基线补齐（2026-08-28 用户拍板"竞品普遍具备的必须有"）**：B1 计划文件+人审 `fd5fb1301`、B2 Goal round-cap `23e12bcf6`、B3 权限规则库 `fa902fdb6`、B4 只读 task 子代理、B8 定时 Flow 等（进度见 `ravel-histos-next-cycle.md`）。
**后续接口位**：handoff 生成管线、advisor 观察者、collab wire（不做区）、magic keywords 注入。
**不采纳（防重复评估）**：HTTP server 形态、第二事实权威、云依赖、图数据库、Radix 双轨、MUI 回潮。
**元收获**：上游同步纪律来自 omp `docs/porting-from-pi-mono.md`；携码出处规范 = 每个借鉴项标注来源文件与许可（MIT，上游 Pi 版权保留）。
**2026-08-30 扩展**：六项目对照（+hermes-agent、deepseek-harness、zed）的完整借鉴清单与内容分类学见 [`ravel-histos-design-and-roadmap.md`](./ravel-histos-design-and-roadmap.md) §1 与路线图各 P 的"借鉴来源"栏。

## 4. P0–P8 全路线执行记录（2026-08-31，已交付归档）

执行规范 `.trae/specs/implement-histos-full-roadmap/`（spec/tasks/checklist 三件套，tasks/checklist 已勾选并诚实标注未接线项）。提交链 `b8ef00dc1` → `99976d1e0`，每 Task 独立提交，覆盖内容分类学 6 大类全部子类：

- **P0 追溯层**：tombstones 表 + archive/restore/purge + 四读路径过滤 + rebuild 重放 + purge_record 账目 + IPC 三通道 + asOf 投影（`b8ef00dc1`/`22534b997`/`cda9fadb3`/`28ac42879`/`29d3070ca`/`6c2717a42`）。
- **门禁修复**：PortableGit checkpoint 持久化（本机 git 2.55.0.windows.3 对嵌套 ref 的 `update-ref` 静默失败且破坏同目录 loose refs → 直接写 loose ref + `rev-parse --verify` fail-closed，`42169d125`）。
- **P1** config_changed 七域事实 + 六写入点 + mcp_config 投影（`4853a0931`/`e097c5deb`）。
- **P2** Fact Graph 表面 UI：事实页签 + 右键归档/抹除（`828b93be9`）。
- **P3** 策略共创三重校验 fail-closed（`4e7a94daf`）。
- **P4** repo source 模块地图 + `omega:histosIndexRepo`（`92d9e3a65`）。
- **P5** diagnostic + FTS5 + GoalState 接 worker + usage triple（`d3cd7eb3a`）。
- **P6** L0/L1/L2 渐进式披露 + histos_expand + 对话编辑 + compaction 锚点（`424e38d1c`）。
- **P7** 能力流程工件 + 项目知识版本化（`99976d1e0`）。
- **P8** createHandoff + listArtifacts 工件库（`99976d1e0`）。
- **收口**：`ca61d87d9`/`86cdf3325`/`95932d7c2`（文档同步至完成态）。

## 5. 三方审查 + 修复周期（2026-08-31，已闭环归档）

工程保障团队（Archi 架构/Cody 代码审查/Tessa 运行取证）对 P0–P8 全路线的独立审查，完整报告见 `deliverables/engineering-assurance/code-review-histos-p0-p8-2026-08-31.md`（含 §11 修复跟进）。核心结论：**546 全绿 ≠ 功能全部正常**——P3/P7/P8 属"引擎就绪、产品未接线"，P5/P6 存在测试通过但行为错误的实质缺陷。修复提交链 `63cf56093` → `bdde66529`（553 tests / 552 pass）：

- **FTS5 失同步**（`63cf56093`）：外部内容表 clear 须 `'delete-all'` 命令；purge/诊断删除前同步 FTS `'delete'`——否则 rowid 复用后 JOIN 到错误行、已抹除文本仍可搜。
- **purge 记账顺序**（`08448e118`）：无活动 session 时 fail-closed 拒绝，物理删除不再可能无账目提交。
- **复原闭环**（`b57b63b71`）：`engine.listTombstones` + `omega:histosListTombstones` 六方同步 + FactsPanel 已归档列表与复原按钮。
- **诊断双写**（`63cf56093`）：派生层不再投影 diagnostic_observed（JSONL 权威，graph 索引由 applyDiagnostics 专责 dedupe）。
- **histos_expand + L1 空壳**（`434d46a9c`）：内存 miss 回落 JSONL 磁盘；L1 携带 summary/distill 文本而非重复 L0。
- **死代码清理**（`62328fe8d`，ponytail 口径）：删 7 个 0 引用常量/别名 + MAX_EVIDENCE_ITEMS 双定义 + 多余实参。
- **profile 域 + 画布刷新**（`43faba05b`）：三处 settings 写入点接线；useHistosGraphQuery 订阅归档事件。
- **人审门/菜单 CSS/checkpoint 校验/谓词补全**（`4f425ef48`）。
- **spec 勾选诚实化**（`bdde66529`）：tasks/checklist 勾选 + 未接线项标注。

**审查最终结论**：P0 追溯层端到端可用、单写者/审批 fail-closed/凭据零泄漏守住；P3/P7/P8/P4 用户路径接线与 Task 24.2/25.2 渲染层入口留待产品决策（见 `ravel-histos-next-cycle.md` §5.1）。
