# GooeyPi 前端排布与交互学习报告

更新日期：2026-08-26
对象：`D:\project\agent\omega\example\gooey-pi`（React 19 + Electron，无路由，手写 CSS）
范围：只学排布设计、信息架构、UI/UX、交互决策。不学配色，不学它技术栈选型（Ravel 保持 MUI + Zustand + 三栏 grid）。
行号引用均为该仓库内位置。

## 1. 布局骨架

DOM 结构（`src/App.tsx:529-567`）：

```
.app-shell（flex row，占满窗口）
├─ Sidebar aside                          ← 可收起的左栏
├─ .workbench（flex column, flex:1）
│  ├─ TitleToolbar header（固定 52px）
│  └─ .workbench__content
│     └─ .session-workspace（flex row，内联 CSS 变量控宽）
│        ├─ .conversation-column
│        │  ├─ conversation-pane（min-width:360px）
│        │  │  ├─ Transcript（absolute inset:0 滚动区）
│        │  │  └─ conversation-bottom-dock（absolute：ChangesCard + Composer 浮动停靠）
│        │  └─ TerminalDrawer（flex 兄弟，把对话区顶上去，不是 overlay）
│        ├─ ResizeHandle（vertical，仅 Inspector 打开时）
│        └─ Inspector aside（宽度 = --inspector-width）
└─ 全局 overlay：CommandPalette / Modal / toast / VoiceOrb
```

值得学的三个决策：

1. **面板尺寸全部走内联 CSS 变量**。`.session-workspace` 上挂 `--inspector-width` / `--terminal-height`，CSS 里 `flex-basis: var(--inspector-width, clamp(420px,46vw,660px))`（`styles/inspector.css:2`）。拖拽时直接改 DOM 变量获得即时反馈，pointerup 才提交 React state——渲染树在拖拽中不动。
2. **Composer 是浮动 bottom dock，不是流内元素**。居中 `width:min(calc(100%-48px),760px)`，transcript 用递增的底部 padding class（has-queued-messages 325px 等）保证内容不被遮挡（`transcript.css:3-6`）。输入框永远贴底，长会话也不跳。
3. **终端是 flex 兄弟节点而非覆盖层**，最大化时才切 `position:absolute; inset:0`。

## 2. 尺寸与断点机制

常量与钳制（`src/hooks/usePanelLayout.ts:4-10`）：`INSPECTOR_MIN=340 / DEFAULT=520`，`CHAT_MIN=360`，`TERMINAL_MIN=170 / DEFAULT=310`，`WORKSPACE_ROW_MIN=220`。动态上限用 ResizeObserver 实时算：`inspectorMax = 行宽 − CHAT_MIN`；上限收缩时把当前值钳回去（94-112 行）。两个尺寸持久化到 localStorage。

ResizeHandle（`src/components/ResizeHandle.tsx`）是完整可访问性组件：

- pointer capture 拖拽；pointercancel 回滚起始值
- **键盘调宽**：方向键 ±12px（Shift ±48），Home/End = min/max，双击重置默认值
- `role="separator"` + aria-valuemin/max/now
- 拖拽中给 body 加 `is-resizing-*` 类强制 `cursor: col-resize !important; user-select:none`

断点两级（`usePanelLayout.ts:35-92` + `styles/responsive.css`）：

- **≤980px compact**：sidebar 和 Inspector 变成固定定位的 overlay sheet（带 scrim 遮罩 + 滑入动画），resize 手柄隐藏；进入 compact 时若两面板同开则自动关一个并记住（compactRestoreRef），退出 compact 时恢复；overlay 开着时把背后的工作台设为 **inert**（不是只靠 focus trap）
- **≤720px smallest**：两个面板强制关闭并写回持久化状态；Inspector 全屏化；触控目标增大到 36px

对 Ravel 的落点：`Workbench.tsx` 已有 grid 三栏 + pointer capture + compact drawer + FocusTrap。缺的是：(a) 键盘调宽与 `role="separator"` 语义；(b) 双击重置默认宽；(c) compact drawer 背后内容 inert（现在只有 FocusTrap）；(d) 视口缩小时动态钳制已保存宽度。

## 3. 导航模型

- **state 路由，非 URL 路由**：`view: 'session'|'projects'|'activity'|'scheduled'|'plugins'|'settings'`（`App.tsx:86`）。页面组件 `lazy()` + Suspense，切换只替换 content 区，sidebar/toolbar 常驻。
- Sidebar 纵向列表（`Sidebar.tsx:285-299`）：New session（带 ⌘N kbd 标注）、Search（就地展开输入框过滤项目/会话）、Projects、**Activity（实时未读徽标）**、Scheduled、Capabilities；footer 放 Commands（⌘K）/更新/Settings（⌘,）。
- 左上角 harness switcher 是 logo+名称按钮 → 绝对定位菜单（`role="menuitemradio"` + 选中 Check）（246-277 行）。
- 项目下会话折叠列表，每项目最多显示 7 条（SIDEBAR_SESSION_LIMIT），按最后用户消息时间排序；chevron 折叠。
- 破坏性操作统一走通用 Modal（500px 居中，header/body/footer，portal + focus trap + 点背景关闭，`ui.tsx:146-159`）。

## 4. Transcript 对话区

几何：滚动区 absolute inset:0，内容列 `.transcript__inner { width:min(100%,760px); margin:0 auto }`（`transcript.css:2,9`）。

滚动引擎（`transcript/scroll.ts`）：

- 只渲染最新 250 条，顶部"Show N earlier messages"按钮扩窗
- pin-to-bottom 判定阈值 120px；rAF 自动滚动只在 pinned 且 streaming 时触发
- 隐藏 `aria-live` 区域播报"正在工作/回复完成"

分组与形态（`Transcript.tsx` + `timeline.tsx`）——这是最值得学的部分：

- 连续 assistant 消息合并为一个 turn（OR streaming 标志、拼接 parts）
- assistant 消息分**叙述段**（文本/图片）和**活动段**（thinking/toolCall/toolResult），中间活动段折叠成一行"**Worked for 3m12s**"披露条；末尾叙述正常展示（261-284 行）
- **进行中的 turn 不折叠**：渲染为左侧竖线轨道 + 脉冲点 + "Thinking|Working · 实时时长"状态行，时间戳叶子组件自 tick（1s interval），只重渲染标签不重渲染消息树
- 工具行单行摘要 `[图标][工具名][参数预览 180 字][状态 chip][chevron]`，状态四态 running/done/failed/needs input；展开是可滚动的 pre（200k 字符上限）+ Copy 工具条；正则分桶配图标（terminal/web/git/file/mcp/question）
- compaction 渲染为有边 pill："Context compacted · automatic threshold · 182,344 tokens before"，可展开看摘要
- steer 生命周期可见：用户气泡尾部显示"Accepted — waiting for the next safe steering point"/"Read by agent"，消费点画一条细分隔线标记
- Copy 按钮悬停出现，且**只复制可见叙述**（剔除隐藏上下文块和折叠活动）
- 每条消息包 ErrorBoundary，单条渲染崩溃不影响整页

对 Ravel 的落点：Ravel 已有 operation 时间线轮次行和压缩标记（切片 1b）。差距在：(a) 已完成 turn 的活动段没有折叠披露条，长会话全是展开工具卡；(b) 流式 turn 没有"live rail + 实时时长"形态；(c) 没有最新 N 条窗口化；(d) copy 未做可见叙述过滤；(e) 单消息 ErrorBoundary。

## 5. Composer

结构自上而下：队列卡片 → 输入卡 → 提示行（`Composer.tsx`，864 行）。

**Queue/steer 卡片**（483-502 行）：排队消息每行 hover 出三动作——send now（出队立即以 steer 发送）、edit（出队载回输入框）、delete。忙时发送默认 queue 意图，Ctrl/Cmd+Enter 切换为相反意图；runtime 空闲时 App 层自动 flush 队列。

**单一菜单状态机**：`menu: 'add'|'mention'|'command'|null` 驱动一个锚定在输入框上方的 listbox（569-591 行），三种弹层互斥：

- `/` 开头 → slash 命令前缀过滤
- 尾部 `@query` → 合并建议：会话 ≤6 条（detail 显示 "OMP session · running"）+ skills ≤6 条，共 ≤8
- 接受提及后 `acceptedMentionRef` 抑制同一 token 再次弹菜单，Backspace 才复位
- ↑↓ 循环、Enter 先于发送处理、Escape 关闭、IME isComposing 保护

**附件纪律**（`useComposerImages.ts`）：粘贴拦截文件（文本照插）；拖放深度计数 enter/leave + 虚线 overlay；限制 8 文件/约 1.35MB 原始字节/2MB 序列化帧；超限 chip 硬阻塞发送并**点名具体文件**；异步 base64 用预订计数器防双提交竞态；发送失败把图片恢复到托盘并报告几张没塞进去。

**Footer 控件**：左侧 + 附件、模型 select（provider 分组 optgroup，未连接的后缀 "· not connected"、不可用禁用）、reasoning 下拉、Fast mode pill、worktree picker popover（radio 列表 + 内联创建表单）；右侧 **context 用量环**（26.4px conic-gradient + 中心百分数，≥80% 琥珀 ≥95% 红）、麦克风、发送键三态（录音→转写发送 / 忙→红色停止方块 / 空内容禁用）。

**Draft 与会话隔离**：composer 以 `${projectId}:${sessionId}` 为 key remount，每会话独立状态；崩溃草稿靠 ErrorBoundary.onCatch 快照 textarea DOM 值进 sessionStorage，重新挂载时取走（`lib/composer-draft.ts`）。

对 Ravel 的落点：Ravel 已有 queue 分组和 context 环（Header ContextDonut）。可搬：队列行三动作、单一 menu 状态机（现在 Ravel 无 @ 补全）、失败恢复附件、发送键三态、placeholder 教学文案（"@ 引用会话，/ 命令"）。

## 6. Activity 页

`src/pages/ActivityPage.tsx` 仅 63 行，因为它是纯投影：

- 数据源 = renderer 的 sessions 数组 + localStorage 清除签名表，**无独立 activity store**
- 状态机在 `session-attention.ts:8-22`：extension_ui_request→waiting+unread；agent_start/turn_start/compaction_start/retry_start→running；error 族→failed；agent_end/runtime_exit(expected)→complete
- 注意力签名 = `` `${status}:${eventRevision}` ``；清除 = 把签名写入 localStorage map；同一修订号上出现新的 failed/waiting 签名会重新告警
- UI：分段过滤 all / attention(unread||waiting||failed) / running + 文本过滤 + updatedAt 降序 + 250 条分页
- 行解剖（78px min-height，发丝线分隔）：30px 状态图标块（spinner/alert/check）→ 标题(+New 徽标) → 预览行 → 项目名 + 相对时间 → 右侧状态 chip；整行是按钮点击进会话；hover 出 X 清除（waiting/failed 用警示色）；工具栏"Clear all"
- 空状态："You're all caught up"

关键架构决策：**Activity 不存任何数据，只是会话状态的过滤器 + 一个用户手动的"我看到了"签名表**。签名表是 UI 态（localStorage），不是事实层。

## 7. Inspector 右栏

- 四个文本 tab：Summary / Changes / Browser / Files，42px 头，roving tabindex 键盘导航，下划线指示器；**只有激活的 tab 挂载**（`Inspector.tsx:70-75`）
- Changes 有 git 文件数实时徽标；agent 一旦发生浏览器动作，右栏自动弹出并切到 Browser tab（`App.tsx:314-324`）——"事件驱动面板切换"
- Summary = 运行态 chip → 标题 → 最后一条 assistant 文本截 220 字符，下面 bordered 分节 dl

对 Ravel 的落点：RightPanel 现在 diff/worktree/telemetry/snapshots 四 tab。可借鉴"事件驱动切换"：worker 死亡自动切 telemetry，检测到审批等待自动开 diff 等。

## 8. 终端抽屉（要点）

多 tab xterm（上限 8 个），全部保持挂载非激活 display:none；早期输出按 id 缓冲 256KB 防 create 竞态；高亮选区发布为 composer chip，但**提交时刻**才从 xterm buffer 命令式读最终选区（避免输出驱动的重渲染）；整个可见 buffer 尾部 48k 防抖 100ms 推给主进程当"活跃上下文"。Ravel 当前不做终端，此节仅记录模式。

## 9. 命令面板与全局交互

- ⌘K 打开；9 个静态命令项，纯子串匹配（无 fuzzy 排序）；combobox/listbox + aria-activedescendant，↑↓ 不循环，Enter 运行
- 打开时整个 app-shell 设 **inert + aria-hidden**，用 refcount hook 与 modal 共享（`ui.tsx:130-144`）
- 580px 卡片，margin-top:min(14vh,110px)，结果 max-height:min(420px,60vh)，footer 图例 "↑↓ Navigate ↵ Open esc Close"
- Settings 深链用 `{section, id}` 请求计数器，重复导航到同一 section 也生效；Escape/⌘W 离开 Settings 回 session

## 10. 决策清单

### 直接搬（映射到 Ravel 组件）

| GooeyPi 决策 | Ravel 落点 |
|---|---|
| 活动段折叠成"Worked for Xm"披露条 + live rail | MessageList 轮次渲染 |
| 最新 250 条窗口化 + Show earlier | MessageList |
| 队列行 send-now/edit/delete 三动作 | Composer QueuedRow |
| 单一 menu 状态机（@ // 共用一个 listbox） | Composer 提及功能前置 |
| 附件限额点名报错 + 失败恢复托盘 | Composer attachments |
| Activity = 纯投影 + localStorage 签名清除表 | 动态视图（见设计文档） |
| 面板键盘调宽 + role=separator + 双击重置 | Workbench ResizeHandle |
| overlay 开时背后 inert | Workbench compact drawers、Dialogs |
| 事件驱动右栏切换 | RightPanel |
| copy 只复制可见叙述 | Markdown/MessageBubble |
| 单消息 ErrorBoundary | MessageList |

### 明确不学

- state 路由换成页面（Ravel 的 dialog centers + workbench 单视图更适合单项目深耕）
- 手写 CSS 体系（保留 MUI token 体系）
- localStorage 存业务数据之外的东西不加码（签名表这类 UI 态可以，事实一律落盘）
- 终端/浏览器/语音/宠物/Windows 原生菜单条（不在边界内）

### 反面提醒

- GooeyPi 的 `mergeSessionCatalog` 专门防止磁盘快照覆盖活着的 running/waiting 状态——Ravel 做 Activity 时同样要定义"活跃状态优先于落盘快照"的合并规则，否则重启前的旧 JSONL 会把 running 会话画死。
