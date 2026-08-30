# Ravel 功能全景清单

更新日期：2026-08-30
基线：`main`（Fact Graph 落地后）

本文是**功能维度**的全景清单：每一个已实现的功能、它的实现位置、以及它与 Histos 的接入状态。状态口径以代码为准，与 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)（架构与不变量）互为补充：那篇讲"系统是什么"，这篇讲"系统有什么"。

Histos 接入状态分三档：

| 标记 | 含义 |
|---|---|
| **已投影** | 该功能产生的事实/内容已经进入 Histos（结构图 / Fact Graph / 工件），可查询可可视化 |
| **接口就绪** | Histos 侧的承接面（表、投影函数、事件总线、IPC）已就位，但该功能的写入侧还没接 |
| **未设计** | 该功能目前完全不经过 Histos，且尚无既定的接入方案 |

---

## 1. Agent 运行时（worker.mjs + packages/coding-agent）

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| Pi JSONL 会话权威（消息、树、fork/clone/navigate） | 完成 | 已投影（entry/operation 节点） |
| 内置工具：bash / read / write / edit / grep / find / ls | 完成 | 已投影（tool 节点 + 工具卡） |
| 工具执行摘要事件（有界 DTO，按需取详情） | 完成 | 已投影 |
| 压缩（compaction）与压缩恢复 | 完成 | 已投影（compaction operation 对） |
| 自动重试 / 队列（steering / followUp 两队） | 完成 | 已投影 |
| 事件 replay（generation + runtimeEpoch + sequence 三重防陈旧） | 完成 | 已投影 |
| 只读子代理（task 工具，深度上限 2，超时 10 分钟） | 完成 | 接口就绪（runSubagent 可经 applyAgentActivity 投影，未自动接线） |
| @session 引用（跨会话提及 → 模型可见路由块） | 完成 | 已投影（session_reference fact + triple） |
| Prompt 图片（最多 4 张，双向校验） | 完成 | 未设计（图片不进图） |

## 2. 会话与生命周期

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| 会话列表 / 分页 / 加载 / 删除 / 重命名 | 完成 | 已投影 |
| Worker 池（多会话并发，前台/后台槽位） | 完成 | 不适用（进程管理） |
| 会话恢复（崩溃后状态机：running/ready/error/retrying） | 完成 | 已投影（stale approval/operation 闭环） |
| 自动命名（首条 prompt 取标题） | 完成 | 已投影（entry 属性） |
| 关闭保护（生成中关窗 → 等待/停止二选一 + 强制退出风险提示） | 完成 | 不适用 |
| 活动动态视图（跨会话实时状态行，150ms 防抖推送） | 完成 | 已投影（从 durable facts 派生） |

## 3. 权限、信任与安全

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| 四档权限 profile（trusted / workspace-only / read-only / ask-before-command） | 完成 | 已投影（approval 成对事实） |
| 持久 per-tool 规则（user + project 两级，safety floor 不可穿透） | 完成 | 已投影（ruleSource 溯源写入审批事实） |
| 审批 fail-closed（ask 落盘 → 询问 → decided 落盘，任一失败即拒绝） | 完成 | 已投影（approval_asked/decided + Fact Graph triple） |
| Project Trust（once/always/never，未信任项目资源休眠） | 完成 | 未设计（信任决策本身不写事实） |
| 路径包含（realpath + lexical 兜底） | 完成 | 不适用（安全机制） |
| IPC allowlist + sender 校验 + preload 双重校验 | 完成 | 不适用 |
| safeStorage 凭据 vault（apiKey / OAuth / MCP 凭据） | 完成 | 未设计（凭据操作不写事实） |
| 自动 checkpoint（每次批准 mutating 工具前影子快照） | 完成 | 已投影（checkpoint fact pair） |

## 4. Git 与版本控制

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| Git snapshot / stage / unstage / commit（快照 token 防陈旧） | 完成 | 接口就绪（git 操作是 tool call 可进图，但 git 元数据无专属投影） |
| Diff 审批（accept 保留 / reject 还原） | 完成 | 已投影（change.approve 走审批事实） |
| Worktree（增删列） | 完成 | 接口就绪 |
| 恢复到 checkpoint | 完成 | 已投影（checkpoint fact） |

## 5. 模式（Mode Profiles）

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| default 模式 | 完成 | 已投影（agent_spec seed） |
| plan 模式（强制只读 + 仅可写 plan 文件 + 人工审批出口） | 完成 | 已投影（spec 节点）；**模式切换动作本身未投影**（接口就绪：`mode_changed` fact 待加） |
| goal 模式（round-cap 预算续跑，失败即停） | 完成 | 已投影（spec 节点）；GoalState 持久化契约就绪（`goal-state.js`），worker 未接 |
| 模式 → 权限收敛（mode 只能收紧不能放宽） | 完成 | 不适用（不变量） |

## 6. 资源中心（Skill / Extension / Prompt / Package）

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| 资源发现与列表（extensions + skills + prompts + packages） | 完成 | 接口就绪（列表可作为资源节点投影，未接线） |
| 本地安装 / 卸载（授权根 + 原子写入约束） | 完成 | **未投影**（安装动作不写事实；`config_changed` fact 待加） |
| 资源启停（user/project 两级作用域） | 完成 | **未投影**（同上） |
| Skill model-invocation 开关（frontmatter 原子改写） | 完成 | **未投影**（同上） |
| 资源蒸馏（LLM 总结 skill/extension/prompt → 语义节点 + 草稿 ContextSet） | 完成 | 已投影（手动触发，ResourceCenter 按钮） |
| 在线 registry（stage → SHA 展示 → 人工安装） | 完成 | **未投影**（同安装） |
| 资源内容变更追踪（同一 skill 改了内容 → 新修订） | **未实现** | **未设计**（蒸馏可重跑产生新 revision，但无自动变更侦测） |

## 7. MCP

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| MCP 配置管理（stdio + streamable HTTP，user/project 作用域） | 完成 | 接口就绪（`mcp_config` 节点类型画布已认识，投影未接线） |
| MCP OAuth 登录（deep link 回调 + PKCE） | 完成 | **未投影** |
| MCP 工具调用 | 完成 | 已投影（作为普通 tool call 进结构图）；**MCP 专属视图未设计** |

## 8. Histos 数据层（本轮核心）

| 功能 | 状态 | 说明 |
|---|---|---|
| FactAddress（12 类事实来源）+ revision DAG + Evidence M:N | 完成 | 派生索引的地基 |
| 结构图投影（session/entry/operation/tool/approval/cluster/file/skill/mcp_config/span/context 节点） | 完成 | 三种 lens：structural / semantic / mixed |
| Fact Graph（FactGraphBackend 契约 + sqlite 后端 + fact_triples 表） | 完成 | 借鉴 oh-my-pi Mnemopi Triple 模型；时间窗 + scope + confidence + 内容寻址 id |
| 事实派生投影（JSONL fact → triple，best-effort） | 完成 | operation/approval/reference/context/flow_trigger/checkpoint 全覆盖 |
| 语义凝练（condenseGraph，成本/节点/字符上限 + provider relay fail-closed） | 完成 | 语义节点可生成但无 Run 入口 |
| 内容寻址工件（GraphRevision / FlowRevision / ContextSet / ViewState，SHA-256） | 完成 | 可删可重建 |
| ContextSet 冻结（选中项 + 必选证据不可省，预算超限 fail-closed） | 完成 | |
| 跨工作区 ContextSet 导入（只搬已冻结工件，预算校验） | 完成 | |
| Suggest（确定性零 LLM 检索，只建议不注入） | 完成 | |
| Web 资源抓取与图投影（fetch → 节点/边，失败记诊断） | 完成 | |
| 结构化 Graph diff（added/removed/changed/moved/rerouted） | 完成 | |
| eval_result 规范化与投影 | 完成 | |
| Histos 事件总线（17 种 BeforeX/AfterX/OnX 事件，worker→main→renderer 推送） | 完成 | 借鉴 prime-agent ExtensionEvent；**消费方（表面订阅）未接** |
| Fact Graph IPC 四通道（queryFacts/writeFacts/factStats/clearFacts） | 完成 | preload/main/registry/DTO 四方同步 |
| 追溯两级删除：归档（墓碑）/ 复原 / 抹除（purge）/ asOf 时间旅行（P0） | 完成 | tombstones 表 + 四读路径 join 过滤 + rebuild 重放；purge_record 账目事实走单写者；IPC 三通道 + 三事件；approval 账目 fail-closed |
| Fact Graph 表面 UI（Inspector/Toolbar 消费 triples） | **未实现** | **接口就绪**（P2） |

## 9. Flow（图 → 可执行流程）

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| Convert to Flow（结构图 → FlowSpec 草稿） | 完成 | 已投影（flow_revision 工件） |
| Validate（不过闸不放行，不写工件） | 完成 | |
| 审批门（未批准 Run/Schedule 禁用，批准是事实） | 完成 | |
| Run Flow（经 Pi session.prompt 执行，operation fact 成对落盘） | 完成 | |
| 定时调度（interval/daily + maxRuns + busy 跳过 + flow_trigger 事实） | 完成 | |
| 预授权触发（schedule 域 allow 规则，per-call 不持久化） | 完成 | |
| 嵌套 Sub Flow 交互 | **未实现** | 未设计 |

## 10. 终端与 IDE 表面

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| PTY（node-pty 仅限 worker，8 会话上限，64KB 分块） | 完成 | 不适用 |
| 终端面板（xterm） | 完成 | 不适用 |
| IDE 表面（编辑器 tabs + 只读阅读器 + 工作区树 + 搜索 + 底部 Diff/Worktree/Terminal/Agent） | 完成 | 接口就绪（文件打开/编辑可作为 file 节点事件投影，未接线） |
| 全局搜索（sanitize query + 主进程执行） | 完成 | 未设计 |
| 命令面板 / 键位绑定（可配置，不硬编码） | 完成 | 不适用 |

## 11. 桌面壳

| 功能 | 状态 | Histos 接入 |
|---|---|---|
| 单壳布局（44px 标题栏 + 48px 活动栏 + 三 surface 互斥 + 浮层宿主） | 完成 | 不适用 |
| 三表面共享 ChatPanel（chat / ide / histos 切换不丢会话） | 完成 | |
| 主题（琥珀工匠 tokens，亮/暗/系统跟随，CSS 变量动效） | 完成 | 不适用 |
| 文本缩放 / 焦点模式 / 紧凑断点 / 无障碍标注 | 完成 | 不适用 |
| 深链（ravel:// 协议，单实例） | 完成 | 不适用 |
| HTML 导出 / 导出脱敏 | 完成 | 接口就绪（可作为一种 artifact 投影，未接线） |
| 更新器 / 崩溃恢复对话框 | 完成 | 未设计 |

## 12. 未设计接入 Histos 的配置类变更（缺口清单）

以下是本轮审查确认的**事实化缺口**——它们都发生在 settings 文件层，不走 JSONL 单写者，因此 Histos 看不见。统一的修复路径是引入 `config_changed` 事实类型（走 `session-facts.js` 单写者 + Fact Graph 派生投影加映射）：

1. 资源安装/卸载/启停/frontmatter 编辑（§6）
2. 权限规则增删（§3）
3. Project Trust 决策（§3）
4. MCP 增删/启停/OAuth 登录（§7）
5. 模式切换动作（§5，事实类型 `mode_changed`）
6. Provider API key / 自定义 provider 配置变更（§3）
7. 权限 profile / 设置变更（§3）

**不建议**接入 Histos 的：凭据明文（永不入图）、路径安全机制内部状态、进程池状态、UI 布局偏好。

## 13. 明确不做的（防止范围漂移）

Neo4j/ArangoDB 等图数据库、第二套 agent runtime、云沙箱、computer use、MCP 网络传输、Radix 双轨、Monaco 节点内编辑、Canvas 2D 远景层（三条实测判据全满足前不开）。完整清单见 [`ravel-history-archive.md`](./ravel-history-archive.md) §1。
