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
