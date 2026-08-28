# Ravel 竞品功能分析报告：7 个主流 Agent 产品对标调研

> 状态：**调研有效；P0 建议过时。** 本周期实施认 [`../../docs/ravel-histos-next-cycle.md`](../../docs/ravel-histos-next-cycle.md)。证据台账见 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。
>
> 调研对象：ZCode / Claude Code / Devin / OpenModelPort (omp) / Codex / Hermes Agent / Manus
> 调研日期：2026-08-28（既有报告基于各产品文档站抓取；本轮对用户指定入口做证据边界复核）
> 证据台账：[`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。台账把证据分为 E1（本轮页面正文）、E2（官方站内专题入口）、E3（既有报告记录、本轮未复核）和 U（本轮无法确认）。
> 说明：Codex 采用 `codex-docs.com` 第三方镜像文档站（按任务指定），不得与官方一手资料等量齐观。Devin 的专题路径曾通过官方 `llms.txt` 定位；相关深度结论在本报告中保留，但在台账中标为 E3，直到补入页面级摘录。
> 口径：**“未见文档”不等于“不支持”**。入口页只能证明定位或专题导航；“7/7、6/7”是既有报告的覆盖统计，不自动等于本轮逐页独立验证。

---

## 一、逐产品分析

### 1. ZCode（zcode.z.ai）

**产品定位**（E3，既有报告记录；本轮入口页未稳定复核）：智谱自研的 Agentic Development Environment（桌面端），围绕 GLM-5.3（1M 上下文）深度联调，主打「长任务一站式推进」：规划→编码→验证→Review 在同一任务内收口。

**核心功能**：自研 ZCode Agent、目标模式（/goal）、闲时任务、定时任务（automations）、子智能体、辅助对话（/side /btw）、会话分叉、内置浏览器控制（Browser Use 插件）、项目记忆、AGENTS.md 项目指令、编辑历史对话、任务/文件管理。

**会话/任务管理**：任务列表支持置顶/分组/归档/拖拽；「不在项目中工作」的纯对话模式；辅助对话并行于主任务但为临时态（关窗即失）；会话分叉从任意已完成的助手消息创建新任务（不回滚磁盘文件）；编辑历史可修改已发消息。

**上下文与记忆**：上下文补充入口丰富——`@` 文件/文件夹引用、`#` 关联历史会话、`/` 命令、`$` 技能、附件、划选追问；AGENTS.md 仅两级（用户全局 + workspace），不合并子目录、不支持 import；项目记忆（默认关闭）由 Agent 自动提炼，仅存本机不进 Git，目前不可查看/清除；接近窗口上限自动压缩（不可配置阈值）。

**权限与沙箱**：四档执行模式（变更前确认 / 自动编辑 / 计划模式 / 完全访问），Shift+Tab 切换；闲时任务可预设权限档。未见 OS 级沙箱。

**并行执行**：前台子智能体并行跑完再继续；后台子智能体由 Agent 自主决定（后台 Explore 强制只读）；闲时任务/定时任务后台无人值守执行，长任务分段续跑（会话不丢）；多端（手机 Remote、飞书/微信 Bot）跟进同一工作区任务。

**计划能力**：计划模式（只读探索→出计划→确认后执行）+ 独有的**目标模式**：/goal 设定可校验目标后每轮自动校验（看实据：文件改动、命令输出、测试结果），未达成自动续轮，支持暂停/恢复/用量上限。

**UI 与工作台**：桌面端工作区 + 浏览器面板 + 摘要面板（目标模式每轮迭代分组展示）；Remote 手机端；Bot 通道。

**集成**：MCP（stdio/HTTP/SSE）；多模型供应商（BigModel/Z.ai/Claude/OpenRouter/Moonshot/OpenAI/MiniMax/MiMo/自定义 Anthropic/OpenAI 兼容端点）；Git 分支选择器与提交前检查。

**可扩展性**：插件（技能+命令+子智能体+MCP 打包）、命令、技能（$）。

**成本统计**：应用用量（Token/会话/热力图/模型排行）+ 套餐额度（5h 池/周额度/MCP 月额度）+ 闲时段自动下发额度重置卡——成本可见性是同类中最完善之一。

**对 Histos 有参考价值的设计点**：
- **目标模式的「实据校验」**：完成判定不采信模型的自我陈述，只认文件/命令/测试输出——与 Histos「凝练层可重建索引」的物证化思路同源，可借鉴为 Flow 节点的完成判据。
- **闲时任务的「建议先 commit 再跑」+ 分段续跑**：将不可靠的长任务锚定在 Git 状态上，与 Histos「JSONL 会话 + Git 工作区」的事实层设计互相印证。
- **辅助对话「继承主会话历史但独立时间线、临时不落盘」**：一种轻量级的上下文借用（borrow）模式，对应 Histos ViewState 的临时视图概念。
- **引用历史会话（# 关联）**：跨会话上下文复用的低门槛入口。

### 2. Claude Code（code.claude.com）

**产品定位**（E1，入口页明确）：Anthropic 官方 agentic 编码工具，多 surface（CLI / IDE 扩展 / 桌面 App / Web / 移动 / Slack），同一引擎与配置贯穿所有端。

**核心功能**：CLAUDE.md 分层指令、auto memory、skills、hooks、subagents、后台 agents（agent view）、agent teams、动态工作流、MCP、定时任务（Routines 云端 / Desktop 本地 / /loop）、Remote Control/Dispatch、PR 监控（Auto-fix/Auto-merge）、CI 集成（GitHub Actions / GitLab CI）、Agent SDK。

**会话/任务管理**：桌面端每个会话独立历史/文件夹/变更；Environment 四选（Local/Cloud/SSH/WSL）；`/btw` 侧聊借用主上下文不污染主线；跨会话消息（列出/读取/给其他会话发消息）；归档 + PR 合并后自动归档。

**上下文与记忆**：记忆体系是同类标杆——CLAUDE.md 四级层级（managed → user → project → local）+ `.claude/rules/` 按 paths 条件加载 + `@import`（4 跳上限）；auto memory 四类（user/feedback/project/reference），按 git 仓库推导作用域（worktree 共享），MEMORY.md 索引前 200 行/25KB 启动加载、主题文件按需读取，机器本地。

**权限与沙箱**：五档权限模式（Manual / Accept edits / Plan / Auto / Bypass），可按文件夹记忆；`permissions.deny` 规则；外部站点操作强制安全分类器；subagent 可设 permissionMode 与 worktree 隔离。

**并行执行**：subagent（独立上下文窗口、工具白名单、3 层嵌套上限、并发 20）；fork（/subtask，继承全对话、共享 prompt cache）；桌面端多会话 + **Git worktree 自动隔离**（每会话独立仓库副本，`.worktreeinclude` 复制 gitignored 文件）；后台 subagent 缩减工具集；输出扫描防注入。

**计划能力**：Plan 权限模式（只读探索后出计划，Explore/Plan 内置只读 subagent 支撑），最佳实践「先 Plan 再切换执行模式」。

**UI 与工作台**：桌面端多窗格（chat/diff/浏览器/终端/文件编辑器/计划/任务/子代理），自由拖拽布局，Normal/Verbose/Summary 三视图。

**集成**：MCP、连接器（GitHub/Slack/Linear/Notion 等图形化配置）、插件市场、Chrome 调试、Computer Use（研究预览）。

**对 Histos 有参考价值的设计点**：
- **Git worktree 自动化**是「并行会话互不干扰」的业界标准答案，Histos 的事实层（Git 工作区）应原生提供 worktree 级并行。
- **auto memory 的「索引 + 按需加载主题文件」两级结构**：MEMORY.md 只进索引不进全文，与 Histos「凝练层 = 可重建 sqlite 索引」高度同构，验证了「大事实库 + 小常驻索引」方向。
- **记忆作用域按 git 仓库推导**（worktree/子目录共享）——Histos ContextSet 的作用域设计可参考。
- **subagent 只回传摘要**保护主上下文——对应 Histos 画布节点的「凝练」原则。

### 3. Devin（docs.devin.ai，Cognition）

**产品定位**（E1，简介页明确）：云端自主 AI 软件工程师，主打「并行清理工程积压」：Linear/Jira 工单、迁移、重构、PR Review。形态为 Web App + Slack/Teams 集成 + CLI + Desktop IDE（吸收 Windsurf）。

**核心功能**：Knowledge（知识库）、Playbooks（可复用提示库）、Skills（SKILL.md）、托管 Devins（并行编排）、自动化（事件驱动）、动态工作流（确定性 Python 编排）、Session Insights、DeepWiki、Security Swarm、Devin Review、Stacked PRs、Ask Devin、Computer Use、Devin MCP。

**会话/任务管理**：会话 = 云端隔离 VM 中的完整工作流（Shell/IDE/Browser 三工具实时可见可接管）；ACU（Agent Compute Unit）计量；事件时间线可查询/搜索；CLI `/handoff` 把本地任务移交云端会话；Stacked PRs 把大变更拆成有序可审查的 PR 链。

**上下文与记忆**：**Knowledge** 是核心记忆机制——条目 = 触发描述 + 内容，Devin 判断相关时才检索（非全量注入）；支持 `!macro` 快捷引用、按仓库固定（无/单仓库/全部仓库）、文件夹组织 + 批量启停、AI 知识建议（从对话反馈生成，保存前可编辑）、组织级/Enterprise 级分层、去重合并。另有 AGENTS.md、环境蓝图（Blueprints，可从仓库生成并快照）。

**权限与沙箱**：安全 Profile（限制网络/MCP/git 访问，绑定组织/自动化/会话）；CLI OS 级沙箱（可写路径由 Write 权限作用域解析、bubblewrap 隔离、域名级网络过滤 allow/deny、fail-closed——沙箱解析失败直接拒绝启动）；企业强制沙箱模式；自动化网络策略与 ACU/触发次数双限制；AI Guardrails 防提示注入。

**并行执行**：**托管 Devins**——协调器会话拆分大任务→给每个工作包启动独立 VM 会话→监控 ACU、发消息、休眠/终止、定时自查；动态工作流用确定性 Python 脚本做多阶段编排（可记录可恢复）；Wide-scale 分析由 API 一次等待全部并行会话完成。

**计划能力**：Ask Devin（就代码库提问、规划任务、生成上下文丰富的会话）；无独立 plan mode，规划内嵌于提示实践。

**UI 与工作台**：对话式界面 + 内嵌 IDE/Shell/Browser 可接管；Agent Command Center（本地+云端 Agent 统一看板）；Spaces（任务的所有会话/PR/文件/上下文聚合视图）。

**集成**：Slack/Teams/GitHub/GitLab/Bitbucket/Linear/Jira/Azure DevOps、MCP 市场、webhook、OIDC、企业 SSO/SCIM/RBAC。

**对 Histos 有参考价值的设计点**：
- **Knowledge 的「触发描述驱动检索」**：知识不全量注入、按相关性触发——Histos 凝练层的 ContextSet 选择机制可直接对标此模式（触发词 → 检索 → 注入）。
- **Playbook 由成功会话自动蒸馏**（「把这次会话变成可复用 playbook」）——Histos「Convert to Flow」受控执行的直接对标物；Devin 还支持用失败案例对比改进 playbook。
- **协调器 + 隔离 VM + ACU 预算**：并行编排的完整治理模型（拆分/监控/预算/收敛）。
- **Spaces**：把一个任务的所有相关物（会话、PR、文件、上下文）聚合成单一视图——与 Histos 画布「任务即空间」的组织方式呼应。

### 4. OpenModelPort / omp（omp.sh）

**产品定位**（E1，入口页明确；其余细节 E3）：终端优先（terminal-first）的开源风格编码 Agent，强调「IDE wired in」——代码智能、调试、浏览器、GitHub 上下文内嵌于单一会话循环；模型供应商自由选择（API-key/OAuth/订阅/gateway/本地）。

**核心功能**：可恢复会话（本地 JSONL）、Plan mode、Subagents、Collab（共享实时会话）、代码智能（language-aware）、调试、浏览器、GitHub 集成、RPC/SDK、ACP 接入。

**会话/任务管理**：同类中最精细——**自动持久化**（条目完成即写 JSONL，流式中不提交，崩溃恢复丢弃残尾保留已完成）；`-c` 续接、`-r` 会话选择器（全文检索、状态标记 interrupted/aborted/error、置顶）；**branch（同会话内多路径，/tree 切换）vs fork（复制为新会话）** 的明确区分；`/export` 自包含 HTML、`/share` 客户端加密链接（密钥在 URL fragment）、JSONL 可交接（`omp --from-claude` / `--from-codex` 可导入竞品历史）；Profile 隔离 + 工作目录两层作用域；`/move` 把会话迁到另一项目。

**上下文与记忆**：会话即上下文载体（JSONL 一等公民，公开格式文档化）；Plan 草稿作为 session artifact 保存；无独立长期记忆系统，靠 session 检索 + 项目规则（project rules）+ skills。

**权限与沙箱**：**Tool approvals 三层模式**（always-ask / write / yolo）+ 每工具 override（allow/prompt/deny）+ bash.patterns 命令级规则（首条匹配生效，allow 须匹配完整命令）；决策链分层（tool deny > 用户 deny > 安全策略 > 模式档位）；headless 无 UI 时 fail-closed；provider 安全检查即使在 yolo 下也强制交互确认。

**并行执行**：Subagents（独立上下文、可并行、可观察可中途引导、headless 按父任务审批为授权边界）；Collab 共享会话。

**计划能力**：Plan mode 最完整——只读规划轮、独立 Plan Review 全屏界面（逐节批注/删节/外编辑器修改）、**五种审批选择**（全新会话执行 / 压缩上下文执行 / 保留全上下文执行 / 继续细化 / 保存退出不执行），执行模型可选（plan 角色 vs default/smol/slow 角色分离）。

**对 Histos 有参考价值的设计点**：
- **JSONL 会话 + branch/fork 双原语**：omp 的会话模型与 Histos「仅追加 JSONL」事实层几乎同构；其「branch = 同会话内路径树（/tree 遍历）vs fork = 新会话」的语义划分值得 Histos GraphRevision 直接采纳。
- **Plan 的五种上下文处置选择**：批准计划时让用户显式决定「探索过程带多少进执行上下文」（全新/压缩/保留）——这正是 Histos ContextSet 粒度控制的用户侧交互形态。
- **崩溃恢复语义**：只认已完成条目、不臆造中断工具的结果——append-only 事实层的完整性守则。
- **加密分享（密钥不出客户端）**：本地优先产品的会话共享范式。

### 5. Codex（codex-docs.com 镜像，OpenAI）

**产品定位**（E3/U：既有报告记录；第三方镜像本轮认证失败）：OpenAI 智能体开发平台，已并入 ChatGPT 桌面应用，形成 CLI + 桌面 + iOS + 云端四端格局（以下依据 2026-07~08 changelog 推断的功能面）。

**核心功能**：持久化线程历史、任务仪表板（`codex agents`）、任务互操作（`@` 提及其他任务、`codex queue` 消息队列）、多智能体 V2、MCP（2026-07-28 协议）+ app-server + WebMCP（站点作为工具提供方）、事件驱动计划任务（Gmail/Slack/GitHub 触发）、插件/技能生态（可从 Cursor 和 Claude Code 导入）、多浏览器扩展、内置浏览器、Computer History（跨应用活动转化为记忆与时间线）、GitHub PR 评审、GitLab 集成、Daybreak 安全框架。

**会话/任务管理**：分页线程历史 + 持久命名/置顶/分区排序/自动命名；线程分叉（含临时分叉）；恢复/分叉对话时保留权限配置文件；上下文压缩（远程压缩计入图片 token 预算）；跨设备恢复未发送提示。

**上下文与记忆**：线程历史原生支持记忆；`/import` 导入 Cursor/Claude Code 的项目记忆与设置；Computer History（macOS）把跨应用/网站活动转为可选授权的记忆+时间线；AGENTS.md（不受信项目不加载）。

**权限与沙箱**：权限模式快捷键循环、安全评审默认值、**项目信任机制**（不受信项目不加载 AGENTS.md）、凭据遮盖（命令与历史中的机密）、危险命令检测、Windows 提权沙箱 + 插件隔离 + 策略失败拒网络、Daybreak Blue（防御性安全）/Daybreak Red（授权攻防，需单独审批）+ 最低权限配置 + Auto-review。

**并行执行**：任务仪表板统一管理多任务；`@` 互操作与消息队列；多智能体工作流；iOS 跨任务/主机/工作区恢复。

**计划能力**：changelog 未显示独立 plan mode；有审批配置文件与 auto-review。

**对 Histos 有参考价值的设计点**：
- **事件驱动自动化**（Gmail/Slack/GitHub 事件触发 + 触发合并去抖 + Scheduled 视图）：Histos 若做自动化，事件源抽象比纯 cron 更进一步。
- **Computer History**：「跨应用活动 → 时间线 → 记忆」的自动凝练管线，是「可视层语义图」的机器侧素材来源参考。
- **`/import` 竞品迁移**：主动降低换轨成本；Histos 可考虑导入 Claude Code/Codex 会话历史的入口。
- **任务互操作（@ + queue）**：会话间通信的最小充分原语。

### 6. Hermes Agent（hermes-agent.nousresearch.com，Nous Research）

**产品定位**（E2，入口导航 + E3 深度记录）：自称「唯一带内置学习闭环的自主 Agent」——从经验中创建技能、使用中自我改进、主动持久化知识、跨会话构建用户模型。常驻式（VPS/容器/serverless），20+ 消息平台接入，不绑定 IDE。

**核心功能**：自管理记忆（MEMORY.md/USER.md）、session_search（FTS5 全文检索历史）、/journey 学习时间线（Star Map 可视化）、skills 自主创建与自改进、/learn 从任意素材学技能、Bot Mode（专家 Bot 团队）、subagents、execute_code 程序化工具调用、cron、6 种终端后端（local/Docker/SSH/Daytona/Singularity/Modal）、20+ 消息网关、语音、8 个外部记忆供应商插件（Mem0/Honcho/Hindsight 等）。

**会话/任务管理**：所有会话存 SQLite（state.db）+ FTS5；会话可 list/检索/前后滚动；cron 任务持久化。

**上下文与记忆**（本次对比中最深）：三层结构——①**有界精炼记忆**：MEMORY.md（2200 字符）+USER.md（1375 字符）启动时冻结快照注入 system prompt（保 prefix cache），超限时 `memory` 工具报错并要求 Agent 当轮自行合并/删除条目后重试（不自作主张压缩）；写门控（write_approval 可把写操作 staged 待人审）；②**无限原始层**：session_search 全文检索全部历史会话（FTS5，~20ms，零 LLM 成本），与精炼记忆明确分工（常驻关键事实 vs 按需召回细节）；③**程序层**：skills = 过程性记忆，Agent 在解出非平凡工作流时主动 skill_manage 落盘，渐进式披露（Level0 列表 ~3k token → Level1 全文 → Level2 引用文件按需）。**/journey 把技能+记忆绘制成时间线/星图，可回放、可删除、可编辑**——学习过程可视化 + 治理。外加 Honcho 辩证式用户建模与后台自评审（auxiliary model 复盘每轮，产出记忆/技能更新并通知）。

**权限与沙箱**：八层防御——用户授权（allowlist/DM pairing）、危险命令审批（smart 模式用辅助 LLM 评估风险自动放行低危 / manual / off-YOLO）、硬线黑名单（rm -rf / 等 YOLO 也拦）、用户自定义 deny glob、文件写安全（保护路径硬拒 + HERMES_WRITE_SAFE_ROOT 沙箱前缀）、容器隔离（Docker cap-drop/no-new-privileges/资源限制；容器后端跳过命令审批——容器即边界）、MCP 凭据过滤、上下文文件注入扫描 + tirith 语义扫描 + SSRF 防护。

**并行执行**：subagents 隔离并行工作流；Bot Mode 多专家 Bot 群聊协作（@mentions）；多终端后端分布式。

**计划能力**：内置 `/plan` 技能（产出 markdown 计划存 `.hermes/plans/`），非独立模式。

**对 Histos 有参考价值的设计点**：
- **三层记忆架构与 Histos 三层架构几乎一一同构**：精炼记忆 ≈ 凝练层；SQLite+FTS5 原始会话 ≈ 事实层 JSONL + 可重建索引；skills ≈ Histos skill 文件。Hermes 验证了「有界常驻 + 无限可检索 + 程序化沉淀」的完整闭环。
- **「记忆满时报错让 Agent 自己整理」**：拒绝静默压缩，把凝练权交给模型但设定硬边界——Histos 凝练层维护策略的优秀先例。
- **/journey 学习星图**：与 Histos 可视层语义图最接近的已落地产品——把「学到了什么」做成可回放、可治理（删除/编辑节点）的图。
- **冻结快照注入**：system prompt 快照不变以保 prompt cache——Histos ViewState 渲染的性能考量。
- **写审批门控（staged writes + diff 审查）**：自改进系统的治理范式。

### 7. Manus（manus.im）

**产品定位**（E1，Projects 页明确；并行/安全等细节不得由此页推导）：通用 AI Agent 平台（非纯编码），以「项目 = 持久共享工作空间」组织重复性工作；云端执行，全订阅档可用。

**核心功能**：Projects（主指令 + 知识库自动注入新任务）、Wide Research（并行多 Agent 大规模研究）、Scheduled Tasks、Collab（实时协作）、Skills、Design View、Slides、数据分析、多模态、Mail Manus、云端浏览器 + Browser Operator、网站构建器、MCP Connectors/自定义 MCP、API、Zapier、数据源集成。

**会话/任务管理**：任务隶属于项目，可移动/筛选（所有/非项目/收藏/已计划）；项目可置顶/拖拽排序；默认私密，项目级邀请（共享配置不共享任务）+ 任务级单独共享。

**上下文与记忆**：**主指令 + 知识库 = 项目级上下文，项目内每个新任务自动继承**；更新传播规则明确——指令更新对当前任务的后续消息即时生效，文件更新只影响更新后新建的任务；官方提示「指令越具体，新任务需要补的上下文越少」。

**权限与沙箱**：文档未见细粒度权限/沙箱模型（云端托管执行，安全模型不暴露给用户）。

**并行执行**：**Wide Research**——主 Agent 把请求分解为数百个独立子任务，每个子任务给专用 Agent + 全新上下文窗口并行处理，最后汇总（明确以「解决上下文窗口饱和导致的质量衰减」为设计动机，实测 250 项目无衰减）。

**计划能力**：未见独立 plan mode；以任务描述 + 项目指令约束。

**UI 与工作台**：Web 任务流 + Collab 实时协作 + Design View + 分享回放（replay）。

**对 Histos 有参考价值的设计点**：
- **Wide Research 的「每项一个全新上下文」架构**：与 Claude Code subagent、Devin 托管 Devins 共同确立了「大规模并行 = 上下文隔离 + 主 Agent 只做分解与汇总」的共识模式；Histos 画布批量节点执行应遵循同一原则。
- **项目级「配置继承 + 更新生效规则」**：明确区分「对进行中任务即时生效」vs「只对新任务生效」——Histos ContextSet/ViewState 版本化时需要同样清晰的传播语义。
- **任务回放（share + replay）**：事实层会话的可视化重放，与 Histos JSONL 回放视角一致。

---

## 1.8 证据化阅读说明

逐产品段落保留既有深度研究，但其证据强度现在以 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md) 为准：

- **E1/E2**：本轮页面正文或官方专题导航可复核；适合写成“该页面明确描述/提供专题入口”。
- **E3**：既有报告曾抓取并记录，但本轮没有逐页重放；适合保留为研究线索，不应单独支撑“行业已验证”统计。
- **U**：本轮入口过薄、超时或认证失败；只能写“本次页面未确认”，不能写成“不支持”。

因此，本报告中的 `7/7`、`6/7` 统计解释为**既有报告覆盖统计**，不是七个入口页都达到同一深度的独立复核结果。涉及权限、沙箱、自动化、成本和长期记忆时，必须同时注明页面范围、资料性质和失败行为是否被文档明确规定。

### 竞品事实、Ravel 对应物与不可声称项

| 比较对象 | 可以比较的事实 | Ravel 的对应物 | 不应声称 |
|---|---|---|---|
| Plan / 任务规划 | 是否有只读规划、审阅和执行处置 | 可做成 `PlanRevision` → ContextSet → Flow | 不能把普通任务描述写成独立 Plan mode |
| 并行代理 | 是否有独立上下文、隔离工作区、预算和回收 | 当前有 AgentHarness lanes/队列；子 agent worktree 编排按设计暂缓 | 不能把“支持并行”写成已有 worktree 隔离 |
| 权限 / 沙箱 | 具体 allow/prompt/deny、路径边界、失败行为 | 四档 profile、Project Trust、成对审批、path containment | Ravel 不宣称 OS/container/VM sandbox；云端执行也不自动等于沙箱 |
| 记忆 / 知识 | 注入范围、检索触发、写入审批、删除/回放 | FactAddress、ContextSet、durable artifacts；工作区记忆仍缺产品闭环 | 不能把派生索引或一次性上下文写成长期记忆 |
| 自动化 | 触发器、预算、预授权、失败恢复 | 当前未产品化；可沿用 Validate + approval + facts | “已计划”筛选或文档导航不等于已验证调度器 |
| 成本 / 用量 | 是否能按会话/Flow看到 token、延迟、成本 | 有 telemetry/eval 基础设施；语义凝练成本产品化仍缺 | 不能把套餐额度或通用 span 写成 per-Flow 成本产品 |
| 图 / 工件 / 回放 | 是否有版本、证据、回放和可治理对象 | Histos GraphRevision/FlowRevision/ContextSet/ViewState | “任务看板”或时间线不等于内容寻址语义图 |

### 限定后的差异化结论

在**本次检查的七个站点与页面范围内**，未发现与 Ravel 同时具备“无限画布 + 内容寻址工件语义图 + Convert → Validate → Approval → Pi 受控执行”这一组合的产品。这个结论是范围限定的观察，不是对整个市场的穷尽性“唯一”声明。

---

## 二、跨产品功能矩阵表

✅ = 完整支持　⚠️ = 部分/受限/需说明　❌ = 未见文档支持

| 功能维度 | ZCode | Claude Code | Devin | omp | Codex | Hermes | Manus |
|---|---|---|---|---|---|---|---|
| 桌面/本地优先形态 | ✅ Electron 桌面端 | ✅ 桌面 App | ⚠️ 云为主，CLI/Desktop 辅助 | ⚠️ 终端优先 | ✅ 并入 ChatGPT 桌面 | ✅ 桌面 + CLI + 常驻服务 | ❌ 云端 Web |
| 仅追加/可恢复会话持久化 | ✅ 任务+会话历史 | ✅ 会话历史 | ✅ 云端会话+事件时间线 | ✅ JSONL 自动持久化 | ✅ 分页线程历史 | ✅ SQLite 全会话 | ✅ 云端任务 |
| 会话分支/fork | ✅ 消息级分叉 | ✅ fork(/subtask)+worktree | ⚠️ 无显式 fork，有并行会话 | ✅ branch(会话内树)+fork(新会话) 双原语 | ✅ 线程分叉(含临时) | ❌ 未见 | ❌ 未见 |
| Plan mode | ✅ 执行模式之一 | ✅ 权限模式之一 | ⚠️ Ask Devin 规划 | ✅ 独立模式+5种审批处置 | ⚠️ 未见独立模式 | ⚠️ /plan 技能 | ❌ |
| 目标/完成校验自动续跑 | ✅ 目标模式(实据校验) | ⚠️ Routines/loop | ⚠️ 托管 Devins 自主收口 | ⚠️ goal mode(提及) | ⚠️ 计划任务 | ⚠️ cron+自主闭环 | ❌ |
| 并行子代理 | ✅ 前/后台子智能体 | ✅ subagent+fork+teams | ✅ 托管 Devins(独立VM) | ✅ subagents | ✅ 多智能体 V2 | ✅ subagents+Bot Mode | ✅ Wide Research(百级) |
| Git worktree 并行隔离 | ❌ | ✅ 自动 per-session worktree | ⚠️ 云端 VM 隔离等效 | ❌ | ❌ | ❌ | ❌ |
| 上下文自动压缩 | ✅ 不可配置阈值 | ✅ /compact+自动 | ⚠️ 云端托管(未公开) | ⚠️ 压缩为 Plan 审批选项 | ✅ 远程压缩(图片预算) | ⚠️ 记忆有界+检索替代 | ❌ |
| 跨会话长期记忆 | ✅ 项目记忆(默认关,不可查看) | ✅ auto memory(四类+索引+按需) | ✅ Knowledge(触发式检索) | ❌ 靠会话检索 | ✅ Computer History+/import | ✅ MEMORY/USER+FTS5+技能三层 | ✅ 项目知识库(任务继承) |
| 项目指令文件 | ✅ AGENTS.md(两级) | ✅ CLAUDE.md(四级+rules) | ✅ AGENTS.md | ✅ project rules | ✅ AGENTS.md+信任门控 | ✅ AGENTS.md/SOUL.md+注入扫描 | ✅ 项目主指令 |
| 权限分级(多档执行模式) | ✅ 四档 | ✅ 五档+deny 规则 | ✅ 安全 Profile+权限作用域 | ✅ 三档+每工具 override | ✅ 权限模式+信任+配置文件 | ✅ smart/manual/off+硬线黑名单 | ❌ 未暴露 |
| OS 级沙箱/容器隔离 | ❌ 未见 | ⚠️ worktree+分类器 | ✅ CLI bwrap 沙箱+域名过滤+fail-closed | ❌ 靠审批 | ✅ Windows 提权沙箱+插件隔离 | ✅ Docker/Modal 等 6 后端 | ❌ 云端托管 |
| MCP 支持 | ✅ stdio/HTTP/SSE | ✅ 标准+连接器图形化 | ✅ MCP 市场+Devin MCP | ✅ MCP+自定义工具 | ✅ 2026-07-28 协议+WebMCP | ✅+工具过滤 | ✅ 连接器+自定义 MCP |
| 技能/可复用工作流 | ✅ 技能+命令+插件 | ✅ Skills+hooks+插件 | ✅ Skills(SKILL.md)+Playbooks | ✅ skills+extensions | ✅ 技能+插件市场 | ✅ 技能自创建/自改进+Hub | ✅ Manus Skills |
| 定时/事件驱动自动化 | ✅ 定时任务+闲时任务(算力换免费) | ✅ Routines(云端)+事件 | ✅ 五源事件触发(最全)+模板库 | ❌ 未见 | ✅ Gmail/Slack/GitHub 事件触发 | ✅ cron+多平台投递 | ✅ Scheduled Tasks |
| Git/PR 深度集成 | ✅ 分支选择+提交前检查 | ✅ PR 监控 Auto-fix/merge+CI | ✅ GitHub/GitLab/Bitbucket+Stacked PR | ✅ GitHub 上下文 | ✅ PR 评审+GitLab | ⚠️ 经工具/MCP | ⚠️ 网站构建器 GitHub 同步 |
| 成本/用量统计 | ✅ 最完善(应用+套餐+重置卡) | ✅ 订阅+API 用量 | ✅ ACU 计量+限额+会话级追踪 | ⚠️ 模型自选自带 | ✅ 积分+配额+分析 API | ⚠️ 模型 token 记录 | ✅ 积分制 |
| 会话/知识分享与导出 | ❌ 未见 | ⚠️ 跨端迁移 | ✅ 会话链接+回放分析 | ✅ HTML 导出+加密分享+JSONL 交接 | ✅ 只读快照+协同 | ⚠️ 轨迹导出(研究向) | ✅ share+replay |
| 记忆/学习过程可视化治理 | ❌ | ⚠️ /memory+/context 查看 | ⚠️ 知识文件夹管理 | ❌ | ⚠️ Computer History 时间线 | ✅ /journey 星图(可删改) | ❌ |
| IDE 集成 | ⚠️ 自有工作台 | ✅ VS Code/JetBrains | ✅ 自有 IDE+ACP(JetBrains/Zed/Xcode) | ✅ ACP 客户端 | ⚠️ 桌面并入 ChatGPT | ❌ 终端/消息平台 | ❌ |

---

## 三、共性趋势总结

以下是**既有报告对七个产品深度页面的覆盖统计**，不是本轮七个入口页在同一证据深度下的独立验证。它们可作为需求基线，但应按证据台账复核后再升级为“行业标配”：

1. **Plan mode / 先规划后执行**（既有报告 6/7）：只读探索→出计划→人审→执行，作为权限模式或独立模式。入口页未明确独立 Plan mode 的产品，不应仅凭“复杂任务分步”计入。
2. **并行子代理 + 上下文隔离**（既有报告 7/7）：主 Agent 分解与汇总、子代理各持独立上下文；并行不自动意味着 worktree 隔离、预算治理或可回收。
3. **MCP 支持**（既有报告 7/7）：外部工具接入方向；传输类型、连接器市场和审批边界必须逐站确认。
4. **多档权限分级**（既有报告 6/7）：从每步确认到自动放行的档位；是否有每工具 override、路径边界和 fail-closed 行为不能由入口页推断。
5. **技能/可复用工作流**（既有报告 7/7）：SKILL.md、插件或 Playbook 形态各异；“可复用”不等于支持自动蒸馏和人审。
6. **定时/事件自动化**（既有报告 7/7）：从 cron 到事件驱动；“已计划”筛选、Routines 导航或任务描述不等于已确认调度器、预算和失败恢复。
7. **会话持久化 + 恢复/续接**（既有报告 7/7）：应进一步区分历史可见、断点恢复、崩溃尾部处理和无人值守重试。
8. **Git/PR 集成**（既有报告 6/7）：提交、PR 评审、CI 联动是不同能力；不能以 Git 快照或代码托管集成替代完整 PR 闭环。
9. **跨会话长期记忆**（既有报告 6/7）：触发式检索、auto memory、项目知识库和有界精炼记忆并非同一机制；作用域、写入审批和删除治理应单独记录。
10. **成本可见性**（既有报告 6/7）：套餐/额度、token 统计、per-session/per-Flow 成本和预算阻断属于不同层次；本轮多数入口页未展开这些细节。

**本轮逐页可复核层**：Claude 入口页可确认多端会话、并行代理、MCP、Skills/Hooks、计划任务与 IDE/CI 导航；Devin 简介页可确认自主编码工作面、并行处理、集成与 CLI handoff；Hermes Persistent Memory 页可确认有界记忆、FTS5 检索、写入审批和 `/journey` 治理；Manus Projects 页可确认项目继承、配置传播和私密协作；omp 入口主要只确认定位；ZCode 部分抓取超时；Codex 第三方镜像本轮认证失败。完整边界见证据台账。

**次级趋势**（4/7 左右，差异化窗口）：
- 无人值守执行的治理（ACU 预算、触发限流、闲时队列、保持唤醒）；
- 会话分支/fork 作为一等原语；
- 从竞品导入（Codex `/import`、omp `--from-claude/--from-codex`、Devin 配置导入）——换轨成本竞争已开始；
- 加密分享/回放（omp、Manus）。

---

## 四、「图 / 上下文 / 记忆」专项对比（与 Histos 最相关）

### 4.1 上下文选择：谁决定什么进入上下文？

| 产品 | 机制 | 与 Histos 的关系 |
|---|---|---|
| Claude Code | 四级 CLAUDE.md 全量拼接 + rules 按 paths 条件加载 + auto memory 索引(200行)常驻、主题文件按需 + subagent 只回传摘要 | **「小索引常驻 + 大库按需」**与 Histos 凝练层同构，是最值得对标的参照系 |
| Devin | Knowledge 条目带触发描述，相关性命中才检索；可按仓库固定 | **触发式检索**=ContextSet 选择器的产品化表述；「固定到仓库」≈ ContextSet 作用域绑定 |
| Hermes | 三层：有界记忆冻结快照常驻（保 cache）/ FTS5 全文检索按需 / 技能渐进披露三级加载 | **成本显式建模**（每层都标注 token 代价），Histos ViewState 渲染应同样分级 |
| omp | 上下文处置交给用户显式选择（Plan 审批时：全新/压缩/保留） | **用户主权式上下文管理**，Histos 画布「拖选节点→组装上下文」的交互可借鉴其五选项 |
| Manus | 项目主指令+知识库自动注入新任务；更新传播分「即时 vs 仅新任务」 | 配置继承的**版本语义**清晰，ContextSet 更新时应区分对运行中/新节点的影响 |
| ZCode | `@ # / $` 四符号手动补充 + 历史会话引用 + 划选追问 | 手动上下文装配的交互词汇表最丰富 |
| Codex | 记忆随线程、远程压缩、`/import` 外部记忆 | 迁移友好 |

**关键结论**：行业已从「全量注入」转向「**分层 + 按需检索 + 显式装配**」三轨并行。Histos 的 ContextSet 天然属于第三轨（显式装配），但应补齐第一轨的自动索引与第二轨的触发式检索作为默认兜底。

### 4.2 记忆：知识如何沉淀与治理？

- **写入侧**：三家做了「Agent 自动提炼 + 人审门控」——Devin 知识建议（AI 提议、人编辑保存）、Hermes 后台自评审 + write_approval staged diff、ZCode 项目记忆（全自动但默认关闭、不可查看——反面教材：沉淀不可见导致不可信）。**共识：自动沉淀必须配可审查出口。**
- **容量治理**：Hermes 的「有界 + 满员报错让 Agent 自行合并」是唯一拒绝静默压缩的设计；Claude 的 MEMORY.md 索引上限同理。Histos 凝练层作为「可重建索引」应明确：**重建是确定性函数，压缩是有损决策，两者不能混在一个不可见的过程中。**
- **组织分层**：Devin（个人→组织→Enterprise 三层 + 文件夹 + 批量启停 + 提升机制）是知识治理最完整的；Hermes（本地/项目/外部目录三层 + 信任机制 + 安全扫描隔离）在安全治理上最完整。
- **过程性知识**：Devin Playbook 从成功会话蒸馏 + 用失败案例对比改进、Hermes 技能自创建/自改进 + Hub 分发——「Convert to Flow」的竞品基准是「**从会话事实自动生成受控流程，且流程本身可迭代**」。

### 4.3 图与可视化：目前没有直接对标物，但有两个近亲

- **Hermes /journey（Star Map）**：把「技能 + 记忆条目」绘成可回放时间线/星图，节点可编辑/删除/归档。这是「学习过程图形化 + 图元治理」的已落地实现——与 Histos 可视层语义图的目标重叠度最高，但其图为「时间轴 + 学习事件」而非「工件依赖图」。
- **Devin Spaces + Agent Command Center**：任务→会话/PR/文件/上下文的聚合视图（卡片看板，非自由画布）。
- **Codex Computer History**：跨应用活动自动转为「记忆 + 时间线」，是「从原始事实流自动生成时间线可视化」的机器侧管线。
- ** omp /branch + /tree**：会话内路径树——最接近「图结构演化历史」的会话原语。

**差距判断**：在本次检查的七站页面范围内，没有发现同时提供「无限画布 + 工件级语义图 + 受控执行（Convert to Flow）」的组合。最接近的三块拼图分散在 Hermes（学习图）、Devin（任务空间聚合）、omp（分支树）中。**Histos 的差异化窗口在该范围内成立，但不是全市场穷尽性声明**；仍需吸收三者已记录的设计：图节点可治理（删/改/归档，参照 /journey）、图可回放（参照 Manus replay / omp /tree）、图到执行带审批与上下文处置选择（参照 omp Plan 审批、Devin Convert-to-playbook）。

### 4.4 给 Histos 的十条具体建议（按优先级）

1. **P0 接入生产 semanticProvider，并补凝练 eval/成本遥测**——这是语义 LOD、触发式检索和 skill 蒸馏的总闸门；不能把已有编排接口当成端到端能力。
2. **P0 修复 checkpoint 的 fail-closed 后置校验**——`update-ref` 成功返回不等于 ref 已存在；必须用 `rev-parse --verify` 等后置条件阻断静默成功。
3. **P1 GraphRevision 结构化 diff → 图回放**——利用现有 canonical artifact、revision DAG 和 JSONL 顺序，先提供 added/removed/changed/moved/rerouted，再把时间回放做成可见能力。
4. **P1 Plan-as-Artifact**——只读探索产生可审的 `PlanRevision`，用户显式选择 ContextSet 处置，再复用 Convert → Validate → Approval → Pi；不新增第二套计划权威。
5. **P1 完成超窗收缩 UX 与交互式嵌套 Sub Flow UI**——把已有 `budget_exceeded`、compound layout 和 Validate 契约接到用户可操作的重选、进入子图和重试流程。
6. **P2 工作区内触发式检索与 reviewed memory**——命中先生成 ContextSet 草稿，展示证据和触发原因，人审后才冻结并追加 `context_attached`。
7. **P2 skill 蒸馏闭环**——从成功/失败 GraphRevision 生成 skill draft，沿用 Draft → Diff → Apply 和现有审批事实，不允许静默写入。
8. **P2 定时 Flow 与无人值守治理**——预算上限、触发限流、明确预授权、失败后诊断不重跑；不要先造独立 cron 权威。
9. **P2 每工具 override / 档位热切换**——扩展现有策略表为 `tool+pattern → allow/prompt/deny`，继续走成对审批事实。
10. **P2 分享/导入与 PR 面板按需求重估**——先定义版本、信任、敏感信息和权限边界，再决定是否支持加密分享、竞品导入或 PR 评审。

---

*报告完。结论基于既有抓取记录与本轮证据边界复核，具体页面状态见 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。对入口过薄、超时、认证失败或第三方镜像内容，统一标注为 E3/U 或“本次页面未明确说明”，不据此判定产品不支持。*
