# Ravel × Histos 全栈重构计划

更新日期：2026-08-26
状态：计划（未开始实施）
前置：`docs/ravel-core-design-and-next-slices.md`、`docs/ravel-design-activity-session-reference-mcp.md`

本文是铬件重构、性能不变量和 Histos 三层落地的单一执行计划。它不替代核心设计文档；核心不变量仍以 `ravel-core-design-and-next-slices.md` 为准。冲突时以那份为准，本文只负责「怎么改、按什么顺序、验收什么」。

---

## 0. 一句话

底座（JSONL 事实、Electron 隔离、Pi 运行时）已经是 Histos 的正确地基；要换的是铬件表皮和派生索引层，不是壳、不是执行权威、不是再造一套画布引擎。

---

## 1. 产品与架构不变量（冻结，重构不得触碰）

| 不变量 | 含义 | 违反即失败 |
|---|---|---|
| 三层权威 | 事实层 = JSONL + Git 工作区 + skill/插件文件；凝练层 = 可重建派生索引；可视层 = 投影 | 画布/摘要/sqlite 反写 JSONL 或文件原文 |
| 对象 id 冻结 | `sessionId+entryId`、`operationId`、`toolCallId`、审批成对 id、`workspaceId+相对路径`、skill `name+path+content hash` | Graph 节点 id 回写这些 id |
| 切分只切索引 | 长内容 span 是派生 id（`entryId+offset+length`）；entry 本身不碎 | compaction 把一条 entry 变成不可寻址碎片 |
| 单一事实写者 | `electron/session-facts.js` 是唯一 LaneRecord 写入点 | Main/Renderer 各自拼 JSONL |
| 审批 fail-closed | 先 `approval_asked`，再 UI，再 `approval_decided`；append 失败不得放行 | UI confirm 直接当权限 |
| Electron 隔离 | contextIsolation + sandbox + CSP（无 `unsafe-inline`/`eval`）+ IPC allowlist + 路径 containment | renderer 碰 fs/Git/凭据/Pi SDK |
| 进程模型 | Main → utilityProcess Worker → preload 窄桥 → React | Tauri / Next sidecar / 本地 HTTP agent |
| 执行权威 | Pi `AgentSessionRuntime`；AgentHarness 只提供 record/reducer 语义 | 把 Harness 未实现的 runtime 当桌面执行器 |
| 内核路线 | 一切可寻址事实 + 派生索引；不是 Cordis 插件内核 | 引入服务定位器 / 事件总线内核 |

明确不做（沿用核心设计 §2.6，本计划再锁一次）：

- 换壳、换 JSONL、换 Pi 运行时
- 第一天自研 Canvas 2D / 自研弹簧 / 自研图布局
- Monaco 作为节点内编辑器
- Cordis、Plan/Todo 假面板、第二套 turn schema、第二套审批库
- 跨项目记忆、云沙箱、computer use

---

## 2. 当前基线（2026-08-26）

已经为 Histos 服务、必须保留的：

- 切片 0：Scout/Workflow 删除，右栏回到 Diff/Worktree
- 切片 1：operation 成对事实、审批成对落盘、时间线纯投影、事件身份、compaction 不毁日志
- S2 动态视图（零新事实）、S3 `session_reference` 边、S4 MCP stdio 桥
- checkpoint / 全局搜索 / 遥测面板
- 工作台：三栏 grid、键盘可调宽、compact drawer + inert、Focus Mode
- 安全：IPC 四方同步测试、path-security、Project Trust、safeStorage vault

阻塞美观、性能和 Histos 的：

| 问题 | 证据 | 代价 |
|---|---|---|
| 三套样式并存 | MUI/emotion + Tailwind 3 + `sx` + `--omega-*` CSS 变量；`tokens.ts` 几乎空（只剩字体和 CSP nonce），颜色在 `palettes.ts` 与 `global.css` 双份维护 | CSP nonce 专门对齐；MUI v5 `InputProps`/`slotProps` 分裂；主题 override 层持续膨胀 |
| Material 视觉基因 | `ThemeProvider.tsx` 用大段 componentOverrides「去 MUI 化」 | 琥珀工匠被默认值对抗，微凸触感无法稳定落地 |
| 长列表无虚拟化 | `MessageList.tsx` 只有 `WINDOW_SIZE=60` 窗口，无 TanStack Virtual | 长会话 DOM 悬崖 |
| 高频流进 React | streaming token 走 Zustand store | 打字机效果可能拖垮整窗 |
| 派生索引不存在 | 只有 JSONL + 内存投影（`operation-timeline.ts`、`activity-projection.ts`） | Histos 凝练层无处落盘，画布一旦开工就会把摘要当真相 |
| skill hash 未物化 | 设计要求 `name+path+content hash`，写入端尚未强制 | 覆盖 skill 无法时间追溯 |
| checkpoint 未接 facts | shadow-git ref 独立于 LaneRecord | 快照不能按 operationId 寻址 |
| Vite IIFE + 无 React Compiler | `vite.config.ts` 单 chunk IIFE（CSP 硬约束） | 构建约束必须保留；Compiler 尚未接线 |
| Header 图腾未落地 | 设计要 ∞ 双环仪表，现状仍是图标/文字状态 | 品牌识别缺位 |

产品空位（不在本计划第一刀，但栈上要预留口）：

- 嵌入式终端（`node-pty`，原生依赖评审）
- MCP 网络传输（当前仅 stdio）
- 整文件编辑器面板（那时才评估 Monaco）

---

## 3. 目标技术栈（锁定）

分三层配，禁止混层。

### 3.1 壳与工程（保持 + 小步升级）

| 项 | 目标 | 说明 |
|---|---|---|
| 桌面壳 | Electron 43 | 不换 |
| 渲染构建 | Vite 6 + `@vitejs/plugin-react` | **继续 IIFE 单文件 + 外部 CSS**；CSP 禁止 ES module / eval / HMR dev server |
| 语言 | TypeScript 5.9 + tsgo 检查 | erasable TS 规则不变 |
| Lint | Biome 2 | 不变 |
| 包管理 | npm workspaces，精确 pin | 不迁 pnpm |
| 测试 | 桌面 `node:test`；harness vitest | 不统一测试栈 |
| CI | 现有 ubuntu + Windows desktop job | 新增 Histos 索引测试、虚拟化行为测试 |

### 3.2 铬件（换）

| 项 | 目标 | 换掉 |
|---|---|---|
| UI 框架 | React 19 + React Compiler | React 18 手工 memo 为主 |
| 样式 | Tailwind 4 + CSS 变量（唯一 token 源） | emotion 全删；Tailwind 3 |
| 组件 | shadcn 式拷进仓库的无头原语（Radix / Base UI） | `@mui/material` `@mui/icons-material` `@emotion/*` |
| 动效 | CSS `transform/opacity` 默认；`motion` 仅弹簧微交互 | JS 逐帧、emotion keyframes |
| 状态 | Zustand 继续管铬件；图数据不进这个 store | 单 store 塞进画布权威 |
| 长列表 | TanStack Virtual | 全量 DOM |
| Markdown | react-markdown + highlight.js 维持 | 不换 shiki |
| 节点/行内代码 | CodeMirror 6 | Monaco |
| 字体 | Inter + JetBrains Mono，DOM 与将来 Canvas 共用 | 系统等宽兜底可留 |

### 3.3 Histos（新增，按切片出现）

| 项 | 目标 | 禁止 |
|---|---|---|
| 派生索引存储 | Node 22 `node:sqlite`（零新原生依赖） | 把 Map 当持久化；把索引写进 JSONL |
| 运行时查找 | hydrate 后的 `Map<nodeId, FactReference>` | 只靠 Map、崩溃不可重建 |
| 图视图草稿 | Zustand 选中/视口 + 局部 Immer | Immer state 当图权威 |
| 图画布 | React Flow（`@xyflow/react`）起步 | 第一天自研 Canvas 2D |
| 图布局 | elkjs 跑在 Web Worker | 主线程布局、自研 layout |
| 远景 LOD | 单画布简单节点过阈值且掉帧后，再加 Canvas 远景层 | 现在做 Excalidraw 级引擎 |
| 远景弹簧 | 仅 LOD 阶段与 Canvas rAF 同循环 | 现在自研弹簧系统 |

升级判据（写进代码注释与本计划，避免提前自研）：

```text
React Flow 节点保持 React 组件，直到同时满足：
  1. 单画布可见简单节点持续 > ~2000
  2. 交互帧时间（拖拽/缩放）P95 > 16ms
  3. 已用 elkjs worker + 视口裁剪 + 节点回收仍不够
才允许加 Canvas 远景层。远景只画矩形/边，拉近提升为 React 节点。
```

---

## 4. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer（无 fs / 无 Git / 无凭据 / 无 sqlite 句柄）            │
│  铬件: React 19 + Tailwind 4 tokens + 自持原语 + Zustand     │
│  时间线: operation-timeline.ts 纯投影 + TanStack Virtual     │
│  画布: React Flow 自定义节点（消费 GraphProjection DTO）      │
│  流: streaming 走 store.subscribe / rAF 批，不进热路径        │
└──────────────────────────▲──────────────────────────────────┘
                           │ 受控 DTO / IPC allowlist
┌──────────────────────────┴──────────────────────────────────┐
│ Main                                                         │
│  窗口、路径安全、Git review、checkpoint、search、MCP 配置      │
│  HistosIndexHost: 打开/关闭 sqlite、增量投影、崩溃重建         │
│  不写 JSONL 事实（继续禁止）                                   │
└──────────────────────────▲──────────────────────────────────┘
                           │ worker protocol
┌──────────────────────────┴──────────────────────────────────┐
│ utilityProcess worker.mjs                                    │
│  Pi AgentSessionRuntime = 执行权威                           │
│  session-facts.js = 唯一 LaneRecord 写者                     │
│  工具 / 审批 / compaction / MCP 桥                           │
└──────────────────────────▲──────────────────────────────────┘
                           │
        JSONL（事实）  Git 工作区  skill/插件文件
                           │
              Histos sqlite（派生索引，可删可重建）
```

数据流硬规则：

1. 事实只追加。索引只引用冻结 id。画布手势只产生「视图草稿」或「追加一条新索引/新会话」。
2. 改节点文案 = 开新会话或写新 skill 版本，不是 patch sqlite 当原文。
3. 删除 sqlite 文件后启动，必须能从 JSONL + 工作区完整重建投影（允许暂时无 LLM 凝练，结构边必须在）。

---

## 5. 设计系统（琥珀工匠，唯一视觉权威）

token 只活在 CSS 自定义属性里。TypeScript 只读 `getComputedStyle` 或一份由 CSS 生成的类型，不再维护 `palettes.ts` 第二份色板。

### 5.1 Token 契约

保留现有 `--omega-*` 命名（迁移成本低于更名），补齐几何与运动（今天 `tokens.ts` 空缺的部分）：

```text
表面     --omega-bg / -rail / -panel / -soft / -elevated / -overlay / -code
描边     --omega-border / -border-strong
文字     --omega-text / -soft / -muted / -dim
强调     --omega-accent / -strong / -soft / -line / -foreground / -gradient
语义     --omega-success|warning|danger 及其 -soft
触感     --omega-inset-highlight / -inset-recessed / -shadow-{sm,md,lg}
运动     --omega-ease-out / --omega-dur-fast(120ms) / -normal(200ms) / -slow(320ms)
几何     --omega-radius-{sm,md,lg,pill}  --omega-hairline  --omega-focus-ring
```

暗色底板保持 `#0c0d10`–`#16181e`。暖色只出现在 accent、用户气泡、焦点环。

### 5.2 触感与动效纪律

- 实体按钮 / Tab / Kbd：顶部微凸 `inset 0 1px 0`（`--omega-inset-highlight`）
- 状态胶囊 / 仪表：内凹 `--omega-inset-recessed`
- 面板：平整 hairline，不加厚阴影
- 动画只碰 `transform` 与 `opacity`；禁止 JS 驱动 width/height/top
- 全局尊重 `prefers-reduced-motion: reduce`（∞ 图腾停转、弹簧关闭）
- `motion` 库仅用于 press 弹性（80–120ms）和画布节点出现；列表滚动、面板开合走 CSS

### 5.3 品牌表面

- Header 状态图腾：Ω → ∞ 双环精密仪表（旋转 / 呼吸 / 错误告警）
- Context Donut：三色（琥珀 / 橙 / 红）刻度环
- Composer：悬浮毛玻璃岛（已有方向，迁到新原语后保持）
- ToolCard：Pending / Running / Done / Error 状态机 + 耗时 + 结构化 diff 刻度

### 5.4 无头原语最小集（先这五个，禁止一次搬完整 shadcn 目录）

`Button` `Dialog` `Popover` `Menu` `Tooltip` `TextField`（第六个是输入，和五个行为原语一起作为铬件地基）。

新面板只用这套。旧 MUI 面板绞杀迁移，不平行双设计系统超过 R2 结束。

### 5.5 构建安全

删 emotion 后：

- CSP `style-src` 可回到 `'self'`，去掉静态 nonce
- 删除 `STYLE_NONCE`、`emotion-cache.ts`、ThemeProvider 的 CacheProvider
- Tailwind 4 必须产出**外部** `dist/assets/index.css`；禁止 runtime CSS-in-JS 回归

Vite 继续 `format: 'iife'` + `inlineDynamicImports: true`。React Compiler 用 babel 插件进 `@vitejs/plugin-react`，不引入 Vite dev server。

---

## 6. 性能不变量（写入代码与审查清单）

这五条比换库更决定「好不好用」：

1. **高频流不进 React 热路径。** streaming token、遥测 tick、elk 布局进度、画布平移，走 `store.subscribe` 直更 DOM/canvas，或 rAF 合并后每帧最多一次 setState。
2. **投影是纯函数，可丢可重建。** `operation-timeline.ts` / `activity-projection.ts` / 未来 `graph-projection.ts` 禁止副作用、禁止写 facts。
3. **长列表虚拟化。** MessageList、ActivityList、Search 结果、Diff hunk 行超过阈值必须 virtualize。MessageList 现有 `WINDOW_SIZE=60` 可保留为数据窗口，虚拟化管 DOM 窗口。
4. **拖拽改 CSS 变量，不改 React 树。** 已部分做到（Workbench widths）；R1 把 `--inspector-width` / `--sidebar-width` 提升为拖拽中唯一来源，pointerup 才 persist。
5. **Worker 与索引增量异步。** sqlite 写入、elk 布局、片段切分不得阻塞 prompt 热路径；失败进入诊断，不回滚已追加的 JSONL 事实。

预算（验收用，可在开发机上用 Performance 面板抽测，不进 CI 的 flaky 数字门）：

| 场景 | 目标 |
|---|---|
| 空闲工作台 | 主线程空闲，无 1s 间隔强制重渲染 |
| 打字机 80 tok/s | 聊天列以外的面板不因 token 重绘 |
| 200 条可见消息 | 滚动 60fps；DOM 节点数不随历史线性涨 |
| 画布 500 React 节点 | 平移/缩放 P95 ≤ 16ms |
| 索引重建 10k JSONL 行 | Main 不卡窗口；进度可取消 |

---

## 7. Histos 数据契约（凝练层，R3 起实现）

### 7.1 存储位置

```text
<sessions-root>/<sessionId>.jsonl          事实（现有）
<sessions-root>/<sessionId>.histos.sqlite  派生索引（新，可删）
```

同目录、按 session 隔离。跨 session 边（已有 `session_reference`）在两边各有一份引用行，删除一边 sqlite 不影响 JSONL。

### 7.2 最小 schema

```sql
-- 节点指向冻结事实，不存原文
nodes (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- entry | span | file | skill | operation | tool | approval
  fact_kind TEXT NOT NULL,
  fact_ref TEXT NOT NULL,        -- 规范化引用，见下
  title TEXT,
  created_at INTEGER NOT NULL,
  superseded_by TEXT             -- 新版本节点 id；旧行保留
);

edges (
  edge_id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,            -- references | contains | produced | approved | derived_from
  fact_ref TEXT,                 -- 可选，边自己的依据（如 session_reference record id）
  created_at INTEGER NOT NULL
);

spans (
  span_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  start INTEGER NOT NULL,        -- utf-8 byte offset
  length INTEGER NOT NULL,
  superseded_by TEXT
);

meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- schema_version, last_entry_id, last_seq
);
```

`fact_ref` 规范化示例：

```text
entry:     session:{id}/entry:{entryId}
span:      session:{id}/entry:{entryId}#{start}:{length}
operation: session:{id}/op:{operationId}
tool:      session:{id}/tool:{toolCallId}
approval:  session:{id}/approval:{askedId}
file:      ws:{workspaceId}/{repoRelative}[@ckpt:{checkpointId}]
skill:     skill:{name}@{sha256}
```

### 7.3 写入规则

- 结构边（operation 包含 tool、ask→decide、session_reference）由确定性投影器从 facts 生成，不经 LLM。
- 语义边（「这段实现了那个需求」）才走凝练 agent，且必须带 `fact_ref`。
- 任何写入都是 INSERT；更新 = 新行 + `superseded_by`。
- 切分器只写 `spans`，不改 JSONL。

### 7.4 重建

启动或 schema 不匹配时：扫 JSONL facts → 重建 nodes/edges 中的结构部分 → spans 按现行切分策略重切 → 语义边若无法从 facts 证明则丢弃（允许空，不允许猜）。

---

## 8. 分阶段实施

原则：每一阶段单独可合并、可回滚、有测试；后一阶段不依赖「把前一阶段做完美」。

### R0 — 性能与契约（不换栈，1 刀）

目标：在仍用 MUI 的情况下先把悬崖填上，并收口 token 源。

做：

- MessageList / ActivityList / Search 结果接 TanStack Virtual
- streaming 文本改为 `subscribe` + 目标节点 `textContent`（或 16ms 批处理）；store 只保留「当前 bucket 的只读快照」供切会话
- `tokens.ts` 补齐几何/运动常量，或改为从 CSS 读取；停止让 `palettes.ts` 与 `global.css` 手工双写（生成或单源）
- checkpoint 创建/恢复补记 facts（带 `operationId`，失败只记日志不阻断 Git）
- skill 写入物化 content hash（覆盖 = 新版本 id）

验收：

- 200 条消息滚动不卡；切会话滚动位置仍用现有 `scrollMemory`
- 打字机期间 React Profiler 上 ToolCard/Header 不随每个 token 重渲
- `npm run check` 全绿；新增 virtualization 与 hash 单测

不做：换 React 19、删 MUI、画布。

### R1 — 设计地基（可并行于 R0 收尾）

目标：新代码有地方可写，旧代码暂时并存。

做：

- 升 React 19 + React Compiler + Vite 6（保持 IIFE/CSP）
- 升 Tailwind 4；`global.css` 迁 `@theme`，token 仍名 `--omega-*`
- 引入 `src/renderer/ui/`：五个+输入原语，shadcn 式拷贝，琥珀 class 写死在组件里
- Header ∞ 图腾、Context Donut 按设计重做（可用 SVG + CSS，不必 Canvas）
- 面板宽度拖拽改 CSS 变量（学 GooeyPi：pointermove 不 setState）
- `prefers-reduced-motion` 接到图腾和 motion

验收：

- 新原语在 Settings/空状态至少各出现一次
- 删除 emotion 之前 CSP nonce 仍工作（双轨期）
- 无视觉回归门：暗/亮、200% 缩放（已有 `docs/wcag-144-zoom.md`）仍过

不做：删 MUI。

### R2 — 绞杀 MUI（铬件迁完才算 Histos 可视层开工许可证）

迁移顺序（按耦合从低到高）：

1. Tooltip / IconButton / Menu / Dialog（ResourceCenter、Settings、Trust）
2. LeftNav / RightPanel Tabs
3. Composer / ApprovalBar / Header
4. MessageBubble / ToolCard / ThinkingBlock
5. DiffViewer / FileTree / 其余面板
6. 删除 `@mui/*` `@emotion/*`、`ThemeProvider` 的 MUI 路径、`STYLE_NONCE`

每迁一个目录：该文件禁止新 `sx=` 和 `@mui` import；CI grep 卡口在第 6 步启用。

验收：

- renderer `package.json` 无 MUI/emotion
- CSP `style-src 'self'`（无 nonce）
- i18n、快捷键、审批 fail-closed、IPC 四方同步测试全绿
- 微凸触感在 Button/Tab/Kbd 上可指出，而不是「看起来差不多」

### R3 — Histos 索引层（画布的硬前置）

这是核心，不是 UI。

做：

- `electron/histos-index.js`：打开 sqlite、schema、增量 apply、全量 rebuild
- Worker 在 `session-facts` 追加成功后发「事实已落」信号；Main 索引器消费（失败不回滚事实）
- 切分器：短内容不切；长内容按段；动态再切只追加 span
- IPC：`omega:histosGetGraph`（按 session / 视口 / 节点 id 拉投影）、`omega:histosRebuild`
- 结构边投影：operation↔tool、ask↔decide、session_reference、file edit 指向 workspace 路径
- 测试：给定一段合成 JSONL，索引可重建；删 sqlite 再重建图等价（忽略 title 缓存）

验收：

- 删除 `.histos.sqlite` 重启，动态视图和时间线不受损（它们本就不该读 sqlite）
- 新 IPC 进 `ipc-registry` / contracts / preload / client 四方
- 不实现 LLM 凝练；语义边表可空

不做：画布 UI、改 JSONL schema。

### R4 — Histos 可视层（React Flow）

前置：R2 完成（节点必须能用新原语），R3 完成（有可查询投影）。

做：

- 右栏或独立模式加「图谱」表面；默认仍是 Diff——画布不是替代编码闭环
- React Flow 自定义节点：operation、entry span、file、skill、approval
- 节点内容是铬件组件（ToolCard/Markdown 缩小版），不是 Canvas 绘制文本
- elkjs 在 Worker 或 renderer Worker 里算布局，主线程只应用坐标
- 交互：框选子集 → 「就这些开会话」（复用 newSession + session_reference 边）
- 视口/选中进 Zustand 视图草稿；落盘只追加索引或新会话
- 嵌套：大节点展开为 sub-flow（React Flow 已有），不要自研 scene graph

验收：

- 从节点跳回 transcript 对应 `entryId` / `toolCallId`（空间可追溯）
- 改图不能改 JSONL；刷新后手势草稿丢失是预期，结构边还在
- 500 节点平移达标；未达 §3.3 升级判据不得引入 Canvas 引擎

### R5 — 编码工作台收口（与画布解耦，可和 R3 并行）

只做已经明确缺口、且不破坏隔离的：

- 嵌入式终端：`node-pty` 走独立评审 + shrinkwrap allowlist；PTY 在 Main/PTY host，renderer 只收输出 DTO
- CodeMirror 6 用于节点内只读/小段编辑；整文件面板仍用现有 FileViewer，除非单独立项 Monaco
- PR/gh 面板继续不做，除非用户另开任务（依赖本机 `gh`）

MCP 网络传输、computer use 仍不在本计划。

### R6 — 可选 facade（不阻塞 Histos）

`packages/ravel-runtime` 把桌面从直接依赖 `@earendil-works/pi-coding-agent` 改为稳定 API。这是独立化，不是 Histos 前置。有真实分叉需求再做。

---

## 9. 包与文件落点

新建（按阶段出现）：

```text
apps/ravel-desktop/src/renderer/ui/          R1 原语
apps/ravel-desktop/src/renderer/lib/graph-projection.ts
apps/ravel-desktop/src/renderer/components/histos/   R4
apps/ravel-desktop/electron/histos-index.js          R3
apps/ravel-desktop/electron/histos-chunker.js        R3
apps/ravel-desktop/test/histos-index.test.mjs
```

保持单写者：

```text
apps/ravel-desktop/electron/session-facts.js
packages/agent/src/harness/session/types.ts   只加经过 codec/reducer 的新 record
```

删除（仅 R2 末）：

```text
@mui/material  @mui/icons-material  @emotion/react  @emotion/styled  @emotion/cache
src/renderer/theme/emotion-cache.ts
ThemeProvider 内 MUI createTheme 路径
```

IPC 新通道（R3，四方同步）：

```text
omega:histosGetGraph
omega:histosRebuild
omega:histosGetNode        -- 按 node_id 取投影 + fact_ref
```

不把 sqlite 句柄、原始 SQL、文件绝对路径传给 renderer。

---

## 10. 依赖与安全

| 依赖 | 阶段 | 约束 |
|---|---|---|
| `react` / `react-dom` 19.x 精确 pin | R1 | 与 `@types/react` 同步 |
| `@vitejs/plugin-react` 含 babel-plugin-react-compiler | R1 | 不启用 Vite 开发服务器 |
| `tailwindcss` 4.x | R1 | 外部 CSS；lockfile 走 `PI_ALLOW_LOCKFILE_CHANGE=1` 且用户明确要提交锁文件时才提交 |
| Radix / Base UI 相关包 | R1 | 精确 pin；无 lifecycle 脚本则不必改 shrinkwrap allowlist |
| `motion` | R1 | 可选；体积需进 release gate 观察 |
| `@tanstack/react-virtual` | R0 | 先于换栈 |
| `node:sqlite` | R3 | Node 22 内置，**不新增** npm 原生模块 |
| `@xyflow/react` | R4 | 精确 pin |
| `elkjs` | R4 | 布局进 Worker |
| `codemirror` 及语言包 | R4/R5 | 不要 `monaco-editor` |
| `node-pty` | R5 | **必须**走依赖评审 + coding-agent shrinkwrap allowlist；用户书面同意才加 |

`undici` 若被间接升版，按 AGENTS.md 先读 changelog。

Renderer 继续零原生依赖，electron-builder 不为铬件 rebuild。

---

## 11. 测试与门禁

每阶段结束都跑：

```text
npm run --workspace=@ravel/desktop test
npm run --workspace=@ravel/desktop typecheck
npm run --workspace=@ravel/desktop typecheck:renderer
npm run check
git diff --check
```

不跑完整 `npm test` / `npm run build`，除非用户要求。

新增测试类型：

| 阶段 | 测试 |
|---|---|
| R0 | 虚拟化窗口行为；streaming 不触发无关订阅；skill hash；checkpoint fact 配对 |
| R1 | token CSS 变量与 Tailwind theme 对齐的快照（不必像素）；CSP 仍拒绝 inline |
| R2 | grep 门禁：renderer 无 `@mui/` `@emotion/` |
| R3 | JSONL → sqlite 重建等价；非法 fact_ref 拒绝；删库重建 |
| R4 | graph-projection 纯函数；节点点击回跳 entryId；改图不写 JSONL（契约测试） |

---

## 12. 风险与回滚

| 风险 | 缓解 |
|---|---|
| React 19 + IIFE + Compiler 构建失败 | R1 单独提交；失败则停在 18 + Compiler 关闭 |
| Tailwind 4 与现有 class 不兼容 | 先 `@theme` 映射旧 `--omega-*`，不改 class 名 |
| 双轨期视觉分裂 | R2 周期压短；新原语 API 刻意少，避免两套 Button 语义 |
| sqlite 在 Windows 文件锁 | 每 session 单连接、Main 串行队列；Worker 不直接打开该文件 |
| React Flow 包体 | release gate 盯 asar 增量；节点懒挂载 |
| 过早自研 Canvas | §3.3 三条判据全部满足才开口子 |

回滚：每阶段独立 commit。R3 sqlite 可删——产品退回「无图、有时间线」。R2 若中途卡住，允许 MUI 残留在未迁文件，但禁止新文件引入 MUI。

---

## 13. 建议执行顺序（摘要）

```text
R0  虚拟化 + 流绕过 + token 单源 + hash/checkpoint 接 facts
R1  React19/Compiler/Vite6/Tailwind4 + 原语 + ∞ 图腾
R2  绞杀 MUI/emotion，CSP 去掉 nonce
R3  sqlite 派生索引 + 切分器 + 结构边投影     ← Histos 真正开始
R4  React Flow 画布（节点=铬件，布局=elk worker）
R5  PTY（评审后）、CodeMirror 小段编辑
R6  runtime facade（可选）
```

R0 可立即开工，不依赖设计争论。R4 不得早于 R2+R3。Canvas 引擎不进路线图，只进「升级判据」。

---

## 14. 成功标准（计划完成时）

1. 铬件是琥珀工匠：微凸、hairline、∞ 图腾、克制发光；不再能看出 Material。
2. 长会话、流式输出、面板拖拽在目标预算内。
3. 任意 Histos 节点/边能指回冻结 fact id；删索引文件产品仍可用。
4. 审批、隔离、IPC allowlist、JSONL 单写者与重构前同等或更严。
5. 后续加凝练 agent / 嵌套图 / 远景 Canvas 时，不必再换栈。
