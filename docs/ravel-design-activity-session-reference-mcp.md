# 设计：动态视图、@session 引用、MCP 管理

更新日期：2026-08-28
状态：**已实现，不再作为待办。** 2026-08-26 落地（`7cf8a26f0`）。前置阅读：`ravel-core-design-and-next-slices.md`（不变量）。剩余工作只认 [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md) 与 [`ravel-roadmap.md`](./ravel-roadmap.md)。交互排布已消化进 Workbench / ActivityList，不再另存学习报告。

三者的共同判据：每个功能要么新增带冻结 id 的事实对象，要么是对既有事实的派生投影；不新增第二权威、不新增看板式假面板。

| 功能 | 架构角色 | 事实层增量 |
|---|---|---|
| S2 动态视图 | 纯派生投影 | 无（消费既有 operation/approval 事实） |
| S3 @session 引用 | 第一种跨对象边 | 新 LaneRecord：`session_reference` |
| S4 MCP 管理 | 第四类资源事实 + 执行桥 | 配置文件即事实；工具调用走既有审批事实 |

---

## S2 动态视图（Activity）

### 目标

跨会话一屏回答：什么在跑、什么失败了、什么在等我。点击进入会话，处理完可清除。它是切片 1 事实层的第一个真实消费者——用产品功能证明"图是派生索引"，先于画布。

### 数据与投影边界

**不新建 activity store，不落任何新盘上事实。** 行数据 = 主进程聚合的每会话状态 + 渲染层清除签名表。

状态来源分两层：

- **活态（快路径）**：`worker-host` / `agent-bridge` 已按 sessionId 维护运行态。扩展为每会话聚合记录：

  ```text
  SessionActivityRow {
    sessionId, title, workspacePath
    status: running | waiting | failed | done   // 派生，见下
    since: timestamp          // 当前状态起点
    pendingApprovals: number  // 未决 approval_asked 数
    lastOutcome?: completed | aborted | failed | declined
    updatedAt: timestamp
  }
  ```

- **事实（恢复路径）**：进程重启后活态清零，用 `session-facts.readFacts` 重建：open operation → running；`approval_asked` 无成对 decided → waiting；`operation_finished.outcome=failed/aborted` → failed；completed → done。

状态推导规则（与时间线一致，不发明新语义）：

```text
waiting  = 存在未决 approval_asked（fail-closed 的可见面）
running  = 存在 open operation（kind=run）
failed   = 最近一次 operation_finished 为 failed/aborted/declined
done     = 最近一次 operation_finished 为 completed 且非以上三者
```

IPC：新增 `omega:activitySnapshot`（拉全量行）+ 复用既有事件推送通道增量更新（事件已带 sessionId）。渲染层纯函数 `activity-projection.ts` 做过滤/排序，风格对齐 `operation-timeline.ts`。

### 清除语义

"我看过了"是 UI 态，不是工作事实——与面板宽度同类。采用 GooeyPi 验证过的签名表方案：

- 签名 = `${status}:${updatedAt}`，存 localStorage `ravel.activity.cleared`（`Record<sessionId, signature>`）
- 清除后同签名不再高亮；同修订号出现新的 failed/waiting 签名重新告警
- 不写 JSONL，不进 facts

### UI

位置：LeftNav 第四个 tab「动态」（现有 sessions/files/search 之后），tab 上带待关注计数徽标（waiting+failed+unread）。

列表行（对齐学习报告 §6 的行解剖）：

- 左：30px 状态图标块（spinner / 待办警示 / 失败 / 完成）
- 中：会话标题（未读加 New 徽标）→ 最后一条用户消息预览单行截断
- 右：项目名 + 相对时间 + 状态 chip（"等待审批" / "运行中" / "失败" / "完成"）
- 整行可点 → 切换会话（复用 setActiveSession）
- hover 出 X 清除单项；顶部工具条「全部清除」只清当前可见的可清除项
- 过滤分段：全部 / 待关注（failed||waiting||unread）/ 运行中；空状态："全部处理完毕"

### 合并规则（反面教训）

磁盘会话摘要不得覆盖活态：合并时活态的 running/waiting/failed 优先于 listSessions 返回的历史快照（GooeyPi `mergeSessionCatalog` 踩过的坑）。

### 改动清单

- `electron/agent-bridge.js`：SessionActivityRow 聚合 + activitySnapshot IPC + 事件增量
- `electron/session-reader.js`：重启时从 facts 重建行状态
- `electron/ipc-contracts.js` / `ipc-registry.js` / `preload.js`：新通道
- `src/renderer/lib/activity-projection.ts`：纯函数过滤/排序/签名
- `src/renderer/components/layout/LeftNav.tsx` + 新 `components/sessions/ActivityList.tsx`
- `store/useAppStore.ts`：activityRows state + 清除签名
- i18n、dto 类型、`test/renderer-model.test.mjs`

### 验收

- 会话 A 审批等待时，切到会话 B，「动态」tab 徽标 +1，行显示"等待审批"；回到 A 处理后徽标消失
- 杀掉 Worker 后对应会话行变失败（facts 终态化已保证）
- 重启应用后 running 会话从 facts 恢复为正确状态，不被旧快照画死
- 清除单项后该签名不再出现；新失败重新出现

---

## S3 @session 引用

### 目标

最小版跨会话引用：提及即引用。产出两样东西——(a) 用户消息里的可点击 chip；(b) 一条指向目标会话的类型化边，作为将来凝练层抽边的高信号来源。不做 agent 互发消息、不做自动建会话（那是 D6 子 agent 编排方向，明确排除）。

### 事实 schema

新 LaneRecord 类型 `session_reference`。词汇权威在 `packages/agent/src/harness/session/*`（codec + reducer 先认，未知类型 fail-closed 的规则不变），桌面侧仍只经 `session-facts.js` 写入：

```text
session_reference {
  id               // uuid，lane record id
  lane
  sourceEntryId    // 包含 @ 提及的那条 user entry 的 entryId
  clientMessageId  // 与乐观气泡对账同一身份
  targetSessionId  // 冻结 id：目标 sessionId
  targetTitle      // 展示缓存（标题可改，id 才是身份）
  timestamp
}
```

写入时机沿用 compaction 补记先例：prompt entry 落盘拿到 entryId **之后**追加，仅追加、可寻址。

### Composer 交互（照搬学习报告 §5 单一菜单状态机）

- 触发：尾部 `@query` 打开提及菜单（与 `/` 命令、`+` 附件共用一个锚定 listbox，互斥状态 `menu: 'mention'|'command'|null`）
- 候选：当前工作区、顶层（depth 0）、非归档、非活动会话，≤8 条；detail 显示目标状态（运行中 / 空闲 / 最后活跃时间）
- 接受：替换部分 token 为 `@Title `，记录 title→sessionId 映射用于消歧；`acceptedMentionRef` 抑制同一 token 重复弹菜单，Backspace 复位
- 键盘：↑↓ 循环、Enter 先于发送、Escape 关闭、IME isComposing 保护

### 提交管线

1. 解析正文中的 `@Title` token（最长标题优先、边界检查），配合 title→id 映射消歧
2. **模型可见面**：正文原样保留，末尾追加 delimited 块（GooeyPi 已验证的模式）：

   ```text
   ===== BEGIN RAVEL SESSION REFERENCES =====
   - "@Title": session <uuid>
   ===== END RAVEL SESSION REFERENCES =====
   ```

   让模型知道 UUID 以便推理；展示与 copy 时剥掉此块，chip 替代。
3. prompt 经既有通道发送；entryId 已知后为每个提及追加一条 `session_reference` 事实
4. 引用的目标不存在/已删除：提交时不阻塞，chip 渲染为失效态（划线 + tooltip "会话已删除"），边仍在（历史事实不改写）

### 渲染

- `sanitizeTranscript` 投影 references；MessageBubble 按 clientMessageId 关联，把正文中的 `@Title` 渲染成 chip 按钮，点击切换到目标会话
- copy 路径剥离 routing 块（人类复制的是用户原话）

### 明确不做

- `session_read/send/wait` 类 agent 协作工具（信封、HMAC、唤醒那一整套）
- agent 自动创建会话
- 跨工作区引用（候选集限定同工作区）
- 引用边的删除/编辑（边是事实，只追加）

### 改动清单

- `packages/agent/src/harness/session/*`：LaneRecord 类型 + codec 校验 + reducer 认识（含 corruption 判定）
- `electron/session-facts.js`：FACT_TYPES + 字段校验（sourceEntryId/clientMessageId/targetSessionId/targetTitle 必填字符串）
- `electron/agent-bridge.js`：prompt 落盘后补记 reference；routing 块拼装
- `electron/session-reader.js`：投影 references 到 record
- `Composer.tsx`：menu 状态机 + 候选解析 + 提交管线
- `MessageList.tsx` / `MessageBubble.tsx` / `Markdown.tsx`：chip 渲染 + copy 剥离
- dto、i18n、测试（packages/agent 定向测试 + 桌面 node:test）

### 验收

- 输入 `@` 弹出同工作区会话候选，选择后 chip 化，点击跳转目标会话并返回不丢滚动位
- transcript 中用户消息原文不含 routing 块；copy 同样干净
- JSONL 中 `session_reference` 成对可寻址（sourceEntryId 指向真实 user entry）；reducer 对损坏 reference 报 corruption 而非忽略
- 目标会话被删除后 chip 显示失效态，事实不动

---

## S4 MCP 管理

### 前提约束（决定整个形态）

`@earendil-works/pi-coding-agent@0.84.2` **没有原生 MCP 支持**（dist 全量 grep 仅误报命中）。所以本设计必须同时给两个东西：定义管理 + 执行故事。没有执行故事的"MCP 列表"就是假面板，违反核心设计 §2.6 对 Plan/Todo 假面板的否决逻辑。

执行路径选型：

- ~~桌面 worker 自建 MCP stdio client~~：绕开 pi 工具管线，审批/riskTier/工具卡全要另起一套 = 第二工具权威，否决
- **选定：第一方 pi 扩展 `ravel-mcp-bridge` 作为执行桥**。随桌面分发（资源目录本地加载，不走网络安装），读取 Ravel 自己的 mcp.json，经 pi 原生扩展 API 注册工具。工具因此天然流经既有管线：toolCallId 工具卡、ask-before-command 审批、approval 事实落盘，零新增权威

### 事实层

- 定义文件即事实：`~/.ravel/mcp.json`（user 域）/ `<proj>/.ravel/mcp.json`（project 域，须 trusted project）

  ```json
  { "mcpServers": { "<name>": { "command": "...", "args": ["..."], "enabled": true } } }
  ```

- 冻结 id：server 定义 = `scope + name`（文件内 key）；运行期工具调用身份 = 既有 toolCallId，不另造
- 只支持 stdio 本地 server。network MCP（http/sse）v1 完全不进 UI、不解析、不给表单——Ravel 没有 harness 侧凭证体系可指靠，做了就是假只读

### 执行桥契约（ravel-mcp-bridge）

- 启动时读两级 mcp.json（project 覆盖 user 同名 key），仅加载 `enabled: true` 且命令通过校验的 server
- 注册工具名 `mcp__<server>__<tool>`（name 经 charset 清洗，冲突时后到者跳过并留警告）
- 进程生命周期：随 run 结束不杀（连接池复用），Worker 死亡则子进程一并回收；启动超时 10s 标记 server unavailable，不阻塞其余 server
- `riskTierOf` 不改：MCP 工具落 untrusted 档 → workspace-only / read-only 直接拒绝，ask-before-command 走既有持久化审批。这是特性不是缺陷：MCP 默认不可用，逐次放行留痕
- 桥未加载/缺失时，ResourceCenter 行如实显示"已定义 · 执行桥未加载"，enabled 状态不伪装生效

### ResourceCenter UI（第四类资源）

- 列表行：图标 + 名称 + `(command)` 摘要 + scope 徽标（user/project）+ enabled 开关 + 移除按钮
- 添加表单：名称 / 可执行文件 / 参数（每行一个）/ scope 单选；校验边界照搬 GooeyPi 实测值——name ≤64 且 `^[A-Za-z0-9][A-Za-z0-9_.:-]*$`、command ≤2048 不以 `-` 开头无控制字符、args ≤64×2048；拒绝重复名
- 写文件机制（简化自 GooeyPi `mcp.ts`）：`<path>.lock` 目录锁 + owner pid 存活检测；内容 sha256 指纹重试；temp+rename 原子写，失败回滚
- disable/remove 均弹确认框：remove 文案明确"仅移除定义，不影响任何凭据"
- 项目域写操作要求项目已信任（复用 authorizeProject 语义）

### 改动清单

- `electron/mcp-service.js`（新）：读写/校验/锁/原子写，纯函数分离便于测试
- `electron/resource-center.js`：kind 扩展 `"mcp"`，或并列独立 service 由 registry 分发
- `ipc-contracts.js` / `ipc-registry.js` / `preload.js`：mcpList/mcpAdd/mcpSetEnabled/mcpRemove
- `ResourceCenter.tsx`：第四分区 + 表单 + 确认框
- `resources/extensions/ravel-mcp-bridge/`（新，随桌面分发的 pi 扩展）
- `permission-profiles.js`：无需改（MCP 工具走 untrusted 默认档），补测试断言该行为
- i18n、测试

### 分期

- **MCP-A**：mcp.json 管理 + ResourceCenter 全套（无执行，行显示"执行桥未加载"）——独立可发布
- **MCP-B**：ravel-mcp-bridge 扩展落地，工具真实进入管线与审批流

A 不依赖 B 可先行；B 未落地前 UI 不得暗示工具可用。

### 明确不做

- network/http/sse server 的任何入口（含只读展示）
- OAuth / 凭据管理
- npm/git 在线安装 server
- 绕过 pi 管线的桌面侧直连执行

### 验收

- user/project 两级定义 CRUD 正确落盘；并发写有锁不互踩
- ask-before-command 下 bash 同批的 `mcp__x__y` 调用弹出确认，拒绝/超时落 approval_decided 事实且 fail-closed
- workspace-only 下 MCP 工具直接拒绝并有可见提示
- 桥未加载时 UI 状态如实，enabled 开关不假装生效

---

## 实施顺序建议

1. **S2 动态视图**：零事实增量、零 schema 变更，最先落地验证投影架构
2. **S3 @session 引用**：动 packages/agent 词汇表，单独成刀，codec/reducer/桌面三端同步改
3. **S4 分两期**：MCP-A 管理面可与 S2/S3 并行；MCP-B 执行桥独立评审（涉及新进程模型）

每步之后跑 `npm run check`；涉 packages/agent 的改动跑该包定向 vitest，桌面侧跑 node:test。

---

## 实施状态（2026-08-26）

三个切片已全部落地并通过验证：

- **S2 动态视图**：`electron/activity-service.js` 纯追踪器（waiting>running>failed>done 推导、ask 超时镜像 worker 模态计时器）；主进程在 `bindHost.onEvent`/`onTransport`/UI ask/decide 四处接线；重启对账走 `session-reader.readSessionActivity`（mtime 缓存扫描 ravel_record 事实）+ `session-facts.deriveActivityFromFacts`；活态行优先于磁盘派生。IPC 为 `omega:activitySnapshot` + `activity:changed` 推送。渲染层 `activity-projection.ts` 纯函数（签名清除表存 localStorage，不进事实层）、`ActivityList.tsx`、LeftNav 第四 tab 带 attention 徽标。
- **S3 @session 引用**：packages/agent 新增 `SessionReferenceRecord`（types + codec 校验 + RECORD_TYPES）；桌面 `session-facts.js` 扩 FACT_TYPES 与字段校验，新增 routing 块构建/剥离、`resolveSourceEntryId`（leaf 链优先、文本匹配兜底）、`appendSessionReferenceFacts`（按 clientMessageId+target 幂等）。worker 在 prompt 落盘后补记（steer 场景有界重试 10×300ms）；模型可见块由 worker 追加进 prompt 正文，展示与 copy 经 `sanitizeTranscript` 剥离并投影 references。Composer 单一 @ 菜单合并会话候选（同工作区顶层 ≤6）+ 文件补全；MessageBubble 按 entryId 关联渲染可点击 chip。
- **S4 MCP**：A 期 `electron/mcp-service.js`（校验边界 name≤64/command≤2048/args≤64×2048、mkdir+owner.json 目录锁带陈旧回收、temp+rename 原子写）+ 四条 IPC + ResourceCenter MCP 分区（添加表单/启停/移除确认；桥未加载时如实显示警示，enabled 不伪装生效）。B 期第一方扩展 `.pi/extensions/ravel-mcp-bridge/index.ts`：stdio JSON-RPC 握手、tools/list 动态注册为 `mcp__<server>__<tool>`、10s 启动超时按服务器隔离失败、session_shutdown 回收子进程。工具经 pi 原生管线 → riskTierOf untrusted 默认档 → ask-before-command 审批事实照旧落盘。

验证记录（2026-08-26 落地时快照）：桌面 `npm test` 204 通过（含新增 activity-service/session-reference/mcp-service 三份测试文件）；packages/agent jsonl+reducer vitest 210 通过（含 session_reference round-trip 与损坏拒绝两例）；仓库根 `npm run check` EXIT=0。桌面套件当前为 286 通过。

已知边界（有意为之）：引用草稿不持久化（刷新后 @ 文本保留、结构化引用需重新选择）；Activity 徽标的 cleared 表是 UI 态不跨设备；MCP 仅 stdio，网络传输无入口；同名标题去重在 Composer 侧完成。
