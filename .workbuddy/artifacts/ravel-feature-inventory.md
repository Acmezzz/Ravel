# Ravel 当前功能实现盘点

状态：**盘点有效，作基线。** 下一刀认 [`../../docs/ravel-histos-next-cycle.md`](../../docs/ravel-histos-next-cycle.md)。无 Histos 时仍须是完整编码 Agent；记忆 = Histos，不另做产品。

盘点人：高见远（架构师）· 盘点日期：2026-08-28（基于工作树 `main` @ `ce6d8d819`；以实际 Git 状态为准）
依据：docs/ 五份活文档 + `apps/ravel-desktop/electron/` 全部关键模块源码 + renderer 面板/投影层 + `packages/agent/src/harness/session/` + `AGENTS.md`/`README.md`。所有「实现状态」均对照源码与测试文件核实，非仅凭文档。竞品页面证据另见 [`agent-doc-evidence-2026-08-28.md`](./agent-doc-evidence-2026-08-28.md)。

---

## 1. 产品形态概述

Ravel 是一个**本地优先的编码 Agent 桌面工作台**（Windows 优先，版本 0.1.0，不发 npm、暂不发安装器）。它基于上游 Pi（pi-mono fork）的 agent harness，在其上加了一层桌面产品：Electron 隔离壳、四档权限与 Project Trust、成对审批事实、shadow-git 检查点、多工作区/worktree、资源中心（skill/extension/prompt/MCP），以及核心差异化系统 **Histos**——把一切 agent 活动视为「可寻址事实」，在仅追加 JSONL 会话权威之上派生出内容寻址的语义图（GraphRevision / FlowRevision / ContextSet / ViewState 工件）与 React Flow 无限画布。语义图不能直接执行，必须 Convert to Flow → Validate → 审批 → Pi 受控执行。产品不变量是「三层权威分离 + 单一事实写者 + fail-closed 审批」。

### 进程架构（实际落地）

```text
┌─────────────────────────────────────────────────────────────────┐
│ Renderer（React 19.2 + Compiler / Tailwind 4 / Base UI 1.7 /     │
│ Zustand 5 / TanStack Virtual / @xyflow/react / xterm / CM6）      │
│ 零原生依赖：无 fs / Git / 凭据 / sqlite / node-pty / Pi SDK        │
│ 纯投影层：operation-timeline / activity-projection /             │
│ graph-projection / stream-live(rAF批)                             │
└──────────────▲──────── IPC allowlist（四方同步契约）──────────────┘
               │ preload.js 窄桥（contextIsolation + sandbox + CSP 'self' app:）
┌──────────────┴──────────────────────────────────────────────────┐
│ Main（main.js ~2600行：窗口/信任/Git/检查点/搜索/MCP配置/文件/     │
│ 遥测聚合/deep-links/app://协议/路径安全；只转发，不写JSONL、        │
│ 不开 histos sqlite）                                              │
└───▲──────────────────▲──────────────────▲───────────────────────┘
    │ agent protocol    │ histos protocol   │ pty protocol
┌───┴───────────┐ ┌─────┴─────────────┐ ┌───┴─────────────┐
│ Agent Worker   │ │ Histos Engine     │ │ PTY Host        │
│ utilityProcess │ │ utilityProcess    │ │ utilityProcess  │
│ worker.mjs     │ │ histos-worker.mjs │ │ pty-worker.mjs  │
│ Pi Runtime     │ │ node:sqlite 独占  │ │ node-pty 1.1    │
│ worker-pool.js │ │ adapters/chunker  │ │ 有界 DTO 输出   │
│ session-facts  │ │ provenance/凝练   │ └─────────────────┘
│ = 唯一事实写者 │ │ rebuild/artifacts │
└───▲───────────┘ └─────▲─────────────┘
    │                   │
 JSONL 事实(权威)   Git 工作区(权威)  skill/插件文件(权威)
                    index.sqlite(可删) artifacts/<sha256>.json(持久)
```

---

## 2. 功能盘点主表

状态图例：✅实现且有测试 · 🟡部分或基础设施存在但产品未闭环 · ❌当前未实现/未产品化 · 🔒按设计排除 · ? 本轮未验证。

**状态判定边界**：

- `✅` 只表示源码路径和对应测试/门禁均存在，不表示所有平台、供应商或部署形态都已覆盖。
- `🟡` 用于“底层契约已存在但用户闭环未完成”，例如 semanticProvider 接口/凝练编排存在但桌面生产 provider 未接入。
- `❌` 用于当前没有可调用实现或没有产品化出口；不把“本轮未看到”写成不支持。
- `🔒` 是主动设计决策，不应在竞品基准统计中当作普通缺失；是否重估必须单独记录。
- `?` 只表示本轮没有重新执行源码或运行时验证，不能用于推断实现状态。

### 2.1 会话与时间线

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 仅追加 JSONL 会话权威（Pi v3 格式） | ✅ | `packages/agent/src/harness/session/`（session/jsonl/reducer/codec）、Pi `AgentSessionRuntime` | 权威语义（LaneRecord 词汇、codec、corruption 判定）在 packages/agent，有 round-trip + 损坏拒绝测试 |
| operation 成对事实（started/finished）划分 turn | ✅ | `electron/session-facts.js`、`packages/agent/.../types.ts` | run/compaction/navigation 三类 intent；恢复时 open operation 补写 `failed` 终态，不自动重跑 |
| 时间线纯投影 + 虚拟化 | ✅ | `renderer/lib/operation-timeline.ts`、`chat/MessageList.tsx`（TanStack Virtual） | compaction/navigation 不伪装成用户 turn |
| 流式输出（80tok/s 不污染热路径） | ✅ | `renderer/lib/stream-live.ts`、`stream-bucket.ts` | 外部订阅 + rAF 批，按 `sessionId:runtimeEpoch:runId` 分桶 |
| 乐观气泡对账 + 迟到事件丢弃 | ✅ | `worker.mjs`、`agent-bridge.js` | 按 `clientMessageId` 对账；按五元组身份丢迟到事件 |
| 会话树 / fork / clone / navigate | ✅ | main.js `omega:getSessionTree/fork/clone/navigateTree` | Pi 原生 tree 语义 |
| 会话 CRUD、重命名、删除确认 | ✅ | `omega:newSession/loadSession/deleteSession/setSessionName` | `session.delete` 走高副作用操作策略表 |
| 压缩（compaction）不毁日志 | ✅ | `omega:compact` + CompactionEntry | compaction 是新 entry + operation，人类时间线按原 entry 投影 |
| @session 跨会话引用（S3） | ✅ | `session-facts.js`（`session_reference` 事实）、`Composer.tsx`、`MessageBubble.tsx` | chip 可点击跳转；模型可见 routing 块在展示/copy 时剥离；目标删除后 chip 失效态、事实不改写 |
| 引用草稿持久化 | ❌（有意） | — | 已知边界：刷新后 @ 文本保留，结构化引用需重选 |
| HTML 导出会话 | ✅ | `electron/export-html.js`、`omega:exportHtml` | |
| docx 查看 | ✅ | `electron/docx-service.js`（有 `docx-viewer.test.mjs`） | 辅助能力，非核心 |

### 2.2 上下文与 Histos 图

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| FactAddress（12 类 sourceType + selector + revision 锚定） | ✅ | `electron/histos-address.js`、`histos-engine.js` | 非法地址拒绝有测试（histos-index/ipc） |
| 工作区 `index.sqlite` 查找索引（Engine 独占 node:sqlite） | ✅ | `histos-worker.mjs`、`histos-schema.js`、`histos-host.js` | 单进程单连接；可删可重建；Main/renderer 不碰 |
| 内容寻址工件 `artifacts/<sha256>.json` | ✅ | `histos-provenance.js`（writeArtifact/readArtifact/validateArtifact） | canonical JSON + SHA-256；不可原地 patch |
| revision_parents DAG（无 superseded_by 线性链） | ✅ | `histos-schema.js` | |
| Evidence M:N（node/edge revision → FactAddress） | ✅ | `histos-engine.js`、schema `evidence` 表 | |
| 结构透镜（确定性投影器，无 LLM） | ✅ | `histos-adapters.js`（575 行） | 从 JSONL facts 生成结构 node/edge |
| 语义透镜凝练编排（round-trip/parentId 保持/成本上限/离线诊断） | 🟡 | `histos-engine.js`（condense，MAX_CONDENSE_NODES=128 / budget 32k） | 编排已落地（`ad64c6f67`）；**生产 semanticProvider 未接入，桌面 semantic 凝练返回 `semantic_provider_unavailable`**（P2 剩余） |
| SourceSet + Lens + Granularity 查询契约 | ✅ | `histos-engine.js` queryOf() | 缺任一项直接 invalid_args |
| 内容切分（spans，`entryId+offset+length`） | ✅ | `histos-chunker.js` | 只切索引不改 JSONL |
| 索引重建 `SQLite = rebuild(JSONL+Git+skill+artifacts)` | ✅ | `omega:histosRebuild`、engine rebuild | 被用过工件原样填回，不重跑 LLM；进度可取消 |
| GraphRevision 结构化 diff（added/removed/changed/moved/rerouted） | ❌ | — | roadmap 确定项（外部调研 2026-08-28），尚未立项实施 |
| React Flow 画布（六类节点、elkjs worker、框选、节点跳回 transcript） | ✅ | `panels/GraphCanvas.tsx`、`panels/GraphPanel.tsx`、`renderer/lib/graph-projection.ts` | R4 落地；语义图无 Run 按钮 |
| ViewState 手动排布持久化（P5） | ✅ | `omega:histosSaveViewState/GetViewState` | ELK 自动布局不覆盖手动排布 |
| 语义 LOD / 嵌套图：递归 compound ELK 布局 | 🟡 | elkjs worker | 布局已落地；**交互式嵌套 Sub Flow UI 未做**（P3 剩余） |
| ContextSet 冻结 + `context_attached` 事实 | ✅ | `omega:histosFreezeContext`、`session-facts.js appendContextAttachedFact` | 缺 sha 即失败 |
| 上下文预算：确定性优先级裁剪 + `budget_exceeded` fail-closed | ✅ | `histos-engine.js`（`23d5bc5cf`） | 凝练文本 > 直接 Evidence > 邻居摘要；任何 artifact/fact 写入前返回 |
| 超窗用户收缩 UX | ❌ | — | 停在 Composer 前引导缩选择的交互未验证（P4 剩余） |

### 2.3 Flow 执行与审批

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| Convert to Flow → FlowSpec Draft | ✅ | `flow-validation.js`（convertGraphToFlowDraft）、`omega:histosConvertToFlow` | FlowSpec 内容寻址 |
| Validate 闸门（不可达/重复/成环/session 不匹配拒绝） | ✅ | `flow-validation.js`（validateFlowSpec/executionPlanOf）+ 测试 | 不过闸不放行、不写工件 |
| Pi 受控执行（Flow → 审批 → session.prompt） | ✅ | `omega:histosExecuteFlow`、`worker.mjs createFlowApprovalGuard`（P6 `b06a27c6c`） | 复用既有 approval facts；fail-closed |
| FlowRevision 持久工件 | ✅ | `histos-provenance.js` | |
| 语义图直接 Run | 🔒 | — | 按设计排除；画布语义节点无执行路径（有测试断言 404） |
| 嵌套 Sub Flow 执行 | 🟡 | — | 布局就绪，交互 UI 未做 |

### 2.4 权限与信任

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 四档权限 profile（trusted / workspace-only / read-only / ask-before-command） | ✅ | `permission-profiles.js`（303 行，createPermissionGuard） | 默认 workspace-only |
| riskTierOf 三档（read/mutating/untrusted，未知工具 fail-closed） | ✅ | `permission-profiles.js` | MCP/自定义扩展工具默认 untrusted |
| workspace-only 下禁 bash + 路径 containment（realpath 规范化） | ✅ | `permission-profiles.js`、`path-security.js` | 新路径词法检查、已存在符号链接 canonical 检查 |
| 成对审批事实（asked→decided，闭集 outcome×reasonCode） | ✅ | `session-facts.js` + `permission-profiles.js confirmWithDurableFacts` | **ask 写失败即拒绝；decide 写失败不得放行**——罕见的双向落盘门禁 |
| 审批不可达终态化（超时/无回答者/Worker 死/窗口关 → `unavailable`） | ✅ | `closeStaleApprovals`、worker-host | 恢复后迟到回答不可信 |
| 高副作用操作策略表（19 类操作：git.commit/worktree/mcp.write/provider.key…） | ✅ | `permission-profiles.js OPERATION_POLICIES` | workspaceBound + confirmation 双维度 |
| Project Trust（首次打开对话框 + inspect/decide IPC） | ✅ | `main.js`、`project-trust.js`、`layout/ProjectTrustDialog.tsx`、`TrustCenter.tsx` | 项目域写操作要求已信任 |
| 审批前 best-effort shadow 快照 | ✅ | `permission-profiles.js`（snapshot 钩子） | 快照失败不阻断已批准工作 |

### 2.5 Git 集成与检查点

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| Git 快照/Stage/Unstage/Commit（真 diff 视图） | ✅ | `diff-service.js`（646 行）、`omega:gitSnapshot/Stage/Unstage/Commit`、`panels/DiffViewer.tsx` | stale_diff_snapshot 错误码防错位 |
| shadow-git 检查点（独立 ref `refs/ravel/checkpoints/<id>`，不动 HEAD/index） | ✅ | `checkpoint-service.js` | 临时 index 构建 tree；ref 持久性校验 fail-closed；cap 50 + sidecar 顺序文件 |
| 检查点恢复（先拍安全快照 + reverse-apply diff + 清理后建文件） | ✅ | `checkpoint-service.js restoreCheckpoint` | 恢复本身可撤销；ignored 文件不动 |
| 检查点事实化（成对 operation，targetId=40 位 commit SHA） | ✅ | `session-facts.js appendCheckpointFacts` | Git 失败不回滚、facts 失败不阻断 Git——解耦正确 |
| worktree 创建/删除/列表 | ✅ | `omega:listWorktrees/addWorktree/removeWorktree`、`panels/WorktreePanel.tsx` | 子 agent worktree 编排 🔒按设计不做 |
| 文件监听（file watch/unwatch） | ✅ | `omega:watchFile/unwatchFile` + `file:changed` 推送、`file-watch.test.mjs` | |

### 2.6 终端与 PTY

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 隔离 PTY（独立 utilityProcess，node-pty 1.1.0，全树 asarUnpack） | ✅ | `pty-host.js`、`pty-worker.mjs`、`pty-protocol.js`、`panels/TerminalPanel.tsx`（xterm 只渲染 DTO） | R5 + H0 hang-fix（`process.reallyExit(0)`）+ PTY smoke 门禁 |
| PTY 生命周期防护（send 失败杀 host、死亡清 ownership、意外 clean exit 判 dead） | ✅ | `pty-host.js` + P8（`aafcdc324`） | generation + sequence 防串话 |
| renderer 直连 PTY / node-pty | 🔒 | — | 按设计排除，仅 DTO 通道 |

### 2.7 文件与搜索

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 文件树 / 文件查看 / 分页读取 | ✅ | `omega:listDir/readFile/readFilePage`、`files/FileTree.tsx`、`files/FileViewer.tsx` | path-security 全量包含检查 |
| 工作区文本搜索（ripgrep 优先，execFile 参数数组、有界结果 200） | ✅ | `search-service.js`、`files/SearchPanel.tsx` | 无 shell，有预算上限 |
| 文件索引（Composer @ 文件补全） | ✅ | `omega:fileIndex` | |
| 文件上传 / reveal / 默认程序打开 | ✅ | `omega:uploadFile/revealInFolder/openFileDefault`、`file-transfer-service.js` | `file.upload` 走策略表 |
| renderer 任意路径文件访问 | 🔒 | — | path_escape fail-closed |

### 2.8 MCP 与扩展 / skill

**编排能力的证据边界**：`AgentHarness` API 暴露 hook/event registry 概念，但当前构造路径使用 `UnavailableRegistry`；因此“接口可见”不等于桌面 harness 已提供活动订阅能力。Pi `AgentSession` 自身仍有内部订阅与 `toolCallGuard`，两者不能在功能矩阵中合并为一个“hooks 已完整产品化”结论。

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 资源中心（extension/skill/prompt 三类，本地安装、启停、SHA-256） | ✅ | `resource-center.js`、`layout/ResourceCenter.tsx`、`omega:listResources/installLocalResource/...` | 网络来源（npm:/git:/https:）一律拒绝 🔒 |
| MCP 定义管理（user/project 两级 mcp.json，目录锁 + 原子写） | ✅ | `mcp-service.js`、`omega:mcpList/Add/SetEnabled/Remove` | 校验边界 name≤64/command≤2048/args≤64×2048 |
| MCP 执行桥（`ravel-mcp-bridge` 第一方 pi 扩展，stdio JSON-RPC） | ✅ | `.pi/extensions/ravel-mcp-bridge/index.ts` | 工具注册 `mcp__<server>__<tool>`，走 pi 原生管线 → untrusted 档 → ask-before-command 审批；桥未加载时 UI 如实显示，不伪装生效 |
| MCP 网络传输（http/sse） | 🔒 | — | 按设计排除：无入口、不解析、不给表单 |
| skill 编辑（CodeMirror 草稿 → diff → apply → 新版本） | ✅ | `common/SnippetEditor.tsx`、`omega:setSkillModelInvocation/setSkillCommandsEnabled` | 覆盖即新版本（content hash） |
| 扩展 UI surface（extension 弹窗桥） | ✅ | `extension-ui-protocol.js`、`layout/ExtensionSurface.tsx`、`ExtensionUIHost.tsx`、`omega:extensionUiResponse/Cancel` | 有 `extension-ui.test.mjs` |
| 在线安装 skill / OAuth 凭据 | 🔒 | — | 按设计排除 |

### 2.9 多工作区与 worktree

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 多工作区注册/切换/移除 | ✅ | `workspace-registry.js`、`workspace-service.js`、`layout/ProjectSwitcher.tsx` | workspace_in_use / not_authorized 错误码 |
| 每工作区 Histos 索引隔离（`histos/<workspaceId>/`） | ✅ | `histos-host.js` | |
| worktree 面板 | ✅ | `panels/WorktreePanel.tsx`、`worktree-metadata.test.mjs` | |
| 子 agent worktree 编排 | 🔒 | — | 按设计排除 |

### 2.10 UI 工作台

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 三栏工作台（键盘可调宽、compact drawer + inert、Focus Mode） | ✅ | `layout/Workbench.tsx`、`PanelResizeHandle.tsx`、`RightPanel.tsx` | |
| 动态视图（跨会话 waiting/running/failed/done，重启从 facts 恢复） | ✅ | `activity-service.js`、`activity-projection.ts`、`sessions/ActivityList.tsx`（S2） | 活态优先于磁盘派生；清除签名表为 UI 态（localStorage），不进事实层 |
| 动态徽标 attention 计数 | ✅ | `layout/LeftNav.tsx` 第四 tab | |
| 命令面板 / 键位绑定（可配置，不硬编码） | ✅ | `layout/CommandPalette.tsx`、`keybindings.js`、`renderer/lib/keybindings.ts` | |
| 模型中心 / 自定义 provider / API Key vault | ✅ | `layout/ModelCenter.tsx`、`ModelPicker.tsx`、`credential-store.js`（safeStorage）、`custom-providers.js` | 凭据加密 blob 迁移时不解密不重加密（migration:smoke sha256 对比） |
| 设置中心 / SessionInfo / TreeOverlay | ✅ | `layout/SettingsDialog.tsx`、`SessionInfoDialog.tsx`、`TreeOverlay.tsx` | i18n（中文为主）+ 语言设置测试 |
| 琥珀工匠设计系统（`--ravel-*` token、∞ Header、Context Donut、ToolCard 结构化 diff） | ✅ | `renderer/ui/*`（Base UI 1.7 包装，Radix 已删）、Tailwind 4.3.3 | CJK fallback + Lucide（P1） |
| Canvas 2D 远景 LOD | 🔒 | — | 三条实测判据全满足前不立项 |

### 2.11 遥测与诊断

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| 会话遥测聚合面板（usage/computeTelemetry） | ✅ | `electron/telemetry.js`、`panels/TelemetryPanel.tsx`、`omega:telemetry` | |
| 进程日志（三进程 utilityProcess 结构化诊断） | ✅ | `process-log.js`、P8 normalized `(type,location,report)` fatal 事件 | Histos dead host 重建已做 |
| 最近事件 / 健康回放 | ✅ | `omega:recentEvents`、`health-replay.test.mjs`、`recovery-state.test.mjs` | |
| crashReporter 上传 | ❌ | — | 仅本地诊断，上传通道未接（P8 剩余） |
| LLM 凝练 eval 回归与成本遥测 | ❌ | — | P2 剩余 |

### 2.12 安全隔离

| 功能点 | 状态 | 所在文件/模块 | 成熟度备注 |
|---|---|---|---|
| contextIsolation + sandbox + 无 nodeIntegration + CSP（无 unsafe-inline/eval，style-src 'self' app:） | ✅ | `main.js`、`app-protocol.js`（`app://` 打包加载） | `electron-security.test.mjs`、`security-runtime.test.mjs` 门禁 |
| IPC 四方同步 allowlist（ipc-registry/contracts/schemas/preload，~110 通道） | ✅ | `ipc-registry.js`、`ipc-contracts.js`、`ipc-schemas.js`、`preload.js` | `ipc-high-risk.test.mjs` 覆盖高风险通道 |
| 路径安全（realpath 规范化 + containment + 拒绝绝对路径/`..`） | ✅ | `path-security.js` | P8 补有界路径安全日志脱敏 |
| deep links | ✅ | `deep-links.js`（有测试） | |
| 数据迁移（omega → ravel 目录，凭据 blob 原样复制） | ✅ | `data-migration.js` + `migration:smoke` | 旧目录永不删除，可回滚 |
| 自动更新（离线核心：manifest 校验/HTTPS-only/SHA-256） | 🟡 | `updater-service.js` | feed 未接入——首版发布前按设计不配置 |
| OS/容器/VM 沙箱 | 🔒 | — | 按设计排除（不宣称）；Docker/WSL 是更后阶段 |

---

## 3. 证据层级与产品化边界

本盘点的主表是源码/测试盘点，不是竞品页面转述。为避免“能编排”与“用户能用”混淆，采用三层表达：

1. **事实实现**：有明确源码入口、持久化语义和测试覆盖，例如 JSONL、审批事实、路径 containment、Flow Validate。
2. **基础设施**：类型、接口、编排、评估或协议已经存在，但缺生产接线、稳定 UI、失败回路或可观测出口，例如 semanticProvider、通用 telemetry exporter、eval harness、AgentHarness hook registry。
3. **产品闭环**：用户可以发现、触发、审阅、恢复并看到结果；只有达到这一层才可在对外能力表中写“已提供”。

因此，semantic condensation 当前应写成“编排基础设施存在、桌面生产 provider 未接入”，LLM eval 应写成“通用行为评估基础设施存在、凝练质量回归与成本产品化缺失”，而不能简单合并成“语义能力完成”。同理，四档权限和 Project Trust 已是产品能力；每工具 override 与档位热切换仍是缺口。

## 3. Histos 三层系统专项

### 3.1 事实层（权威）——已落地

- 仅追加 Pi v3 JSONL；桌面侧唯一写者 `session-facts.js`（customType=`ravel_record`），词汇权威在 `packages/agent/src/harness/session/*`（types/codec/reducer/jsonl，有 210+ vitest）。
- 六种事实类型全部落地并校验：`operation_started/finished`、`approval_asked/decided`、`session_reference`、`context_attached`。
- 恢复语义：`closeStaleOperations`（open op → failed）、`closeStaleApprovals`（未决 ask → unavailable/no-answerer），幂等。
- Git 工作区与 skill 文件为同层权威；checkpoint/skill 的 revisionId 锚定 Git blob/commit SHA。

### 3.2 凝练层（派生索引）——已落地，一个关键缺口

- `index.sqlite`（Engine utilityProcess 独占 `node:sqlite`，七张表：addresses/node_revisions/edge_revisions/revision_parents/evidence/spans/artifacts/meta）。
- durable artifacts：canonical JSON + SHA-256 内容寻址，四类（GraphRevision/FlowRevision/ContextSet/ViewState），「被用过」五条触发规则已实现；未用过的探索性语义边允许消失。
- 重建形式化已实现：`omega:histosRebuild`，被用过工件原样填回、不重跑 LLM、missing evidence 标 missing 不改写。
- 语义凝练编排（round-trip、parentId 保持、成本上限 128 节点/32k 字符、离线诊断、确定性优先级裁剪、`budget_exceeded` 写入前 fail-closed）已落地。
- **缺口**：① 生产 `semanticProvider` 未接入 Histos worker——桌面 semantic 凝练端到端不可用，返回 `semantic_provider_unavailable`（P2-g）；② LLM 凝练 eval 回归与成本遥测未做；③ GraphRevision 结构化 diff（added/removed/changed/moved/rerouted 纯函数）是 roadmap 确定项但未立项；④ ContextSet 证据门控只是候选项（advisory 字段方向），未做。

### 3.3 可视 + 交互层——已落地，两个交互缺口

- React Flow 画布 + 六类节点 + elkjs Web Worker 布局 + 框选 + 节点跳回 transcript；手动排布落 ViewState（ELK 不覆盖）。
- Convert to Flow → FlowSpec Draft → Validate（不可达/重复/成环/session 不匹配拒绝）→ 持久审批（复用 approval facts）→ Pi `session.prompt` 全链路已接通（P6）；语义图无任何执行路径。
- **缺口**：① 交互式嵌套 Sub Flow UI（递归 compound ELK 布局已就绪，React Flow Sub Flow 交互未做，P3-g）；② 超窗后停在 Composer 前让用户缩选择的收缩 UX 未验证（P4-g）。
- 语义 LOD（拉远 cluster / 拉近 entry-span）契约冻结，但依赖 semanticProvider，当前实际只有 structural 透镜可用。

---

## 4. Ravel 独有 / 超前的设计（差异化能力）

1. **FactAddress 全域溯源**：任何图节点/边/ContextSet 引用都携带 `sourceType + objectId + revisionId + selector`，且 revisionId 锚定 Git blob/commit 或 JSONL entry id——语义结论可以逐字节回溯到原文，不会出现「图说了算」。
2. **内容寻址 revision DAG 工件**：GraphRevision/FlowRevision/ContextSet/ViewState 是 canonical JSON 的 SHA-256 工件，`revision_parents` 表达取代关系；凝练漂移永远是追加新 sha，旧 ContextSet 钉旧 sha。
3. **可删索引不变量**：`SQLite = rebuild(JSONL, Git, skills, artifacts)` 有删除测试——删掉整个查找库，被用过的图、时间线、工件全部仍在。一般编码 Agent 的索引（如有）通常是「删了就丢」。
4. **成对审批事实 + 双向 fail-closed**：`approval_asked` 落盘失败直接拒绝执行；`approval_decided` 落盘失败同样不放行——把「审批」从 UI 瞬态变成可审计的持久事实，且崩溃/超时/窗口关闭统一终态化为 `unavailable`，恢复后迟到回答不可信。
5. **单一事实写者**：全仓库仅 `session-facts.js` 可写事实（静态断言门禁），Engine/Main/renderer 只读。消除多写者竞态与「摘要反写原文」一类腐化。
6. **语义图不可执行闸门**：语义节点没有 Run；执行必须 Convert → Validate（成环/不可达/重复拒绝）→ 持久审批 → Pi。这是对「LLM 画的图直接当自动化跑」的系统性防御。
7. **shadow-git 检查点**：独立 ref、独立 commit 对象、不碰 HEAD/index；恢复先拍安全快照使「回滚本身可撤销」；恢复动作又以成对 operation 事实写回会话日志。
8. **确定性上下文预算**：超窗不做静默截断——优先级裁剪后仍超则 `budget_exceeded`，发生在任何 artifact/fact 写入之前（fail-closed）。
9. **上下文附着的会话事实化**：开会话即冻结 ContextSet 工件并追加 `context_attached`（缺 sha 即失败），「这个会话当时带了什么上下文」永远可答。
10. **操作/审批/压缩/导航全部时间线事实化**：compaction 是新 entry + operation 而非覆写；时间线是零副作用纯投影，可随时丢弃重建。
11. **三方 utilityProcess 隔离 + PTY DTO 化**：Agent/Histos/PTY 各自独立进程，renderer 只见受控 DTO；PTY 输出有界、generation/sequence 防串话、死亡自清理。
12. **MCP 经第一方 pi 扩展走原生工具管线**：不另起第二工具权威，审批/riskTier/工具卡零新增语义；且「桥未加载」在 UI 如实呈现，不做假开关。

---

## 5. 明确不做的清单（按设计排除，竞品对比时不得计为缺失）

- 删除/重命名 `.pi` 目录与 Pi session 格式；重命名 `@earendil-works/pi-*` 包；删除上游 Pi 版权（R6 facade 仅真实分叉需求时做）
- 换壳（Tauri/Next sidecar/本地 HTTP agent server）；第二套 agent runtime / turn schema / 审批库
- Neo4j/ArangoDB/通用图数据库/独立向量库；sqlite 当 GraphRevision 权威；`better-sqlite3` 等 native addon
- Monaco 节点编辑器、自研 Canvas 2D（三条实测判据全满足前）、Motion 动效库、Radix（已删，不留双轨）
- 语义图直接 Run；用 Git Review 冒充执行前权限；Plan/Todo 假面板；Scout/Workflow（已删）
- 子 agent worktree 编排、agent 互发消息/自动建会话、跨工作区 session 引用
- 云账号/云任务/手机遥控、云沙箱、messaging、voice、computer use、浏览器操作、定时任务（仅留后续口子）
- 跨项目记忆；MCP 网络传输（http/sse，含只读展示）、OAuth、npm/git 在线安装 server
- OS/容器/VM 沙箱宣称；renderer filesystem / nodeIntegration
- Codex 式云任务、Cowork 式非开发者文件夹代理
- 发 npm 包；Authenticode 未配置前发 NSIS/exe 安装器；凭据解密重加密
- 引用边的删除/编辑（边是事实，只追加）；activity 清除表跨设备同步（UI 态）

---

## 6. 已知缺陷 / 风险（盘点中发现）

1. **文档漂移（轻微）**：`ravel-roadmap.md` 与 Histos 计划称 `main` HEAD 为 `9b98e529b`，实际工作树已到 `ce6d8d819`（docs 类提交继续演进）；`ravel-core-design-and-next-slices.md` §5 仍写「已在 feature 分支落地，尚未合进 main」，与其余两份文档「feat 分支已并入 main」矛盾。对齐竞品时以 git 实际状态为准。
2. **P2-g 是最大功能缺口**：semantic 凝练在桌面端到端不可用（`semantic_provider_unavailable`），意味着 Histos 的「LLM 抽取节点/边」核心卖点目前只能演示编排、无法真实凝练。竞品对比语义记忆/知识图谱能力时必须把 Ravel 记为「架构完整、semantic 透镜离线」。
3. **测试基线数字随时间漂移**：文档多处引用「桌面套件 286 通过 / agent 210 通过」快照数字，均为 2026-08 时点，非当前门禁。
4. **平台单边**：发布目标仅 Windows（unpacked dir）；macOS/Linux 配置预留但无 CI 矩阵，crashReporter/更新 feed 均未接入——分发成熟度低（多数按设计推迟）。
5. **引用草稿不持久化**：@session 结构化引用刷新后需重选（已知边界，非 bug）。
6. **评估能力空白**：无 LLM 凝练 eval 回归、无成本遥测——凝练质量变化不可回归验证。
7. **四类 crash/观测通道不全**：crashReporter 上传缺失，三进程崩溃目前只有本地诊断。
8. **`release3/` 目录残留在仓库工作树**（`apps/ravel-desktop/release3/win-unpacked`），属打包产物，按「明确不做」清单不应提交进 Git，建议确认 .gitignore 覆盖（本文档任务未做修改，仅记录）。

---

## 7. 下一次复核入口

下次只需同步三项快照，不必重写本盘点：

1. `git` 实际分支/HEAD 与工作树状态；
2. 当前桌面门禁和 package 测试结果（不要沿用历史文档中的通过数）；
3. `agent-doc-evidence-2026-08-28.md` 的页面状态与证据等级。

文档中的历史提交号、测试数量和“已合并/未合并”描述都属于时间敏感信息；若冲突，以当前 Git、源码和实际门禁为准。

## 附：测试覆盖索引（佐证成熟度）

桌面 `apps/ravel-desktop/test/` 共 64 个 node:test 文件，覆盖：histos（r0/r1/r2/canvas/index/ipc/process/renderer 8 份）、pty（host/protocol/renderer/worker 4 份）、安全（electron-security/security-runtime/ipc-high-risk/ipc-schemas 4 份）、事实与投影（session-facts×2/session-reference/session-messages/renderer-model）、checkpoint、mcp、activity、flow-validation、updater、data-migration、keybindings 等。E2E：`e2e/p7.electron.spec.mjs`（Playwright Electron，provider-free：`app://` 加载 + 隔离 + best-effort PTY/ContextSet）。packages/agent 有 jsonl/reducer/session_reference round-trip 与损坏拒绝 vitest。
