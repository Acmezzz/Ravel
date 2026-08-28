# 七个 Agent 文档证据台账

> 目的：为 `competitive-analysis-7-agents.md` 提供可复核的来源边界，避免把营销定位、入口页导航、专题页事实和 Ravel 源码结论混成同一种证据。
>
> 研究日期：2026-08-28。用户指定入口：ZCode、Claude Code、Devin、omp、Codex、Hermes Agent、Manus。除 Codex 外，来源按官方文档站处理；Codex 采用用户指定的第三方 `codex-docs.com` 镜像，不能与官方一手资料等量齐观。

## 1. 证据等级与判定规则

| 等级 | 含义 | 可以支持的结论 |
|---|---|---|
| **E1** | 本轮直接读取的页面正文明确写出 | 可写入事实，但仍要限定到该页面和日期 |
| **E2** | 官方站内专题页或入口页明确链接/导航到该能力；正文细节未在本轮完整读取 | 只能写“官方文档提供该专题入口”，不能把导航当成完整实现证明 |
| **E3** | 现有 artifact 记录的既有抓取结果；本轮未独立复核 | 可保留作工作假设，必须注明“来自既有报告” |
| **U** | 本轮超时、认证失败、入口页过薄或来源性质不明 | 不得据此判断支持或不支持 |

统一规则：

1. **未见文档 ≠ 不支持**。正确写法是“本次检查页面未明确说明”。
2. “产品定位”“文档导航”“能力宣称”“可操作细节”“源码验证”是五种不同证据，不能用一个 ✅ 代替。
3. 跨产品统计只有在分母、页面范围和证据等级一致时才成立。若混有 E2/E3/U，应改为“现有报告记录的覆盖统计”，而不是“已独立验证的行业事实”。
4. 竞品的云端隔离、套餐、企业安全或营销用语，不等于可与 Ravel 的本地 IPC/路径安全实现直接比较的工程保证。
5. Ravel 的实现状态以当前工作树和源码/测试盘点为准；竞品文档只能提供需求基线，不能替代 Ravel 验收。

## 2. 七站来源总表

| 产品 | 用户指定入口 | 来源性质 | 本轮状态 | 可直接复核范围 |
|---|---|---|---|---|
| ZCode | <https://zcode.z.ai/cn/docs/welcome> | 官方文档 | **U / 入口页细节不足** | 入口页被读取尝试；既有报告保留 E3 深度记录 |
| Claude Code | <https://code.claude.com/docs/en/overview> | 官方文档 | **E1 + E2** | 入口页明确写出多端会话、并行代理、CLAUDE.md/自动记忆、MCP、Skills/Hooks、Routines/计划任务、IDE/CI 导航；专题细节见站内链接 |
| Devin | <https://docs.devin.ai/zh/get-started/devin-intro> | 官方文档 | **E1** | 简介页明确写出自主编码/运行/测试、任务类型、Workspace、Browser/Shell/IDE、并行处理、集成、CLI handoff；长期记忆、沙箱、计费细节未在该页说明 |
| omp | <https://omp.sh/docs> | 官方文档 | **E1（仅定位）** | 给定入口页明确写出“coding agent with the IDE wired in”；运行、会话、权限等专题本轮未从该页正文复核 |
| Codex | <https://www.codex-docs.com/docs/changelog> | **第三方镜像** | **U / 本轮认证失败** | 不能把现有 changelog 摘要当作本轮复核；仅保留既有 artifact 的 E3 标注 |
| Hermes Agent | <https://hermes-agent.nousresearch.com/docs> | 官方文档 | **E2 + 专题 E1** | 入口导航明确指向 memory/skills/tools/cron/security 等专题；Persistent Memory 页面明确写出有界记忆、FTS5 会话检索、写入审批、profile 隔离、/journey 治理 |
| Manus | <https://manus.im/docs/zh-cn/features/projects> | 官方文档 | **E1** | Projects 页明确写出持久工作区、主指令/知识库、任务继承、配置传播、私密协作、计划任务筛选、项目数量不限；未说明完整权限、集成、成本和并行机制 |

## 3. 页面级事实记录

### ZCode

- **E1/U：**给定入口页本轮未稳定返回可核对正文，不能把现有报告中的目标模式、闲时任务、项目记忆、用量统计等重新标成“本轮已验证”。
- **E3 保留：**`competitive-analysis-7-agents.md` 记录了目标模式实据校验、闲时/定时任务、子智能体、会话分叉、`@/#/$` 上下文入口、四档执行模式、MCP/插件和用量统计。这些内容在本台账中仅作为既有报告记录，待下次按具体专题 URL 逐页复核。

### Claude Code

入口页正文明确或链接明确：

- **Sessions（E1/E2）：**会话可在终端、IDE、桌面、网页和移动端之间延续；页面导航到 Remote Control、网页、移动端、`--teleport` 和 `/desktop`。
- **Memory（E1/E2）：**`CLAUDE.md` 用于项目指令，页面同时提到自动记忆；详细加载和治理规则不在入口页展开。
- **Sub-agents（E1/E2）：**可启动多个代理并行处理任务，由主代理分配和汇总；页面导航到 Sub-agents、Background agents 和 Agent SDK。
- **MCP（E1/E2）：**用于连接 Google Drive、Jira、Slack 或自定义工具。
- **Skills/Hooks（E1/E2）：**Skills 封装可复用工作流；Hooks 可在操作前后运行命令。
- **Scheduled tasks（E1/E2）：**入口页列出云端 Routines、本地桌面计划任务、`/loop` 和 `/schedule`。
- **IDE/CI（E1/E2）：**列出 VS Code、Cursor、JetBrains、桌面、网页，以及 GitHub Actions、GitLab CI/CD 和代码审查。
- **本页未展开（U）：**worktree 细节、完整权限档位、用量/成本统计、auto memory 的具体容量与作用域。

### Devin

简介页正文可直接支持：

- **定位和任务（E1）：**自主编写、运行、测试代码的 AI 软件工程师；可处理工单、功能、缺陷、测试、迁移、重构、PR Review 和文档等。
- **工作面（E1）：**从 Web 应用委派任务，在 Workspace 查看开发过程；Browser 可浏览/测试 Web 应用并上传下载，Shell 展示命令和输出，IDE 可运行命令、改代码和测试。
- **并行与交接（E1）：**页面描述并行处理大量任务；CLI 支持 `/handoff` 将本地任务移交云端会话。
- **集成（E1）：**页面导航/说明涉及 Linear、Jira、Slack、Microsoft Teams、Devin API 和 Devin CLI。
- **未明确（U）：**独立 Plan mode、长期记忆/Knowledge 的范围、沙箱/凭据/审计、自动审批、计量与价格。不能用该简介页的缺失证明这些能力不存在。

### omp

- **E1：**给定入口页只明确其定位为“coding agent with the IDE wired in”。
- **U：**本轮不能从该页正文确认 JSONL 恢复、branch/fork、三层 tool approval、Plan Review、MCP 或加密分享；这些保留为既有报告的 E3 记录，需逐专题页面复核。

### Codex（第三方镜像）

- **E3/U：**既有报告根据 `codex-docs.com` changelog 记录了持久线程、任务仪表板、多智能体、MCP、事件触发计划任务、竞品导入、权限配置和安全框架等内容。
- **证据限制：**该站是第三方镜像；本轮访问出现认证失败。因此只能在正文中标记为“第三方资料、既有报告记录”，不得在“官方已验证统计”中计入。

### Hermes Agent

- **E2：**入口导航指向 architecture、memory、skills、tools、MCP、bot mode、cron、security、platform support 等专题。
- **E1（Persistent Memory）：**`MEMORY.md` 与 `USER.md` 有字符上限；会话检索使用 SQLite FTS5，容量不限且无需模型调用；记忆启动时注入冻结快照；超限不自动压缩，写入失败后要求合并、替换或删除再重试。
- **E1（审批与治理）：**开启 `memory.write_approval` 后，前台和后台写入均需审批；非交互平台可通过 pending/approve/reject 管理暂存写入。
- **E1（作用域与可视化）：**内置记忆按 Hermes profile 隔离；`/journey` 在 CLI、TUI 和桌面展示记忆/技能时间线，支持编辑和删除，技能删除后归档。
- **U：**入口页未直接证明所有消息平台、终端后端、命令审批和计算机控制细节；现有报告的更广泛数字仍为 E3。

### Manus Projects

Projects 页正文可直接支持：

- **E1（项目）：**项目是面向重复工作的持久工作区，保存主指令和文件/知识库；新任务继承项目设置。
- **E1（传播）：**指令变更在当前任务下次发消息时生效；文件变更只影响之后新建的任务；旧任务不回溯变化。
- **E1（协作与隐私）：**项目/任务默认私密；成员可用共享指令和知识库，但只能看到自己创建的任务，具体任务需单独邀请。
- **E1（组织与计划）：**支持置顶、拖放排序、按项目/收藏/已计划筛选；项目数量没有限制。
- **U：**本页未明确独立会话模型、并行执行、权限角色、审计/加密、外部集成、Artifacts、令牌或运行成本。

## 4. 可用于横向比较的最小事实集

以下是推荐写入矩阵的最小粒度。只有达到对应证据等级才填“已确认”；否则填“未在本轮页面确认”。

| 维度 | 可接受证据 | 当前较稳妥写法 |
|---|---|---|
| 会话持久化/恢复 | 专题页明确恢复规则 | Claude/Devin/Manus 入口可确认部分会话/任务连续性；omp/Codex/ZCode/Hermes 的更细规则来自 E3 |
| Plan | 明确 plan 页面或入口正文 | 不把“复杂任务建议分步”当作独立 Plan mode |
| 并行 | 明确子代理/并行页面 | 入口只写“可并行”时保留产品宣称，不推导隔离、预算和回收 |
| 记忆 | 明确作用域、写入、检索、治理 | Claude/Devin/Hermes/Manus 的具体形态分开写；“有知识库”不等于长期记忆 |
| 权限/沙箱 | 明确规则、边界和失败行为 | “云端运行”不等于已验证沙箱；“支持权限”不等于每工具 override |
| 自动化 | 明确触发器、调度、失败/预算 | “已计划”筛选不等于计划任务执行引擎 |
| 成本/用量 | 明确计量字段和可见性 | 套餐存在不等于 per-session cost telemetry |
| 图/工件/溯源 | 明确数据模型与回放/版本规则 | 不把任务看板或时间线写成语义图 |

## 5. 本轮限制与下一次复核

- ZCode、Codex 及部分专题页本轮出现超时或认证失败；不应通过猜 URL、反复重试或入口页推断细节。
- 现有两个 artifact 的深度结论仍有价值，但应统一标为 E3，直到补入具体页面标题、URL、访问日期和短摘录。
- 下次复核只需更新本文件的来源表和各产品事实集，再同步矩阵统计；不需要重写 Ravel 源码盘点。
- 本台账不记录用户系统路径、凭据或任何本地敏感信息；它只描述公开文档证据边界。
