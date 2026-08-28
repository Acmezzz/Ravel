# 示例 Agent 借鉴设计（prime-agent / kilocode / oh-my-pi / opencode）

日期：2026-08-28
状态：**借鉴决策文档。** 不改变 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md) 的切片顺序，只为剖面与后续切片补充来源证据和接口位。四库均 MIT（prime-agent 另含上游 Pi 版权），可携码，必须保留出处注释。

四个库的完整调研记录在会话产出中；本文只留净结论。筛选标准与既往一致：

1. 能接入 Histos（fact 类型 / 工件 kind / 处理剖面），或填补 next-cycle 已列缺口。
2. 不新增第二权威（存储、审批库、runtime）。
3. 与 Ravel 的 Electron + Pi JSONL + utilityProcess 形态兼容。
4. 效果可验证；营销性/平台绑定（Effect/Bun/Rust native）功能只取设计不取码。

---

## 1. 立即采纳（本周期内，随 N* 或紧随其后）

### A1 通配符权限规则 + 规则放行的可审计事实（来源：opencode permission/index.ts、kilocode 同款）

- 现状：Ravel 四档 profile + 19 类操作策略表，缺 `tool+pattern → allow/ask/deny` 粒度（竞品压力项 G7）。
- 借鉴：规则形如 `{ permission, pattern, action }`，`findLast` 最后匹配生效，默认 ask；Windows 下 `\`→`/`、大小写不敏感、尾部 ` *` 可选。
- Histos 接入：命中 allow/deny 的自动决策**不是 UI 瞬态，而是事实**——`approval_asked` 携带可选 `ruleSource`，`approval_decided.reasonCode` 闭集扩入 `rule-allow` / `rule-deny`。codec 透传未知字段，向后兼容，老会话不受影响。
- 不可绕过层（学 kilocode `ConfigProtection` + omp safety overrides）：内置破坏性 bash 模式和敏感路径（`.env`、`.git/`）永远降级为 ask，用户 allowlist 不可覆盖；这正是「mode can only narrow」不变量在规则层的镜像。
- 落点：`electron/permission-rules.js`（评估器 + `~/$HOME` 展开）；规则存 user 级与 project 级（信任门控），复用 mcp.json 的目录锁原子写。

### A2 plan 模式补全：计划文件 + 人审退出（来源：kilocode plan agent、omp plan-mode、prime plan-mode 扩展示例）

- 现状：N3 已交货 ModeProfile + 工具白名单 + 强制 read-only。
- 借鉴三家共同形态：plan 的产物是**一个计划文件/工件**，`plan_exit` 是一次人审事件；批准后以注入「计划已批准，执行」的合成人物消息切回执行档，而不是把计划留在聊天文本里。
- Histos 接入：计划文件内容 = `plan.explore` 剖面产出的 GraphRevision 的可读投影；批准 → 现有 Convert → Validate → Approval → Pi。不新增 kind（next-cycle 已冻结）。

### A3 迭代压缩的「前摘要合并」契约（来源：opencode compaction.ts SUMMARY_UPDATE_TEMPLATE、kilocode compaction.txt、prime compaction）

- 三家收敛到同一设计：摘要不是每次全量重打，而是 `<previous-summary>` + 新段落增量合并；固定分节模板；保留最近 N 轮原文；旧工具输出截断到 2k 字符。
- Histos 接入：Ravel 的 compaction 已经是「新 entry + operation」事实（不变）；本项改的是**送给模型的结构化摘要契约**，属语义透镜/凝练编排的 prompt 层，不动事实层。补一条测试：连续两次 compaction 的摘要合并保持 round-trip 与 evidence 不悬空。

### A4 Context Epoch 式基线上下文（来源：opencode CONTEXT.md / context-epoch.ts，设计移植）

- 模式：上下文源注册表，每源带 codec；基线每 epoch 渲染一次并吃 provider prompt cache；变化在安全边界以「系统更新」消息注入历史中段。
- Histos 接入：`context_attached` 已解决「当时带了什么」；本项解决「带了之后变了怎么办」。作为 ContextSet 冻结的**传播规则**实现：已冻结工件不可变，新消息引用的是下一个 `context_attached`，旧事实不改写。与 Manus「指令即时生效 vs 文件仅新任务」语义对齐。
- 只取设计，不搬 Effect/SQLite 实现。

## 2. 列入后续切片（明确接口位，不立即动手）

| # | 借鉴项 | 来源 | Histos 接入位 | 备注 |
|---|---|---|---|---|
| B1 | 证据完成判据（missing_terminal_evidence、gate 失败拍 git 快照、禁止自陈完成） | prime autonomous.ts | Flow 节点完成判据 = 锚定 FactAddress 的证据事实（next-cycle B4） | prime 的 prompt 措辞直接借用其审计式表述 |
| B2 | refinement 履历（trigger/changes/evidence/outcome + rollbackOf） | prime refinement.ts | `resource.distill` 的 skill 版本链：Draft→Diff→Apply 已有，缺的是每条改动的证据履历 | JSONL 追加 + rollbackOf 与 revision DAG 同构 |
| B3 | 结构化子代理产出（schema 校验 yield）+ 子代理权限继承（inherit denies） | kilocode subagent-permissions / omp structured-subagent | 未来嵌套 Sub Flow 的节点输出契约 | 与「子 agent worktree 编排」重估项绑定 |
| B4 | @mention 解析为类型化部件（file/agent/dir）+ `!`cmd`` 注入 | kilocode/opencode markdown.ts | Composer → ContextSet 候选装配；预算裁剪不变 | Ravel 已有 @文件补全与 @session，缺统一部件模型 |
| B5 | 会话租约 + 孤儿进程 journal（owner token + 进程启动 id 防 pid 复用） | prime session-lease/orphan-process-journal | worker 恢复语义增强（stale generation 已有，补 OS 级防串话） | Windows 用 GetProcessTimes 创建时间替代 start-id |
| B6 | 定时任务：once/cron/interval + busy 时 steer/follow_up 投递 + run/skip/error 计数 | prime cron-jobs.ts | 未来「定时 Flow」触发器：每次触发 = flow_trigger 事实，引用预授权工件 | 1735 行只取记录形状与投递语义 |
| B7 | 导出脱敏 pass（字段级 [redacted:...]）+ share secret-in-URL | opencode export.ts / omp collab crypto | HTML 导出升级 + 未来加密分享 | 竞品 G8 |
| B8 | BashArity：子命令前缀提取（tree-sitter 解析后取最小可读前缀） | opencode arity.ts | A1 规则的 pattern 提取增强（MVP 先做 token 截断） | wasm 依赖较重，验证收益后再引 |
| B9 | 破坏性切换前人审事件（session_before_fork/switch cancel） | prime confirm-destructive 示例 | 会话 fork/switch 走高副作用操作策略表 | 现状仅 delete 有策略门 |
| B10 | 固定宽度 title slot 首行（列表 O(1)，不解析全文） | omp session-title-slot.ts | JSONL 会话列表性能 | 与 Pi v3 header 兼容性需先验证 |

## 3. 基线补齐（2026-08-28 用户决策：竞品普遍具备的功能 Ravel 必须有）

| # | 能力 | 现状 | 借鉴来源 | 接入位 |
|---|---|---|---|---|
| C1 | MCP 网络传输（http/sse/streamable） | 已有 stdio；缺网络传输 | opencode mcp/index.ts（1005 行）的传输层与状态机 | 工具注册仍走 `mcp__server__tool` + untrusted 审批；新增 needs_auth/failed 状态入资源中心与 MCP 节点 |
| C2 | MCP OAuth / 凭据 | 无 | opencode oauth-provider/oauth-callback；prime 的「登录门控集成」概念 | 凭据进现有 safeStorage vault；登录是 UI 动作，不是模型工具 |
| C3 | skill/plugin 在线获取 | 仅本地路径安装 | kilocode 远端 registry（index.json 拉取）+ omp 的 reverse-domain 命名空间纪律 | 下载进本地暂存区，展示来源+SHA-256，人审后走现有 installLocalResource；不跑安装脚本 |

这三项不改变「单一事实写者、fail-closed 审批、无第二权威」；改变的是原「按设计排除」清单中「MCP 网络传输、OAuth 当 MVP、网络安装 skills」三行（核心设计 §2.7 同步勘误）。

## 4. 不采纳（附理由，防重复评估）

- **事件源 SQLite 权威**（opencode event 表）：Ravel 权威是 JSONL + Git，sqlite 是派生可删索引；换权威违反核心不变量。取其 projector 折叠思想（graph 增量投影）即可。
- **Python kernel 作为唯一工具面**（prime RLM 架构）、**Bun/Rust natives**（omp）、**Effect 全栈**（opencode/kilo）：平台与栈承诺不匹配。
- **HTTP 多客户端 + SSE 服务面**（opencode server、kilo serve）：Ravel 是 Electron 单进程家族，IPC 面已覆盖；本地 HTTP server 在核心设计「明确不抄」清单。
- **snapcompact 位图视觉压缩、TTSR 流中规则注入、vibe director、advisor 双模型评审**：单独立项评估，本周期不引；TTSR 与 Ravel「压缩/注入必须显式可审计」需要逐条对照后才能定。- **Agent Manager 20k LOC 面板**（kilo）：取 per-session worktree + PR poller 概念（本就是重估项），不取码。

## 4. 元收获：上游同步纪律（来源：omp docs/porting-from-pi-mono.md）

omp 用一份「porting playbook」维护对上游 pi-mono 的长期 fork：scope 映射表、`Features We Added (Never overwrite)` 清单、intentional divergences、逐 commit 同步流程。Ravel 与上游同源且必然持续 rebase，建议在 `docs/` 增一份等价的 `ravel-upstream-sync.md`（待发布前立项，不阻塞 P*）。

## 5. 归属与标注规范

携码一律文件头注明来源：`// Adapted from <project> (<license>, <year>), <file path>`。新增 `docs/ravel-vendored-notices.md` 汇总（发布门禁项）。
