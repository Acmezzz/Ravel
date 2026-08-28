# Ravel × 7 主流 Agent 差距分析报告（围绕 Histos 系统）

日期：2026-08-28 · 编制：齐活林（交付总监）· 团队：software-ravel-gap
状态：**调研有效；路线过时。** 竞品证据仍认本文与 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。本周期实施认 [`../../docs/ravel-histos-next-cycle.md`](../../docs/ravel-histos-next-cycle.md)。记忆 = Histos，不另做记忆产品；无 Histos 时仍须是完整编码 Agent。
分工：竞品调研 = 许清楚（既有报告记录了逐产品 3-7 个子页面；本轮证据状态见台账）；本地盘点 = 高见远（对照源码与 64 份测试核实）；差距映射与汇编 = 齐活林。
子报告：
- `competitive-analysis-7-agents.md`（逐产品详析 + 20 维矩阵 + 图/上下文/记忆专项）
- `ravel-feature-inventory.md`（12 功能域 ~90 功能点盘点 + Histos 专项）

---

## 0. TL;DR

1. **Histos 的差异化窗口在本次检查范围内成立**：在七个指定站点与页面范围内，未发现同时提供「无限画布 + 内容寻址工件语义图 + 受控执行」组合的产品；最接近的拼图分散在 Hermes /journey（学习图）、Devin Spaces（任务聚合）、omp /tree（分支树）三处。该结论不是对整个市场的穷尽性“唯一”声明。
2. **但 Histos 目前是「架构完整、semantic 透镜离线」**：生产 semanticProvider 未接入，LLM 凝练端到端不可用——所有语义能力（语义 LOD、凝练、Knowledge 类对标物）都被这一个缺口锁死。这是唯一真正的 P0。
3. **基准线缺口经源码核实后分成两类**：确定缺口是 Plan-as-Artifact、生产 semanticProvider、凝练 eval/成本产品化、工作区内记忆、嵌套 Sub Flow/收缩 UX；定时/事件自动化、每工具 override、分享/导入和 PR 面板属于需求强但统计需复核的候选项。许清楚报告所称「缺多档权限」**不成立**——四档权限 + 成对审批事实双向 fail-closed 已落地，但缺每工具 override 与档位热切换 UX。
4. **最大的机会不是追标配，而是把标配「Histos 化」**：Plan mode 做成工件、自动化做成定时 Flow、知识沉淀走 skill Draft→Diff→Apply、完成判定锚定 FactAddress 物证——每一样都同时满足竞品预期与 Ravel 不变量；在本次检查的七站页面范围内，未发现竞品把这些要素组合成同一套可寻址、可审计闭环。

---

## 0.1 证据边界

竞品证据台账见 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。本报告中的竞品深度画像主要继承 `competitive-analysis-7-agents.md` 的既有抓取记录（E3）；本轮仅对部分入口/专题页做了直接复核（E1/E2）。其中 Codex 使用第三方镜像且本轮认证失败，omp 入口页主要只确认定位，ZCode 部分抓取超时。因此：

- `7/7`、`6/7` 只能称为**既有报告覆盖统计**，不应表述为七个产品在同一证据深度下的独立验证。
- “未见文档”统一解释为“本次检查页面未明确说明”，不等于产品不支持。
- Ravel 结论仍以源码、测试和当前 Git 状态为准；竞品资料用于需求基线，不替代产品验收。

## 一、7 个主流 Agent 功能分析（浓缩）

### 1.1 逐产品一句话画像

| 产品 | 定位 | 对 Histos 最有价值的设计 |
|---|---|---|
| **ZCode**（智谱） | GLM 深度联调的 Agentic IDE，长任务一站式 | **目标模式实据校验**（只认文件/命令/测试输出，不采信模型自陈）；闲时任务先 commit 再跑；成本统计是同类天花板 |
| **Claude Code**（Anthropic） | 多 surface 编码 Agent 标杆 | **auto memory「小索引常驻 + 主题文件按需」**（与凝练层同构）；四级 CLAUDE.md；7 家唯一 **per-session Git worktree 自动隔离** |
| **Devin**（Cognition） | 云端自主工程师，并行清积压 | **Knowledge 触发描述驱动检索**；**Playbook 从成功会话蒸馏、失败案例迭代**（Convert to Flow 的直接竞品基准）；托管 Devins = 协调器 + 独立 VM + ACU 预算 |
| **omp** | 终端优先开源风格 | 会话模型与 Histos JSONL 事实层**几乎同构**：branch（会话内树）/fork（新会话）双原语、崩溃只认已完成条目；**Plan 审批五种上下文处置**（全新/压缩/保留/细化/存档）= ContextSet 粒度控制的交互形态 |
| **Codex**（OpenAI） | 四端并入 ChatGPT | 事件驱动自动化（Gmail/Slack/GitHub 触发）；`/import` 竞品迁移；项目信任门控（与 Ravel Project Trust 相互印证） |
| **Hermes**（Nous） | 自称唯一带学习闭环的 Agent | **三层记忆与 Histos 三层几乎一一同构**（有界精炼记忆 ≈ 凝练层 / FTS5 全文检索 ≈ 事实层+索引 / skills ≈ skill 文件）；「记忆满报错让 Agent 自行合并」拒绝静默压缩；**/journey 学习星图可回放可治理**；写入 staged diff 人审门控 |
| **Manus** | 通用 Agent 平台 | **Wide Research**（每子任务全新上下文，确立并行 = 隔离共识）；项目配置继承的更新传播语义（即时 vs 仅新任务）；任务 replay 回放 |

### 1.2 跨产品功能矩阵（精简版，✅ 完整 / ⚠️ 部分 / ❌ 无；完整 20 维版见子报告）

| 维度 | ZCode | Claude | Devin | omp | Codex | Hermes | Manus | **Ravel** |
|---|---|---|---|---|---|---|---|---|
| 仅追加可恢复会话 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅ JSONL+事实化恢复** |
| 会话分支/fork | ✅ | ✅ | ⚠️ | ✅ 双原语 | ✅ | ❌ | ❌ | **✅ Pi tree/fork/clone** |
| Plan mode | ✅ | ✅ | ⚠️ | ✅ 最完整 | ⚠️ | ⚠️ | ❌ | **❌（可 Histos 化）** |
| 并行子代理+隔离 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **🔒 按设计暂缓** |
| worktree 并行隔离 | ❌ | ✅ 唯一 | ⚠️ VM | ❌ | ❌ | ❌ | ❌ | **🟡 有 worktree 无编排** |
| 多档权限分级 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **✅ 四档+成对审批事实** |
| MCP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅ stdio 桥走原生审批** |
| 技能/可复用流程 | ✅ | ✅ | ✅ Playbook | ✅ | ✅ | ✅ 自改进 | ✅ | **🟡 skill 有、蒸馏无** |
| 定时/事件自动化 | ✅ | ✅ | ✅ 五源 | ❌ | ✅ | ✅ cron | ✅ | **🔒 后续口子** |
| 跨会话长期记忆 | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ 最深 | ✅ | **🔒 跨项目；🟡 工作区内** |
| 成本/用量统计 | ✅ 天花板 | ✅ | ✅ ACU | ⚠️ | ✅ | ⚠️ | ✅ | **🟡 遥测有、成本/eval 无** |
| 记忆/学习可视化治理 | ❌ | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ /journey | ❌ | **🟡 有图、无治理/回放** |
| **画布+工件语义图+受控执行** | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 最近亲 | ❌ | **✅ 本次七站范围内未发现同组合** |

---

## 二、Ravel 当前功能分析（浓缩）

### 2.1 成熟度总评

桌面产品主体完成度高：会话时间线（operation 成对事实 + 纯投影 + 虚拟化）、四档权限 + Project Trust、成对审批事实双向 fail-closed、shadow-git 可撤销检查点、worktree、MCP stdio 桥走原生审批管线、隔离 PTY、`app://` 打包协议——全部 ✅ 有实现有测试。锁定栈（Electron 44 / Vite 8.2.2+Rolldown / TS 7 / Base UI 1.7 / Zustand 5）全部落地。

### 2.2 Histos 三层现状

- **事实层 ✅ 完整**：仅追加 JSONL、六种事实类型、恢复终态化（open op→failed、未决审批→unavailable）、Git/skill revisionId 锚定。
- **凝练层 🟡 结构侧完整、语义侧离线**：FactAddress（12 类）、revision DAG、Evidence M:N、可删可重建 sqlite、四类 SHA-256 工件、确定性预算裁剪 fail-closed——全部就绪；**唯一但致命的缺口是 semanticProvider 未接入**（`semantic_provider_unavailable`），另有 eval/成本遥测空白、GraphRevision 结构化 diff 未立项。
- **可视层 🟡 全链路已通、两个交互缺口**：Convert→Validate→持久审批→Pi 执行已接通（P6）；缺交互式嵌套 Sub Flow UI（P3-g）与超窗收缩 UX（P4-g）。

### 2.3 差异化护城河（竞品对照下依然成立）

FactAddress 全域溯源、内容寻址 revision DAG、可删索引不变量（删库重建有测试）、成对审批事实双向 fail-closed、语义图不可执行闸门、shadow-git 可撤销检查点、确定性上下文预算（禁止静默截断）、`context_attached` 上下文事实化、三方 utilityProcess 隔离。**在本次检查的七站页面范围内未发现对应的完整组合**，且多数正是竞品设计取舍可反向验证的系统性答案（如 Hermes 的写审批门控 → Ravel 的成对审批事实；ZCode「自动记忆不可查看」反面教材 → Ravel「一切沉淀皆工件」）。

---

## 三、缺失功能清单（修正后）

> 许清楚报告原判「补 plan mode + 多档权限」中的**多档权限经源码核实不缺**（四档 + riskTierOf + 19 类操作策略表 + Project Trust），予以修正。真正缺口如下。

### 3.1 确定缺口（由 Ravel 源码/测试盘点直接确认）

| # | 缺口 | 现状 | 严重度 | 说明 |
|---|---|---|---|---|
| G1 | **Plan-as-Artifact** | 当前无一等计划工件 | 高 | 不是补一个无权威源的假面板；应让只读探索产出可审的 `PlanRevision`，再进入 ContextSet/Flow |
| G2 | **生产 semanticProvider** | 编排契约存在，桌面端返回 `semantic_provider_unavailable` | P0 | 语义 LOD、语义凝练和触发式知识检索均被锁住 |
| G3 | **凝练 eval / 成本产品化** | 通用 telemetry/eval harness 存在，但无 semantic-condensation 回归和 per-session/per-Flow 成本出口 | 中高 | 基础设施不能当成用户可见能力 |
| G4 | **工作区内跨会话记忆** | 跨项目记忆按设计排除；工作区内 reviewed retrieval 未闭环 | 中 | 先做有证据、可审阅、可删除的召回 |
| G5 | **嵌套 Sub Flow UI / 超窗收缩 UX** | compound 布局与预算 fail-closed 已有，交互闭环缺失 | 中高 | 需要用户可进入子图、缩减选择、重试并看到结果 |

### 3.2 需求强但统计不应过度断言

| # | 能力 | 现有报告记录 | 当前判断 | 说明 |
|---|---|---|---|---|
| G6 | **定时/事件自动化** | 既有报告记为 7/7；本轮各站证据深度不一致 | 高需求、统计需复核 | 若实施，采用定时 Flow + 预授权 + 预算/触发限流 + 失败不重跑 |
| G7 | **每工具权限 override / 档位热切换** | omp/Claude 既有报告记录 | 中需求 | Ravel 已有 19 类操作策略、四档 profile 和 Project Trust，缺的是更细粒度 override 与快速切换 |
| G8 | **会话分享与竞品导入** | omp/Codex/Devin 既有报告记录；Codex 为第三方镜像 | 低到中需求 | HTML 导出已存在；加密分享/导入需先定义信任、版本和敏感信息边界 |
| G9 | **PR/gh 面板** | 既有报告记录 6/7 有 Git/PR 集成 | 中需求、非当前阻塞 | 不能把“有 Git 快照/commit/worktree”写成已有 PR 评审闭环 |

### 3.3 设计排除项的竞品压力重估（不改变设计，标注压力等级）

| 排除项 | 竞品压力 | 建议 |
|---|---|---|
| 子 agent worktree 编排 | 中（7 家仅 Claude 有 worktree 隔离，非标配） | 维持「更后阶段」，但作为 Histos 画布并行的远期形态保留 |
| 跨项目记忆 | 中 | 维持排除；先做 G4 工作区内形态 |
| MCP 网络传输 | 中低（stdio 已覆盖主流本地 server） | 维持；竞品的「连接器市场」方向等有真实需求再议 |
| PR/gh 面板 | 中（6/7 有 Git/PR 集成） | Ravel 已有 Git 快照/commit/worktree；PR 评审面板维持排除，不阻塞 |

---

## 四、围绕 Histos 应该补什么（核心章节）

### A. Histos 体内完成——既有缺口的竞品映射（先做，全是既定路线）

| 缺口 | 竞品对标 | 完成后解锁 |
|---|---|---|
| **P2-g semanticProvider 接入**（含 eval + 成本遥测） | Devin Knowledge / Claude auto memory 的「生产检索」前提 | 语义 LOD、语义凝练、Knowledge 式触发检索、skill 蒸馏——**所有语义能力的总闸门** |
| **GraphRevision 结构化 diff** | Devin Playbook 失败案例迭代、Hermes /journey 回放 | 图可审查、可回放、凝练质量可回归；纯函数、成本低（roadmap 已确定） |
| **P3-g 交互式嵌套 Sub Flow UI** | Devin 托管 Devins 协调器 | 大任务在画布上拆解为嵌套子流程，父图监控子图 |
| **P4-g 超窗收缩 UX** | omp Plan 审批五种上下文处置 | 预算 fail-closed 已有，补「用户主动缩选择」的最后一公里 |
| **§7.8 删除/墓碑语义落地** | Hermes /journey 节点删改归档 | 图节点治理闭环（archive/missing 已定义未实现） |

### B. Histos 化的新功能——把竞品标配做成 Histos 原生（差异化打法）

**B1. Plan mode → Plan-as-Artifact（补 G1 的 Histos 方案）**
计划不是假面板，而是新工件：Explore 只读探索产生候选计划（本质是一张 `plan_revision` 语义图，节点带 FactAddress evidence）；用户审计划时给出**上下文处置选择**（采纳 omp 五选项：全新会话/压缩上下文/保留上下文/继续细化/存档不执行——前三个分别对应 ContextSet 的空冻结/凝练冻结/全量冻结）；批准即 Convert to Flow → 既有 Validate → 审批 → Pi。**计划、审批、执行、结果全部落在既有事实与工件体系上，零新权威。**

**B2. 触发式检索兜底（补 G4，Devin Knowledge 模式）**
ContextSet 工件增加可选 `triggers`（触发描述）字段；会话开始时除手动装配外，Engine 可按触发词在 `index.sqlite`（spans 表 + FTS）做检索，命中生成**建议性 ContextSet 草稿**，人审后才冻结追加 `context_attached`——自动沉淀必配可审查出口（Devin AI 知识建议模式），且检索失败/无命中如实呈现，不静默注入。

**B3. 记忆/知识蒸馏闭环（Hermes 三层验证 + Devin Playbook 蒸馏）**
「把这次会话学到的变成 skill」：从 GraphRevision 子图（成功会话的凝练）自动生成 skill draft → 走**已有的** §7.8 Draft→Diff→Apply 流程，diff 人审门控天然对齐 Hermes write_approval 与 Ravel 成对审批事实；失败会话对比迭代 = 用旧 GraphRevision 与新 GraphRevision 的结构化 diff 定位差异。**skill 文件本就是 Histos 事实层权威，这是把 Hermes「过程性记忆」做进自家护城河。**

**B4. Flow 节点实据完成判据（ZCode 目标模式）**
Flow/自动化节点的「完成」不采信模型自陈，只认可锚定的物证：文件变更（Git blob SHA）、命令退出码、测试输出——恰好全部可以写成 FactAddress evidence。ZCode 用实据校验防自欺，Histos 用 FactAddress 让实据**可溯源**，往前一步。

**B5. 图回放（Manus replay + omp /tree，成本极低）**
JSONL 仅追加 + revision DAG 天然支持「拖动时间轴看图演化」：按 entry 序重放投影即可，无需新存储。这是把「时间可追溯」不变量变成用户可感知的功能，性价比全场最高。

**B6. 定时自动化 = 定时 Flow（补 G2，不破坏 fail-closed）**
自动化不做成独立 cron 引擎，而是：触发器（时间/文件变更/未来事件源）→ 冻结 ContextSet → Convert to Flow → **既有 Validate + 审批闸门**。无人值守治理对标 Devin ACU：每自动化设预算上限 + 触发限流 + 失败后进诊断不重跑（与 worker 恢复语义一致）。注意当前权限下无回答者即 `unavailable`——无人值守需要显式的「预授权范围」工件，仍走事实。

**B7. 每工具 override 落进策略表（补 G5）**
19 类操作策略表扩展为 `tool+pattern → allow/prompt/deny`（omp 决策链：tool deny > 用户 deny > 安全策略 > 档位），继续全部走成对审批事实落盘。

### C. 不抄清单改为决策规则

以下不是“竞品有、Ravel 永远没有”的简单清单，而是按不变量判断：

- **与当前边界冲突，暂不引入**：云 VM/云任务、Wide Research 式百级并行、computer use/浏览器操作、跨项目记忆、OS 级沙箱宣称、Neo4j/图数据库、Monaco、第二 runtime/第二审批库、静默自动压缩记忆。
- **当前明确排除但可重估**：子 agent worktree 编排、PR/gh 面板、MCP 网络传输、在线 skill 安装、OAuth、桌面远控。它们只有在安全边界、产品用户和运维能力同时成立时再单独立项。
- **不可退让的不变量**：三层权威分离、单一事实写者、Electron 隔离、路径 containment、语义图不得直接执行、压缩/记忆写入必须可见且可审查。

Hermes 的“记忆超限报错、要求显式整理”与 Ravel 的 `budget_exceeded` 方向一致；这不是证明两者实现相同，而是说明“禁止静默有损压缩”是可解释的治理选择。

---

## 五、建议路线图（融合 roadmap 既有 P-g 编号）

| 优先级 | 事项 | 性质 |
|---|---|---|
| **文档基线** | 维护 `agent-doc-evidence-2026-08-28.md`，按页面状态更新证据等级与覆盖统计 | 不属于产品 P0；防止竞品结论被过度断言 |
| **P0** | P2-g semanticProvider 接入 + eval/成本遥测（A 表首行，G3 一并解决） | 既有缺口，总闸门 |
| **P0** | checkpoint 修复（见 §六-1） | 工程健康，当前门禁红 |
| **P1** | GraphRevision 结构化 diff → 图回放（B5 依赖它） | roadmap 已确定 + 低成本高感知 |
| **P1** | Plan-as-Artifact（B1，吸收 omp 五种上下文处置） | 基准线缺口 G1 的 Histos 化 |
| **P1** | P4-g 收缩 UX + P3-g 嵌套 Sub Flow UI | 既有 P4/P3 缺口 |
| **P2** | 触发式检索 + skill 蒸馏闭环（B2/B3） | 依赖 P0 semanticProvider |
| **P2** | 定时 Flow + 无人值守治理（B6）+ 节点治理/墓碑（§A 末行） | 基准线 G2 |
| **P2** | 每工具 override（B7）、加密分享/竞品导入（G8） | 补齐项 |
| **重估** | 子 agent worktree 编排、PR 面板 | 设计排除但竞品压力中等，季度重估 |

---

## 六、工程健康度提示（本次盘点 + 前次代码审查合并）

1. **【重要】checkpoint 在当前环境已静默失效**（前次审查发现，架构师盘点未覆盖）：本机 PortableGit 2.55.0.windows.3 的 `git update-ref` 对三段式 ref（`refs/ravel/checkpoints/<id>`）exit 0 但不创建 ref，3 个 checkpoint 测试失败；`createCheckpoint` 缺 update-ref 后校验，静默返回成功假象。建议：update-ref 后 `rev-parse --verify` 校验（fail-closed）+ 排查 git 版本。
2. 桌面测试文档引用数字（285/286 过）为 8 月快照，实测 281 过 / 3 挂 / 1 取消（含 PTY flaky 一例）。
3. 文档漂移：core-design §5「尚未合进 main」与 roadmap「已并入」矛盾；HEAD 引用落后（`9b98e529b` → 实际 `ce6d8d819`）。
4. `apps/ravel-desktop/release3/` 打包产物残留工作树，`.gitignore` 枚举式忽略有漏网。

---

*本报告结论基于：七站文档的既有抓取记录与本轮证据边界复核（详见 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)）、Ravel 源码与 64 份测试的核实、以及 2026-08-28 工程审查记录。对超时、认证失败、入口页未展开的能力，报告只写“本次页面未明确说明”，不据此判定不支持。*

## 七、下一次复核入口

下一次更新只需替换证据台账中的页面状态、同步当前 Git/test 快照，再重算矩阵统计。不要把历史抓取数量、旧 HEAD 或旧测试通过数复制到新报告；不要通过猜测 URL 或反复重试不可达站点来制造“已验证”结论。
