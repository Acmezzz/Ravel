# Ravel × Histos 全栈重构计划

更新日期：2026-08-26
状态：**R0 / R1 / R2 已落地；R3 起按本文新 schema 开工，不得沿用旧 per-session sqlite / 薄 `fact_ref`**
前置：`docs/ravel-core-design-and-next-slices.md`、`docs/ravel-design-activity-session-reference-mcp.md`

本文是铬件重构、性能不变量和 Histos 三层落地的单一执行计划。它不替代核心设计文档；核心不变量仍以 `ravel-core-design-and-next-slices.md` 为准。冲突时以那份为准，本文负责「怎么改、按什么顺序、验收什么」，以及 **R3 之前必须冻结的 Histos 数据契约与进程边界**。

---

## 0. 一句话

底座（JSONL 事实、Electron 隔离、Pi 运行时）已经是 Histos 的正确地基。要换的是铬件表皮、派生查找层，以及把「被用过的语义图」收成可寻址工件。不换壳、不换执行权威、不把图画成数据库、不把画布当真相。

产品循环：

```text
Anything Addressable
  → Fact Space
  → SourceSet + Lens + Granularity
  → Distillation
  → GraphRevision
  → Graph / Flow / Nested Graph
  → Selection
  → Conversation / Edit / Skill / Flow / Agent Run
  → New Facts
  → Histos again
```

图是**万能投影**，不是万能存储。没有 Neo4j / ArangoDB / 第二套 agent runtime。

---

## 1. 产品与架构不变量（冻结，重构不得触碰）

| 不变量 | 含义 | 违反即失败 |
|---|---|---|
| 三层权威 | 事实层 = JSONL + Git 工作区 + skill/插件文件；凝练层 = 可重建查找索引 + 内容寻址工件；可视层 = 投影 | 画布 / 摘要 / sqlite 反写 JSONL 或文件原文 |
| 对象 id 冻结 | `sessionId+entryId`、`operationId`、`toolCallId`、审批成对 id、`workspaceId+相对路径`、skill `name+path+content hash` | Graph 节点 id 回写这些 id |
| 切分只切索引 | 长内容 span 是派生 selector；entry 本身不碎 | compaction 把一条 entry 变成不可寻址碎片 |
| 单一事实写者 | `electron/session-facts.js` 是唯一 LaneRecord 写入点 | Main / Renderer / Histos Engine 各自拼 JSONL |
| 审批 fail-closed | 先 `approval_asked`，再 UI，再 `approval_decided`；append 失败不得放行 | UI confirm 直接当权限 |
| Electron 隔离 | contextIsolation + sandbox + CSP（无 `unsafe-inline` / `eval`）+ IPC allowlist + 路径 containment | renderer 碰 fs / Git / 凭据 / Pi SDK / sqlite |
| 进程模型 | Main 管窗口与桥；Agent 与 Histos Engine 分属 utilityProcess；preload 窄桥 | Tauri / Next sidecar / 本地 HTTP agent / renderer 直连 sqlite |
| 执行权威 | Pi `AgentSessionRuntime`；AgentHarness 只提供 record/reducer 语义 | 把 Harness 未实现的 runtime 当桌面执行器；语义图直接执行 |
| 内核路线 | 一切可寻址事实 + 派生索引；不是 Cordis 插件内核 | 引入服务定位器 / 事件总线内核 / 图数据库 |

明确不做：

- 换壳、换 JSONL、换 Pi 运行时
- 第一天自研 Canvas 2D / 自研弹簧 / 自研图布局
- Monaco 作为节点内编辑器
- Cordis、Plan/Todo 假面板、第二套 turn schema、第二套审批库
- 跨项目记忆、云沙箱、computer use
- Neo4j / ArangoDB / 通用图数据库
- 语义 Graph 直接当 Flow 跑
- 把 sqlite 当 GraphRevision 权威

---

## 2. 当前基线（2026-08-26）

### 2.1 已经落地、必须保留

切片 0 / 1 / S2–S4：

- Scout / Workflow 删除，右栏 Diff / Worktree
- operation 成对事实、审批成对落盘、时间线纯投影、事件身份、compaction 不毁日志
- S2 动态视图（零新事实）、S3 `session_reference`、S4 MCP stdio 桥
- checkpoint / 全局搜索 / 遥测面板
- 工作台：三栏 grid、键盘可调宽、compact drawer + inert、Focus Mode
- 安全：IPC 四方同步、path-security、Project Trust、safeStorage vault

Histos R0（已实现，测试 `test/histos-r0.test.mjs`）：

- MessageList / ActivityList / Search 接 TanStack Virtual；`WINDOW_SIZE=60` 仍是数据窗口
- streaming 走 `src/renderer/lib/stream-live.ts`：rAF / 16ms 批、`useSyncExternalStore`；Zustand 只留气泡身份
- CSS 变量是颜色 SSOT；`tokens.ts` 只留几何 / 字体 / motion / MUI 兼容映射
- skill 写入物化 SHA-256（`electron/content-hash.js` + resource-center）
- checkpoint 经 `appendCheckpointFacts` 记成 `operation_started(kind=navigation, targetId=40-char SHA)` + `operation_finished`；Git 失败不回滚、facts 失败不阻断 Git

Histos R1（已实现，测试 `test/histos-r1.test.mjs`）：

- React 19.2.8 + Compiler（`babel-plugin-react-compiler` target 19）
- Vite 6.4.3，`base: "./"`，单文件 IIFE，`inlineDynamicImports: true`，`modulePreload: false`，无 HMR dev server
- Tailwind 4.3.3 + `@theme`；`--omega-*` 保留
- `src/renderer/ui/`：Button / Dialog / Menu / Popover / Tooltip / TextField / Switch / Tabs
- Header ∞ 图腾 + Context Donut（0 / 65 / 85 / 100）
- 面板拖拽 pointermove 只改 CSS 变量，pointerup 才 persist
- 原语首接：ModelPicker Popover、EmptyState、ResourceCenter / TrustCenter / ProjectTrustDialog / SettingsDialog

### 2.2 已完成

R2 绞杀 MUI 已完成：所有 renderer 业务组件改用本地原语或原生语义元素；ThemeProvider、Emotion cache、MUI/Emotion 依赖和静态 style nonce 已删除。

当前 CSP 为 `style-src 'self'`，样式由构建产物外部 CSS 提供。

### 2.3 当前运行时栈（以 `apps/ravel-desktop/package.json` 为准）

| 层 | 现状 | 备注 |
|---|---|---|
| 壳 | Electron 43.4.1，`file://` 加载 | `app://` 是独立安全候选，不是 Histos 前置 |
| 构建 | Vite 6.4.3 IIFE | Vite 8 / Rolldown 有门槛，见 §3.4 |
| 语言 | 桌面 TS 5.6.3；仓库根 TS 5.9.3 | TS 7 有门槛 |
| UI | React 19.2.8 + Compiler + Tailwind 4.3.3 | 颜色 SSOT 已是 CSS |
| 原语 | Radix 四件套 + 自持包装 | Base UI 目前只在 `ui/apps/v4` 实验，桌面未引入 |
| 状态 | Zustand 铬件 + stream-live 旁路 | 图数据不得进这个 store |
| 列表 | `@tanstack/react-virtual` 3.13.12 | 已接消息 / 动态 / 搜索 |
| Agent | Main → `utilityProcess` `worker.mjs` → preload → React | Histos Engine 尚未存在 |
| 索引 | 无 | 只有 JSONL + 内存投影 |

`apps/ravel-desktop/docs/system_design.md` 的 V1 表（React 18 / MUI 5 / Vite 5）是历史记录，不以它为准。

### 2.4 本计划相对旧稿改了什么

旧稿把 Histos 写成「每会话一个可删 sqlite + 薄 `fact_ref` 字符串 + Main 打开库」。那套**不得开工**。R3 之前必须按 §4 / §7 重设计。

| 旧稿 | 现稿 |
|---|---|
| `<sessionId>.histos.sqlite` | 每工作区一份查找库，落在 userData，不进仓库 |
| `fact_ref` 字符串 | 版本化 `FactAddress` |
| 节点 / 边单条 `fact_ref` | Evidence 多对多 |
| `superseded_by` 线性作废 | `revision_parents` DAG |
| LLM 语义图全当可删派生 | 被查看 / 保存 / 开会话 / 生成 skill 的 GraphRevision 必须持久；sqlite 仍可删 |
| 框选只是 UI 状态 | 冻结 `ContextSet`，新会话追加 `context_attached` |
| Main 或普通 sqlite worker | 独立 **Histos Engine utilityProcess** |
| 一张万能图 | 每次查询都是 SourceSet + Lens + Granularity |
| Flow 另起炉灶 | Flow ⊂ Graph；语义图不能直接执行 |

前端和画布技术路线不换：仍是 React 19 + Tailwind 4 + 自持原语 + TanStack Virtual + 后置 React Flow + elk worker。变的是数据契约和进程边界。

---

## 3. 目标技术栈（锁定，带门槛）

分三层配，禁止混层。未过门槛的升级不得提前混进 R2。

### 3.1 壳与工程

| 项 | 现在 | 目标 | 门槛 |
|---|---|---|---|
| 桌面壳 | Electron 43.4.1 | 保持 43.4.x；44 另评 | 43 基线全绿后才评 44 |
| 加载 | `file://` | 仍可；`app://` 可选 | `app://` 是壳安全候选，**不是** Histos 前置 |
| 渲染构建 | Vite 6.4.3 IIFE | Vite 8.1 + Rolldown 仍单文件 | 见 §3.4 |
| 语言 | TS 5.6 / 5.9 | TypeScript 7 | 桌面 `typecheck:renderer` 与 erasable 规则全过 |
| Lint | Biome 2 | 不变 | — |
| 包管理 | npm workspaces，精确 pin | 不迁 pnpm | lifecycle 脚本默认 `--ignore-scripts` |
| 测试 | 桌面 `node:test`；harness vitest | 不统一测试栈 | 不跑完整 `npm test` |

构建硬约束（无论 Vite 6 还是 8）：

```text
base: "./"
单一 classic IIFE
inlineDynamicImports / codeSplitting: false
modulePreload: false
外部 CSS
无 Vite HMR dev server
script-src 'self'；无 unsafe-inline / eval
R2 完成后 style-src 'self'（无 nonce）
```

### 3.2 铬件

| 项 | 目标 | 换掉 / 禁止 |
|---|---|---|
| UI 框架 | React 19.2 + React Compiler | 回到 React 18；把 Compiler 误认为已随 19 自动开启 |
| 样式 | Tailwind 4 + CSS 变量唯一 token | Emotion；Tailwind 3；TS 第二份色板 |
| 组件 | 自持包装，底层无头原语 | `@mui/*` `@emotion/*`；同一原语混用 Radix + Base UI |
| 无头库 | R2 继续用已引入的 Radix；R2.5 才评估迁 Base UI | 为换库而停 R2；桌面直接依赖 `ui/apps/v4` |
| 动效 | CSS `transform/opacity`；`motion` 仅弹簧微交互 | JS 逐帧、emotion keyframes |
| 状态 | Zustand 只管铬件 | 单 store 塞进画布权威 / GraphRevision |
| 长列表 | TanStack Virtual | 全量 DOM |
| Markdown | react-markdown + highlight.js | 不换 shiki |
| 节点 / 行内代码 | CodeMirror 6 | Monaco |
| 终端 | `@xterm/xterm`；PTY 在独立 utilityProcess | renderer 引 `node-pty` |
| 字体 | Inter + JetBrains Mono | — |

### 3.3 Histos 与画布（按切片出现）

| 项 | 目标 | 禁止 |
|---|---|---|
| 查找索引 | 工作区级 `node:sqlite`，Engine 进程独占 | Map 当持久化；索引写进 JSONL；renderer / Agent worker 打开 sqlite |
| 持久凝练 | 内容寻址 GraphRevision / FlowRevision / ContextSet 工件 | 把 sqlite 行当语义图权威 |
| 运行时查找 | Engine hydrate 后的投影 DTO | 渲染层自己扫 JSONL 拼图 |
| 图视图草稿 | Zustand 选中 / 视口 | Immer state 当图权威 |
| 图画布 | `@xyflow/react` + elkjs worker | 第一天自研 Canvas 2D |
| 嵌套 | React Flow Sub Flow + ELK compound layout | 自研 scene graph |
| 远景 LOD | 见下方三条判据 | 现在做 Excalidraw 级引擎 |
| 图数据库 | 不做 | Neo4j / ArangoDB |

升级判据（写进代码注释与本计划）：

```text
React Flow 节点保持 React 组件，直到同时满足：
  1. 单画布可见简单节点持续 > ~2000
  2. 交互帧时间（拖拽/缩放）P95 > 16ms
  3. 已用 elkjs worker + 视口裁剪 + 节点回收仍不够
才允许加 Canvas 远景层。远景只画矩形/边，拉近提升为 React 节点。
```

### 3.4 升级门槛（未过不得开工）

**Vite 8.1 / Rolldown**

- R2 已删除 Emotion，CSP 已无 nonce
- 桌面生产构建仍是单 IIFE + 外部 CSS；`codeSplitting: false` 在 Rolldown 上验证过
- `electron:smoke` 与 renderer typecheck 全绿
- 失败则停在 Vite 6.4.x，不把半截 Rolldown 配进 main

**TypeScript 7**

- 根配置 erasable 语法规则仍成立
- `@ravel/desktop` `typecheck` / `typecheck:renderer` 全过
- 不为过 TS7 而引入 `enum` / `namespace` / 参数属性

**Base UI 替换 Radix**

- 只换 `src/renderer/ui/*` 的底层 import，业务文件继续只吃 Ravel 包装
- 同一原语文件不得同时 import Radix 与 Base UI
- 键盘、焦点、Escape、ARIA、drawer inert 回归过后再删 Radix 包
- 不把 `ui/apps/v4` 当桌面运行时依赖

**`app://` 自定义协议**

- 独立安全切片，不阻塞 R2 / R3
- 必须保持 `sandbox` / `webSecurity` / 无 `nodeIntegration`
- 路径 containment 测试重写后再切

**Electron 44**

- 43.4.x 基线（隔离、utilityProcess、sqlite 可用性）保持
- 单独评 changelog，不和 Histos schema 绑在一次提交

**`node-pty`**

- 原生依赖评审 + shrinkwrap allowlist + 用户书面同意
- PTY 只活在独立 utilityProcess；renderer 只收输出 DTO

---

## 4. 目标架构

```text
┌──────────────────────────────────────────────────────────────────┐
│ Renderer（无 fs / Git / 凭据 / sqlite / node-pty / Pi SDK）         │
│  铬件: React 19 + Tailwind 4 tokens + 自持原语 + Zustand            │
│  时间线: operation-timeline.ts 纯投影 + TanStack Virtual            │
│  画布: React Flow 自定义节点（消费 GraphProjection DTO）             │
│  流: stream-live + rAF 批，不进 Zustand 热路径                       │
│  终端: xterm 只渲染 PTY DTO                                         │
└──────────────────────────▲───────────────────────────────────────┘
                           │ 受控 DTO / IPC allowlist（四方同步）
┌──────────────────────────┴───────────────────────────────────────┐
│ Main                                                              │
│  窗口、路径安全、Git review、checkpoint、search、MCP 配置           │
│  只转发：不打开 histos sqlite，不写 JSONL 事实                       │
└──────▲──────────────────▲──────────────────▲─────────────────────┘
       │ agent protocol   │ histos protocol  │ pty protocol（R5）
┌──────┴──────┐    ┌──────┴──────────┐    ┌──┴────────────┐
│ Agent       │    │ Histos Engine   │    │ PTY host      │
│ utilityProc │    │ utilityProcess  │    │ utilityProc   │
│ worker.mjs  │    │ 独占 sqlite     │    │ node-pty      │
│ Pi runtime  │    │ adapters        │    │ 输出 DTO      │
│ session-    │    │ chunker         │    └───────────────┘
│ facts.js    │    │ provenance      │
│ 唯一写者    │    │ distillation    │
└──────▲──────┘    │ rebuild         │
       │           └────────▲────────┘
       │                    │
 JSONL事实   Git工作区   skill/插件   durable artifacts   disposable sqlite
```

数据流硬规则：

1. 事实只追加。索引只引用 `FactAddress`。画布手势只产生视图草稿，或请求 Engine 追加一条索引 / 工件 / 新会话。
2. 改节点文案 = 开新会话或写新 skill 版本，不是 patch sqlite 当原文。
3. 删除 sqlite 后启动，必须能从 JSONL + 工作区 + durable artifacts 重建查找投影。结构边必须在；未落成工件的语义边允许空，不允许猜。
4. Histos Engine 失败进入诊断，**不得回滚**已追加的 JSONL 事实。
5. 语义 Graph 不能执行。要跑必须走 Convert to Flow → FlowSpec Draft → Validate → Approval → Pi。

---

## 5. 设计系统（琥珀工匠，唯一视觉权威）

token 只活在 CSS 自定义属性里。TypeScript 只读 `getComputedStyle` 或一份由 CSS 生成的类型，不再维护第二份色板。R2 删 MUI 后 `palettes.ts` 的兼容导出一起删。

### 5.1 Token 契约

保留 `--omega-*` 命名：

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

- 实体按钮 / Tab / Kbd：顶部微凸 `inset 0 1px 0`
- 状态胶囊 / 仪表：内凹 `--omega-inset-recessed`
- 面板：平整 hairline
- 动画只碰 `transform` 与 `opacity`
- 全局尊重 `prefers-reduced-motion: reduce`
- `motion` 仅用于 press 弹性（80–120ms）和画布节点出现

### 5.3 品牌表面

- Header ∞ 双环精密仪表（R1 已落地，R2 去 MUI 包装时不得改状态优先级）
- Context Donut：琥珀 / 橙 / 红
- Composer：悬浮毛玻璃岛
- ToolCard：Pending / Running / Done / Error + 耗时 + 结构化 diff

### 5.4 无头原语

已有：`Button` `IconButton` `Dialog` `Popover` `Menu` `Tooltip` `TextField` `Switch` `Tabs`。

R2 继续用这套迁业务。缺的交互（如 `Menu.Trigger` 语义）只加包装，不引入第二套设计系统。R2 结束时 renderer 不得再出现 `@mui` / `@emotion`。R2.5 才评估 Base UI。

### 5.5 构建安全

删 Emotion 后：

- CSP `style-src` 回到 `'self'`，去掉静态 nonce
- 删除 `STYLE_NONCE`、`emotion-cache.ts`、ThemeProvider 的 CacheProvider / `createTheme`
- Tailwind 4 必须产出外部 `dist/assets/index.css`

---

## 6. 性能不变量

1. **高频流不进 React 热路径。** streaming token、遥测 tick、elk 布局进度、画布平移，走 subscribe / rAF。现有 `stream-live.ts` 是样板。
2. **投影是纯函数，可丢可重建。** `operation-timeline.ts` / `activity-projection.ts` / 未来 `graph-projection.ts` 禁止副作用、禁止写 facts。
3. **长列表虚拟化。** MessageList、ActivityList、Search、Diff hunk 超过阈值必须 virtualize。
4. **拖拽改 CSS 变量，不改 React 树。** pointerup 才 persist。
5. **Engine 与索引增量异步。** sqlite、elk、切分、凝练不得阻塞 prompt 热路径；失败不回滚 JSONL。

预算（开发机抽测，不进 flaky CI 数字门）：

| 场景 | 目标 |
|---|---|
| 空闲工作台 | 主线程空闲，无 1s 间隔强制重渲染 |
| 打字机 80 tok/s | 聊天列以外的面板不因 token 重绘 |
| 200 条可见消息 | 滚动 60fps；DOM 不随历史线性涨 |
| 画布 500 React 节点 | 平移 / 缩放 P95 ≤ 16ms |
| 索引重建 10k JSONL 行 | 窗口不卡；进度可取消 |

---

## 7. Histos 数据契约（R3 开工前冻结）

真正需要在正式开工 R3 之前重新设计的是 schema，不是前端栈。

### 7.1 存储位置

事实仍在 Pi sessions 根（现有 JSONL）。Histos **不**和 JSONL 并排成 `<sessionId>.histos.sqlite`。

```text
<pi-sessions-root>/<sessionId>.jsonl
    事实权威（现有，仅追加）

<userData>/ravel/histos/<workspaceId>/index.sqlite
    可删查找索引（节点/边/span/证据的当前投影）

<userData>/ravel/histos/<workspaceId>/artifacts/<sha256>.json
    持久凝练工件：GraphRevision / FlowRevision / ContextSet
    内容寻址，SHA-256；不可原地 patch

工作区 Git 对象 / skill 文件
    文件与 skill 的 revisionId 来源；不把仓库当成 Histos 库
```

跨 session 边（已有 `session_reference`，以及新的 `context_attached`）写在 JSONL 里。sqlite 只是查找。删掉一边的查找库不影响事实。

### 7.2 FactAddress（替换薄 `fact_ref`）

凡是要被图、切分器、ContextSet、凝练证据引用的东西，都是带版本的地址，不是「当前内容」身份。

```ts
type FactSourceType =
  | "session_entry"
  | "session_span"
  | "operation"
  | "tool"
  | "approval"
  | "file"
  | "skill"
  | "mcp_config"
  | "checkpoint"
  | "graph_revision"
  | "flow_revision"
  | "context_set";

interface FactAddress {
  sourceType: FactSourceType;
  objectId: string;      // 冻结对象 id，如 sessionId+entryId、workspaceId+relPath、skill name+path
  revisionId: string;    // JSONL entry id / git SHA / skill content hash / artifact SHA
  selector?: FactSelector;
}

type FactSelector =
  | { kind: "span"; start: number; length: number }          // utf-8 byte offset
  | { kind: "hunk"; startLine: number; endLine: number }
  | { kind: "json_path"; path: string }
  | { kind: "node"; nodeRevisionId: string }
  | { kind: "edge"; edgeRevisionId: string };
```

规范化显示（日志 / IPC 调试用，存储用结构化列，不靠解析字符串当权威）：

```text
entry:      session:{id}/entry:{entryId}@{revision}
span:       session:{id}/entry:{entryId}@{revision}#{start}:{length}
operation:  session:{id}/op:{operationId}@{revision}
tool:       session:{id}/tool:{toolCallId}@{revision}
approval:   session:{id}/approval:{askedId}@{revision}
file:       ws:{workspaceId}/{repoRelative}@{gitSha}
skill:      skill:{name}+{path}@{sha256}
checkpoint: git:{workspaceId}@{commitSha}
artifact:   histos:{workspaceId}/{graph|flow|context}@{sha256}
```

文件和 skill 是**带不可变 revision 的制品**。覆盖 skill = 新 hash = 新 `revisionId`，旧地址仍可解析（文件可能已被 archive）。

### 7.3 最小 schema（查找库，可删）

```sql
addresses (
  address_id TEXT PRIMARY KEY,          -- 规范化后的稳定 id（hash of canonical FactAddress）
  source_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  selector_json TEXT                    -- 无 selector 则为 NULL
);

node_revisions (
  node_revision_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,                -- 逻辑节点，跨版本稳定
  kind TEXT NOT NULL,                   -- entry | span | file | skill | operation | tool | approval | cluster
  title TEXT,
  created_at INTEGER NOT NULL,
  artifact_sha TEXT                     -- 若此修订来自持久 GraphRevision
);

edge_revisions (
  edge_revision_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  src_node_id TEXT NOT NULL,
  dst_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- references | contains | produced | approved | derived_from | session_ref | context
  created_at INTEGER NOT NULL,
  artifact_sha TEXT
);

revision_parents (
  child_id TEXT NOT NULL,               -- node_revision_id 或 edge_revision_id
  parent_id TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id)
);

evidence (
  revision_id TEXT NOT NULL,            -- node 或 edge revision
  address_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- supports | quotes | produces | navigates
  PRIMARY KEY (revision_id, address_id, role)
);

spans (
  span_id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL,             -- 指向 session_span FactAddress
  entry_object_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  length INTEGER NOT NULL
);

artifacts (
  sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- graph_revision | flow_revision | context_set
  created_at INTEGER NOT NULL,
  source_set_json TEXT NOT NULL,
  lens TEXT NOT NULL,
  granularity TEXT NOT NULL
);

meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                   -- schema_version, last_rebuild_at, workspace_id
);
```

没有线性 `superseded_by`。新修订通过 `revision_parents` 指向旧修订。合并、分支、凝练重跑都是 DAG。

没有「节点存一条 fact_ref」。每个 node/edge revision 通过 `evidence` 指向 1..N 个 `FactAddress`。

### 7.4 持久工件 vs 可删索引

| 种类 | 存哪 | 可否删 | 何时必须落盘 |
|---|---|---|---|
| 结构边投影（operation↔tool、ask↔decide、session_reference、file edit） | sqlite | 可删，必须能从 JSONL 重建 | 每次 rebuild / 增量 apply |
| 语义边 / 摘要节点（LLM 凝练） | sqlite 查找副本 + **工件** | sqlite 可删；工件在「被用过」后不可默删 | 见下方触发 |
| GraphRevision | `artifacts/<sha>.json` | 用户显式永久删除才走墓碑 | 查看保存、开会话、生成 skill、转 Flow |
| FlowRevision / FlowSpec | 同上 | 同上 | Validate 通过并提交审批之前必须有 sha |
| ContextSet | 同上 | 同上 | 框选开会话 / 编辑 / 生成 skill 之前冻结 |

「被用过」的定义（必须落成工件，不能只活在 sqlite）：

- 用户保存或钉住该图
- 用该选择开启会话
- 用该选择生成或修改 skill
- Convert to Flow 并进入 Validate / Approval
- 该修订被后续 GraphRevision 当作 parent

未查看、未保存、纯探索的 LLM 草稿可以只在内存 / sqlite，进程退出后允许消失。

工件格式（JSON，UTF-8，SHA-256 of canonical bytes）：

```text
GraphRevision {
  schemaVersion
  workspaceId
  sourceSet          -- 会话、路径、skill、先前 artifact sha 的集合
  lens               -- structural | semantic | mixed
  granularity        -- operation | entry | span | file | cluster
  nodes[] / edges[]  -- 逻辑 id + 当前 revision 内容
  evidence[]         -- 指向 FactAddress
  parents[]          -- parent GraphRevision sha
}
```

### 7.5 SourceSet + Lens + Granularity（没有万能图）

每次查询、每次凝练、每次画布打开都必须带这三项。Engine 不提供「给我整个 workspace 的图」。

```text
SourceSet     哪些事实：会话集合 / 路径 glob / skill 名 / 既有 artifact sha
Lens          怎么看：structural（确定性）| semantic（LLM）| mixed
Granularity   多细：operation | entry | span | file | cluster
```

语义 LOD：拉远看 cluster，拉近看 entry/span。嵌套图是 Sub Flow，不是另一套引擎。

### 7.6 ContextSet（比 `session_reference` 更强的开会话契约）

框选节点 / 边并「就这些开会话 / 编辑 / 生成 skill」时：

1. Engine 把当前 SourceSet + Lens + Granularity + 选中地址冻结成 ContextSet 工件
2. 新会话 JSONL 追加 `context_attached`（经 `session-facts.js`）
3. `session_reference` 仍只服务 `@session` 提及，不替代 ContextSet

`context_attached` 载荷最小集：`id`、`lane`、`targetSessionId`、`contextSha`、`timestamp`。缺 sha 的开会话在 R3 验收里算失败。

选择不是 UI-only。刷新后视口草稿可以丢，ContextSet 工件不能丢。

### 7.7 Graph 与 Flow

- 一套 Graph Core。Flow 是带执行约束的 Graph，不是第二个引擎。
- 语义图节点没有「Run」。
- 路径：Convert to Flow → FlowSpec Draft → Validate → Approval（fail-closed）→ Pi 执行 → 新 facts → 新 GraphRevision。
- FlowSpec 也是内容寻址工件。Validate 失败不得进入审批放行。

### 7.8 Skill 与删除

Skill 编辑：

```text
Draft（铬件 / CodeMirror）
  → Diff（对当前 hashed 版本）
  → Apply（写文件，新 content hash）
  → 新 skill FactAddress
  → 新 GraphRevision（parent = 旧图）
```

覆盖即新版本，旧 hash 仍可被 evidence 引用。

删除：

- 普通删除 = archive（查找库不再作为 live，工件与 facts 仍在）
- 永久删除 = 断 provenance，必须写 tombstone；指向它的 evidence 保持地址，解析结果为 missing，不得悄悄改写成别的文件

### 7.9 写入规则

- 结构边由确定性投影器从 facts 生成，不经 LLM。
- 语义边必须带至少一条 evidence。
- 任何查找库写入都是 INSERT 新 revision；禁止 UPDATE 原文列。
- 切分器只写 `spans` / span selector，不改 JSONL。
- Engine 可以读 JSONL / Git / skill 文件；**不能**调用 `appendCustomEntry`。新事实必须回到 `session-facts.js`。
- 需要新事实类型（`context_attached` 等）时：先改 `packages/agent` codec/reducer，再改 `session-facts.js`，再改 Engine 适配器。

### 7.10 重建

启动、schema 不匹配、或用户触发 rebuild：

1. 扫该 workspace 相关 JSONL facts → 重建结构 node/edge revisions + evidence
2. 按现行策略重切 spans
3. 读 `artifacts/*.json`，把被用过的 Graph/Flow/Context 填回查找库
4. 无法从 facts 或工件证明的语义边丢弃（允许空，不允许猜）
5. 进度可取消；取消不破坏 JSONL，不留下半套 schema_version

---

## 8. 分阶段实施

原则：每一阶段单独可合并、可回滚、有测试。后一阶段不依赖「把前一阶段做完美」。**不得把 R2 / R3 / Vite8 / Base UI / 画布混成一次不可回滚的提交。**

### R0 — 性能与契约（已完成）

虚拟化、stream-live、token 单源、skill hash、checkpoint facts。见 §2.1。

### R1 — 设计地基（已完成）

React 19 / Compiler / Vite 6 / Tailwind 4、原语、∞ 图腾、CSS 变量拖拽。见 §2.1。MUI / Emotion / nonce 已删除。

### R2 — 绞杀 MUI（已完成，Histos 可视层开工许可证）

迁移顺序（按耦合从低到高）：

1. Tooltip / IconButton / Menu / Dialog（ResourceCenter、Trust、Settings **已做**）
2. LeftNav / RightPanel Tabs **已做**
3. Composer / ApprovalBar / Header **已做**
4. MessageBubble / ToolCard / ThinkingBlock **已做**
5. DiffViewer / FileTree / 其余面板 **已做**
6. 删除 `@mui/*` `@emotion/*`、ThemeProvider 的 MUI 路径、`STYLE_NONCE`；CSP 去 nonce；安全测试改断言 **已做**

每迁一个目录：该文件禁止新 `sx=` 和 `@mui` import。CI grep 卡口已启用。

本阶段**不**引入 Vite 8、TS 7、Base UI、sqlite、React Flow。

验收：

- renderer `package.json` 无 MUI / emotion
- CSP `style-src 'self'`（无 nonce）
- i18n、快捷键、审批 fail-closed、IPC 四方同步、drawer inert 全绿
- 微凸触感在 Button / Tab / Kbd 上可指出

### R2.5 — 可选：原语底层迁 Base UI（不阻塞 R3）

只改 `src/renderer/ui/*`。业务文件 API 不变。与 Vite 8 无关。不过门槛不准做。

### R3 — Histos Engine（画布的硬前置）

这是核心，不是 UI。按 §7 实施，**禁止**回到 per-session sqlite / 薄 `fact_ref` / Main 持有句柄。

做：

- `electron/histos-engine.js`（utilityProcess 入口）+ `histos-host.js`（Main 只转发）
- `electron/histos-chunker.js`、`histos-adapters.js`、`histos-provenance.js`
- schema §7.3；FactAddress 规范化与拒绝非法地址
- Worker 在 `session-facts` 追加成功后发「事实已落」；Engine 增量 apply（失败不回滚事实）
- 结构边投影；spans；artifact 读写
- 新事实 `context_attached`（codec + session-facts + 测试）
- IPC（四方同步）：`omega:histosGetGraph`、`omega:histosRebuild`、`omega:histosGetNode`、`omega:histosFreezeContext`、`omega:histosGetArtifact`
- 测试：合成 JSONL → 重建等价；删 sqlite 保留 artifacts 后结构边 + 被用过的语义图仍在；非法 FactAddress 拒绝

验收：

- 删除 `index.sqlite` 重启，动态视图和时间线不受损
- 未落工件的探索性语义边允许消失；已 freeze 的 ContextSet / 已保存 GraphRevision 必须还在
- renderer 拿不到 sqlite 句柄、原始 SQL、绝对路径
- 不实现 LLM 凝练 UI；语义边表可空
- 不改 JSONL 除经过 codec 的新 record 类型以外的 schema

不做：画布 UI、Convert to Flow 执行、PTY。

### R4 — Histos 可视层（React Flow）

前置：R2 完成（节点能用新原语），R3 完成（有可查询投影）。

做：

- 右栏或独立模式加「图谱」表面；默认仍是 Diff
- 自定义节点：operation、entry span、file、skill、approval、cluster
- 节点内容是铬件组件，不是 Canvas 文本
- elkjs 在 worker 算布局；嵌套用 Sub Flow + compound layout
- 框选 → `histosFreezeContext` → 新会话带 `context_attached`
- 视口 / 选中进 Zustand 视图草稿；落盘只追加索引、工件或新会话
- 节点跳回 transcript 的 `entryId` / `toolCallId`

验收：

- 空间可追溯、时间可追溯
- 改图不能改 JSONL
- 刷新后手势草稿丢失是预期；ContextSet / 结构边还在
- 500 节点平移达标；未达 §3.3 判据不得引入 Canvas 引擎
- 语义节点没有 Run 按钮；只有 Convert to Flow 入口（R4 可先做入口禁用，R4.5 再接通）

### R4.5 — Flow 约束（可与 R5 并行，不得早于 R3）

Convert to Flow → FlowSpec Draft 工件 → Validate → 既有审批 facts → Pi 执行。语义图执行路径必须 404。

### R5 — 编码工作台收口（与画布解耦，可和 R3 并行）

- 嵌入式终端：`node-pty` 走 §3.4 评审；PTY utilityProcess；renderer 只用 `@xterm/xterm`
- CodeMirror 6 用于节点内只读 / 小段编辑；整文件面板仍用 FileViewer
- PR / gh 面板继续不做，除非另开任务

MCP 网络传输、computer use 仍不在本计划。

### R6 — 可选 facade（不阻塞 Histos）

`packages/ravel-runtime` 把桌面从直接依赖 `@earendil-works/pi-coding-agent` 改为稳定 API。有真实分叉需求再做。

Vite 8 / TS7 / `app://` / Electron 44 作为独立工程切片插入 R2 之后、任何方便的间隙，但每项单独过门槛，不并进 R3 schema 提交。

---

## 9. 包与文件落点

新建（按阶段出现）：

```text
apps/ravel-desktop/src/renderer/ui/                 R1 已有
apps/ravel-desktop/src/renderer/lib/graph-projection.ts    R3/R4
apps/ravel-desktop/src/renderer/components/histos/         R4
apps/ravel-desktop/electron/histos-host.js                 R3 Main 转发
apps/ravel-desktop/electron/histos-engine.js               R3 utilityProcess
apps/ravel-desktop/electron/histos-chunker.js              R3
apps/ravel-desktop/electron/histos-adapters.js             R3
apps/ravel-desktop/electron/histos-provenance.js           R3
apps/ravel-desktop/test/histos-index.test.mjs              R3
apps/ravel-desktop/test/histos-r2.test.mjs                 R2
```

保持单写者：

```text
apps/ravel-desktop/electron/session-facts.js
packages/agent/src/harness/session/types.ts   只加经过 codec/reducer 的新 record
```

R2 末已删除：

```text
@mui/material  @mui/icons-material  @emotion/react  @emotion/styled  @emotion/cache
src/renderer/theme/emotion-cache.ts
ThemeProvider 内 MUI createTheme 路径
STYLE_NONCE
```

IPC 新通道（R3，四方同步：`ipc-registry` / `ipc-contracts` / `preload` / renderer client）：

```text
omega:histosGetGraph
omega:histosRebuild
omega:histosGetNode
omega:histosFreezeContext
omega:histosGetArtifact
```

不把 sqlite 句柄、原始 SQL、文件绝对路径传给 renderer。

---

## 10. 依赖与安全

| 依赖 | 阶段 | 约束 |
|---|---|---|
| `react` / `react-dom` 19.2.x | R1 已 pin | 与 `@types/react` 同步 |
| `@vitejs/plugin-react` + `babel-plugin-react-compiler` | R1 已接 | 不启用 Vite 开发服务器 |
| `tailwindcss` 4.3.x | R1 已 pin | 外部 CSS；lockfile 仅用户明确要提交时才提交 |
| Radix 四件套 | R1 已 pin | R2.5 前不删 |
| Base UI | R2.5 可选 | 精确 pin；无 lifecycle 脚本则不必改 shrinkwrap allowlist |
| `@tanstack/react-virtual` 3.13.12 | R0 已 pin | 不要默默改 latest |
| `node:sqlite` | R3 | Node / Electron 内置，**不新增** npm 原生模块 |
| `@xyflow/react` | R4 | 精确 pin |
| `elkjs` | R4 | 布局进 worker |
| `codemirror` 及语言包 | R4 / R5 | 不要 `monaco-editor` |
| `@xterm/xterm` | R5 | renderer 可引；`node-pty` 不可进 renderer |
| `node-pty` | R5 | **必须**依赖评审 + shrinkwrap allowlist；用户书面同意才加 |
| `motion` | 可选 | 体积进 release gate |
| Vite 8 / Rolldown | 门槛后 | 见 §3.4 |
| TypeScript 7 | 门槛后 | 见 §3.4 |

`undici` 若被间接升版，按 AGENTS.md 先读 changelog。

Renderer 继续零原生依赖。electron-builder 不为铬件 rebuild。Histos Engine / PTY 的原生能力停在各自 utilityProcess。

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

| 阶段 | 测试 |
|---|---|
| R0 | 已有：虚拟化、stream-live、skill hash、checkpoint 配对 |
| R1 | 已有：IIFE / Compiler / Tailwind 4 / CSP nonce / 原语 / Donut / resize |
| R2 | `histos-r2.test.mjs`：迁出目录无 `@mui/`；全部完成后 grep 门禁 + CSP 无 nonce |
| R3 | JSONL → sqlite 重建等价；非法 FactAddress 拒绝；删库保留 artifacts 后被用过的图仍在；`context_attached` codec |
| R4 | graph-projection 纯函数；跳回 entryId；改图不写 JSONL；无 Run on semantic node |
| R4.5 | FlowSpec Validate 失败不得审批放行 |
| R5 | PTY 输出 DTO；renderer 无 `node-pty` import |

---

## 12. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 把旧 per-session schema 先写进代码 | 本文 §2.4 / §7 冻结；R3 审查对照表 |
| 语义图被当成可执行 Flow | Convert to Flow 闸门；语义节点无 Run |
| 探索性 LLM 图丢了用户已用过的选择 | 「被用过」必须落 artifact；ContextSet 先于新会话 |
| sqlite 当权威 | 删库测试：时间线仍在，被用过的工件仍在 |
| Windows 文件锁 | Engine 单进程单连接串行队列；Main / Agent 不打开该文件 |
| Vite 8 / Rolldown 破坏 IIFE | 独立切片；失败停在 Vite 6 |
| Radix / Base UI 双轨 | 同一原语文件禁止双 import |
| React Flow 包体 | release gate 盯 asar；节点懒挂载 |
| 过早自研 Canvas | §3.3 三条判据全满足才开口子 |
| Engine 写 facts | 静态断言：仅 `session-facts.js` 调用 `appendCustomEntry` |

回滚：每阶段独立 commit。R3 sqlite 可删——产品退回「无图、有时间线、有 artifacts 则能重建被用过的图」。R2 若中途卡住，允许 MUI 残留在未迁文件，但禁止新文件引入 MUI。

---

## 13. 建议执行顺序（摘要）

```text
R0   已完成  虚拟化 + 流绕过 + token 单源 + hash/checkpoint 接 facts
R1   已完成  React19/Compiler/Vite6/Tailwind4 + 原语 + ∞ 图腾
R2   当前    绞杀 MUI/emotion，CSP 去掉 nonce
R2.5 可选    Base UI 换 Radix 底层（不阻塞 R3）
R3          Histos Engine + FactAddress + Evidence + Revision DAG
            + 工作区 sqlite + durable artifacts + ContextSet
R4          React Flow（节点=铬件，布局=elk worker，嵌套=Sub Flow）
R4.5        Convert to Flow / FlowSpec / Validate / Approval
R5          PTY（评审后）+ xterm + CodeMirror 小段编辑
R6          runtime facade（可选）
间隙        Vite 8 / TS7 / app:// / Electron 44（各过门槛，不并进 R3）
```

R4 不得早于 R2+R3。Canvas 引擎不进路线图，只进升级判据。前端栈路线已锁定；R3 开工前冻结的是 §7，不是再换一套 UI 库。

---

## 14. 成功标准（计划完成时）

1. 铬件是琥珀工匠：微凸、hairline、∞ 图腾、克制发光；不再能看出 Material。
2. 长会话、流式输出、面板拖拽在目标预算内。
3. 任意 Histos 节点 / 边能指回 `FactAddress`；删查找库产品仍可用；被用过的 GraphRevision / ContextSet 仍在。
4. 语义图不能直接执行；Flow 必须经过 Validate + 审批。
5. 审批、隔离、IPC allowlist、JSONL 单写者与重构前同等或更严。
6. 后续加凝练 agent / 嵌套图 / 远景 Canvas / 终端时，不必再换事实模型。
