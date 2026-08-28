# Ravel × Histos 生产目标与实施计划

更新日期：2026-08-28
状态：**R0–R5 / H0 / T1–T5 已完成档案。** 锁定栈与 §7 数据契约仍有效。剩余产品切片不再以本文为执行入口，改认 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)。
前置：[`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md)

本文保留铬件、Histos 三层、进程边界与 R0–R5 验收。核心不变量仍以核心设计为准。不要把下一刀写回本文。

没有备选方案。失败时修目标栈，不退回旧 major、不并行第二套库。

---

## 0. 一句话

底座（JSONL 事实、Electron 隔离、Pi 运行时）已经是正确地基。要换的是铬件表皮、派生查找层，以及把被用过的语义图收成可寻址工件。不换壳、不换执行权威、不把图画成数据库、不把画布当真相。

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

图是万能投影，不是万能存储。没有 Neo4j / ArangoDB / 第二套 agent runtime。

---

## 1. 产品与架构不变量（冻结）

| 不变量 | 含义 | 违反即失败 |
|---|---|---|
| 三层权威 | 事实层 = JSONL + Git 工作区 + skill/插件文件；凝练层 = 可重建查找索引 + 内容寻址工件；可视层 = 投影 | 画布 / 摘要 / sqlite 反写 JSONL 或文件原文 |
| 对象 id 冻结 | `sessionId+entryId`、`operationId`、`toolCallId`、审批成对 id、`workspaceId+相对路径`、skill `name+path+content hash` | Graph 节点 id 回写这些 id |
| 切分只切索引 | 长内容 span 是派生 selector；entry 本身不碎 | compaction 把一条 entry 变成不可寻址碎片 |
| 单一事实写者 | `electron/session-facts.js` 是唯一 LaneRecord 写入点 | Main / Renderer / Histos Engine 各自拼 JSONL |
| 审批 fail-closed | 先 `approval_asked`，再 UI，再 `approval_decided`；append 失败不得放行 | UI confirm 直接当权限 |
| Electron 隔离 | contextIsolation + sandbox + CSP（无 `unsafe-inline` / `eval`）+ IPC allowlist + 路径 containment | renderer 碰 fs / Git / 凭据 / Pi SDK / sqlite |
| 进程模型 | Main 管窗口与桥；Agent、Histos Engine、PTY 分属 utilityProcess；preload 窄桥 | Tauri / Next sidecar / 本地 HTTP agent / renderer 直连 sqlite / Histos 退回 Main 或 worker_threads |
| 执行权威 | Pi `AgentSessionRuntime`；AgentHarness 只提供 record/reducer 语义 | 把 Harness 未实现的 runtime 当桌面执行器；语义图直接执行 |
| 内核路线 | 一切可寻址事实 + 派生索引；不是 Cordis 插件内核 | 服务定位器 / 事件总线内核 / 图数据库 |

明确不做：

- 换壳、换 JSONL、换 Pi 运行时
- 自研 Canvas 2D / 自研弹簧 / 自研图布局（Canvas 远景层只在 §6 三条实测判据同时满足后才加）
- Monaco 作为节点内编辑器
- Cordis、Plan/Todo 假面板、第二套 turn schema、第二套审批库
- 跨项目记忆、云沙箱、computer use、MCP 网络传输
- Neo4j / ArangoDB / 通用图数据库 / 独立向量库
- 语义 Graph 直接当 Flow 跑
- 把 sqlite 当 GraphRevision 权威
- Radix 与 Base UI 长期双轨
- Vite 6 / TypeScript 5 作为长期基线
- `better-sqlite3` 或其他 sqlite native addon

---

## 2. 当前进度（2026-08-28）

分支：`main`（HEAD `9b98e529b`，已推送 origin）。feat 分支已全部快进并入 main 并删除；main 即完全体。

### 2.1 已落地、必须保留

切片 0 / 1 / S2–S4：

- Scout / Workflow 删除，右栏默认 Diff，另有 Worktree / Graph / Terminal
- operation 成对事实、审批成对落盘、时间线纯投影、事件身份、compaction 不毁日志
- S2 动态视图（零新事实）、S3 `session_reference`、S4 MCP stdio 桥
- checkpoint / 全局搜索 / 遥测面板
- 工作台：三栏 grid、键盘可调宽、compact drawer + inert、Focus Mode
- 安全：IPC 四方同步、path-security、Project Trust、safeStorage vault

Histos R0–R5：

| 切片 | 状态 | 要点 |
|---|---|---|
| R0 | 完成 | TanStack Virtual、`stream-live.ts` rAF 批、skill SHA-256、checkpoint facts |
| R1 | 完成 | React 19.2.8 + Compiler、Tailwind 4.3.3、`--omega-*`、自持原语、∞ 图腾、CSS 变量拖拽 |
| R2 | 完成 | 绞杀 MUI / Emotion / nonce；CSP `style-src 'self' app:` |
| R3 | 完成 | Histos Engine utilityProcess、工作区 `index.sqlite`、FactAddress、Evidence M:N、`revision_parents` DAG、durable artifacts、ContextSet / `context_attached` |
| R4 | 完成 | `GraphCanvas.tsx`、六类节点、elkjs worker、框选 freeze、节点跳回 transcript；语义图无 Run |
| R4.5 | 完成 | Convert to Flow → FlowSpec Draft → Validate；不过闸不放行、不写工件；Pi 执行不在本路 |
| R5 | 完成 | `node-pty@1.1.0` 仅 PTY utilityProcess；renderer `@xterm/xterm`；CodeMirror 6 仅 `SnippetEditor`；`asarUnpack: node_modules/node-pty/**` |
| `app://` | 完成 | 打包加载协议；不是剩余 Histos 前置 |

R5 打包门禁：`RAVEL_PTY_SMOKE=1 electron:smoke` 必须观察到真实 child exit code 0，以及 spawn / write / resize / kill。不得把 `taskkill /f /t` 当成功。autotest 路径用 `process.reallyExit(0)` 结束进程组，不 await `shutdown()` / `app.exit()`。该 hang-fix 已提交（`6ddb87bd1`，`1e89737ee` 延续）。

H0 与 T* 落地提交：T1 Base UI `bf455eb7a`；T2 Vite 8.2.2 + Rolldown `b538026ae`；T3 TypeScript 7.0.2 `7b99944cd`；T4 Zustand 5.0.8 `36cfd7b66`；T5 Electron 44.0.0 `7a964b1c2`。

### 2.2 已装栈 vs 锁定栈

以 `apps/ravel-desktop/package.json` 为准。T1–T5 提交后，锁定栈已全部装上；表中「迁移前基线」仅作历史对照，不是可接受的长期形态。

| 层 | 当前已装 | 迁移前基线（历史） | 备注 |
|---|---|---|---|
| 壳 | Electron 44.0.0 | Electron 43.4.1（Chromium 150 + Node 24） | T5 `7a964b1c2`；node-pty 按 44 ABI 重建 |
| 加载 | `app://bundle` | `app://bundle` | 已完成 |
| 构建 | Vite 8.2.2 + Rolldown，`format: 'iife'`，`codeSplitting: false` | Vite 6.4.3 IIFE，`inlineDynamicImports: true` | T2 `b538026ae` |
| React 插件 | `@vitejs/plugin-react` 6.1.0 + Compiler 1.0.0 | plugin-react 4.7.0 | 随 T2 |
| 语言 | TypeScript 7.0.2（根与桌面统一） | 桌面 TS 5.6.3；仓库根 TS 5.9.3 | T3 `7b99944cd`；erasable 语法不变 |
| Lint | Biome 2 | Biome 2 | 不换 ESLint |
| 包管理 | npm workspaces，精确 pin | 同左 | 不迁 pnpm；`npm install --ignore-scripts` |
| UI | React 19.2.8 + Compiler | 同左 | 已对齐 |
| CSS | Tailwind 4.3.3 + `--omega-*` | 同左 | 已对齐；不降到 4.1 |
| 原语 | `@base-ui/react` 1.7.0 + `src/renderer/ui/*` 包装 | Radix 四件套 | T1 `bf455eb7a`；Radix 已删除，无双轨 |
| 动效 | CSS `transform` / `opacity` | 同左 | 不装 Motion |
| 状态 | Zustand 5.0.8 铬件 | Zustand 4.5.5 | T4 `36cfd7b66` |
| 列表 | TanStack Virtual 3.13.12 | 同左 | 已对齐 |
| Markdown | react-markdown + remark-gfm + rehype-highlight + highlight.js | 同左 | 不换 Shiki |
| 节点编辑 | CodeMirror 6 | CodeMirror 6 | 不用 Monaco |
| 图 UI | `@xyflow/react` 12.11.5 + elkjs 0.12.0 worker | 同左 | 交互式嵌套 Sub Flow UI 未做 |
| 终端 | `@xterm/xterm` 5.5.0 + 隔离 `node-pty` 1.1.0 | 同左 | 已对齐 |
| 图标 | `lucide-react` 1.34.0 | 手绘字形 | P1 `65fcf42b0` |
| E2E | `@playwright/test` 1.62.1（`e2e/`，`p7:e2e`） | 无 | P7 `9d3c867ba` |
| 索引 | `node:sqlite`，Engine 独占 | 同左 | 不改 worker_threads |
| Agent | Pi `AgentSessionRuntime` utilityProcess | 同左 | 不第二套 runtime |

`apps/ravel-desktop/docs/system_design.md` 的 V1 表（React 18 / MUI 5 / Vite 5）是历史记录，不以它为准。

---

## 3. 锁定技术栈

禁止混层。每一项升级单独 disposable worktree、单独提交、单独过门禁。禁止一次 PR 同时改 Electron + Vite + TypeScript + 原语底层。

### 3.1 壳与工程

当前安装版本（T1–T5 提交后）：

```text
Electron 44.0.0          壳（迁移前基线为 43.4.1，Chromium 150 + Node 24）
Vite 8.2.2 + Rolldown    renderer 唯一构建器
@vitejs/plugin-react 6   配 React Compiler
TypeScript 7.0.2         仓库与桌面统一
Biome 2                  lint / format
npm workspaces           exact pin；不迁 pnpm
```

构建硬约束（Vite 8 已满足）：

```text
base: "./"
单一 classic IIFE
codeSplitting: false
modulePreload: false
外部 CSS（Tailwind 产出 dist/assets/index.css）
无 Vite HMR dev server
script-src 'self'；无 unsafe-inline / eval
style-src 'self' app:
```

Rolldown 已把 `inlineDynamicImports` 标为 deprecated。升级时改 `codeSplitting: false`，不保留旧键作为兼容层。

TypeScript 7 就是原来的 native `tsc`。不为过 TS 7 引入 `enum` / `namespace` / 参数属性。若某个工具仍要旧 programmatic compiler API，那个工具单独留 compatibility package，仓库主体仍是 TS 7。

### 3.2 铬件

```text
React 19.2.x + React Compiler 1.x
Tailwind 4 + CSS custom properties（--omega-* 唯一 token）
@base-ui/react → src/renderer/ui/* 包装 → 业务只 import 包装
Zustand 5：chrome / session / viewport / 选中 id
TanStack Virtual：Message / Activity / Search / Diff
react-markdown + remark-gfm + rehype-highlight + highlight.js/core
CodeMirror 6：节点内只读 / 小段编辑
@xterm/xterm：只渲染 PTY DTO
Lucide：图标
Inter + JetBrains Mono + CJK fallback（PingFang SC / Microsoft YaHei / Noto Sans CJK）
```

业务文件永远不直接 import Base UI。同一原语文件不得同时 import Radix 与 Base UI。Radix 包在绞杀完成后删除，不留 gap fallback。

Compiler 不能替代 streaming 数据流。80 tok/s 仍走 `stream-live.ts` 的外部订阅 / rAF 批，不进 Zustand 热路径。

### 3.3 Histos 与画布

```text
查找索引     工作区 <userData>/ravel/histos/<workspaceId>/index.sqlite
             Engine utilityProcess 独占 node:sqlite
持久凝练     artifacts/<sha256>.json
             GraphRevision / FlowRevision / ContextSet / ViewState
图画布       @xyflow/react；节点是 React 铬件
布局         elkjs Web Worker
嵌套         React Flow Sub Flow + ELK compound layout
远景 LOD     仅 §6 三条实测判据全满足后才加 Canvas 2D 矩形/边
```

Engine 已经是 utilityProcess。不退回 Main 同步 sqlite，不改 worker_threads。

### 3.4 进程

```text
Renderer（零原生）
    → Main（窗口 / 信任 / Git / IPC 路由；不打开 histos sqlite，不写 JSONL）
        → Agent utilityProcess     Pi 执行权威；session-facts.js 唯一写者
        → Histos Engine            node:sqlite + chunker + adapters + provenance + 凝练编排
        → PTY Host                 node-pty；输出有界 DTO
```

---

## 4. 目标架构

```text
┌──────────────────────────────────────────────────────────────────┐
│ Renderer（无 fs / Git / 凭据 / sqlite / node-pty / Pi SDK）         │
│  铬件: React 19 + Tailwind 4 tokens + Base UI 包装 + Zustand 5     │
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
       │ agent protocol   │ histos protocol  │ pty protocol
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
3. 删除 sqlite 后启动，必须能从 JSONL + Git + skill 文件 + durable artifacts 重建查找投影。形式化见 §7.10。
4. Histos Engine 失败进入诊断，**不得回滚**已追加的 JSONL 事实。
5. 语义 Graph 不能执行。要跑必须走 Convert to Flow → FlowSpec Draft → Validate → Approval → Pi。

---

## 5. 设计系统（琥珀工匠，唯一视觉权威）

token 只活在 CSS 自定义属性里。TypeScript 只读 `getComputedStyle` 或一份由 CSS 生成的类型，不再维护第二份色板。

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

### 5.2 触感与动效

- 实体按钮 / Tab / Kbd：顶部微凸 `inset 0 1px 0`
- 状态胶囊 / 仪表：内凹 `--omega-inset-recessed`
- 面板：平整 hairline
- 动画只碰 `transform` 与 `opacity`
- 全局尊重 `prefers-reduced-motion: reduce`
- 弹簧微交互需要时再加 `motion`（80–120ms），第一阶段不装

### 5.3 品牌表面

- Header ∞ 双环精密仪表（状态优先级不得改）
- Context Donut：琥珀 / 橙 / 红
- Composer：悬浮毛玻璃岛
- ToolCard：Pending / Running / Done / Error + 耗时 + 结构化 diff

### 5.4 无头原语

已有包装：`Button` `IconButton` `Dialog` `Popover` `Menu` `Tooltip` `TextField` `Switch` `Tabs`。

底层已从 Radix 换为 `@base-ui/react`（T1 `bf455eb7a`），只动 `src/renderer/ui/*`，业务 API 不变，`@radix-ui/*` 已删除。缺的交互只加包装，不引入第二套设计系统。

### 5.5 字体

西文：Inter + JetBrains Mono。

中文（产品场景含小说/文档）：CJK fallback 已落地（P1 `65fcf42b0`），全部 sans/mono 声明走 `--omega-font-sans` / `--omega-font-mono`，系统栈

```text
"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif
```

等宽中文与 JetBrains Mono 对齐用 `font-feature-settings` / 独立 CJK mono fallback，不把中文塞进 Inter。

---

## 6. 性能不变量

1. **高频流不进 React 热路径。** streaming token、遥测 tick、elk 布局进度、画布平移，走 subscribe / rAF。现有 `stream-live.ts` 是样板。
2. **投影是纯函数，可丢可重建。** `operation-timeline.ts` / `activity-projection.ts` / `graph-projection.ts` 禁止副作用、禁止写 facts。
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

Canvas 远景层升级判据（写进代码注释；三条同时满足才开口子）：

```text
1. 单画布可见简单节点持续 > ~2000
2. 交互帧时间（拖拽/缩放）P95 > 16ms
3. 已用 elkjs worker + 视口裁剪 + 节点回收仍不够
```

远景只画矩形/边，拉近提升为 React 节点。未达判据不得引入 scene graph。

---

## 7. Histos 数据契约（已冻结，继续执行）

R3 已按本节落地。后续凝练 / 嵌套 / Flow→Pi 不得回到 per-session sqlite、薄 `fact_ref`、Main 持有句柄。

### 7.1 存储位置

```text
<pi-sessions-root>/<sessionId>.jsonl
    事实权威（现有，仅追加）

<userData>/ravel/histos/<workspaceId>/index.sqlite
    可删查找索引（节点/边/span/证据的当前投影）

<userData>/ravel/histos/<workspaceId>/artifacts/<sha256>.json
    持久凝练工件：GraphRevision / FlowRevision / ContextSet / ViewState
    内容寻址，SHA-256 of canonical bytes；不可原地 patch

工作区 Git 对象 / skill 文件
    文件与 skill 的 revisionId 来源；不把仓库当成 Histos 库
```

跨 session 边（已有 `session_reference`、`context_attached`）写在 JSONL 里。sqlite 只是查找。删掉一边的查找库不影响事实。

### 7.2 FactAddress

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
  objectId: string;      // 冻结对象 id
  revisionId: string;    // 见下方锚定规则
  selector?: FactSelector;
}

type FactSelector =
  | { kind: "span"; start: number; length: number }          // utf-8 byte offset
  | { kind: "hunk"; startLine: number; endLine: number }
  | { kind: "json_path"; path: string }
  | { kind: "node"; nodeRevisionId: string }
  | { kind: "edge"; edgeRevisionId: string };
```

`revisionId` 锚定（禁止平行再造一套与 Git 无关的内容宇宙）：

| sourceType | revisionId |
|---|---|
| `file` | Git blob SHA（当前内容）或 commit SHA（checkpoint 指向的树） |
| `checkpoint` | Git commit SHA |
| `skill` | 文件在 Git 中时用 blob SHA；未入 Git 时用 `electron/content-hash.js` 的 SHA-256 |
| `session_entry` / `operation` / `tool` / `approval` | JSONL entry id / record id |
| `graph_revision` / `flow_revision` / `context_set` | 工件 canonical bytes 的 SHA-256 |

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
artifact:   histos:{workspaceId}/{graph|flow|context|view}@{sha256}
```

### 7.3 最小 schema（查找库，可删）

```sql
addresses (
  address_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  selector_json TEXT
);

node_revisions (
  node_revision_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  artifact_sha TEXT
);

edge_revisions (
  edge_revision_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  src_node_id TEXT NOT NULL,
  dst_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  artifact_sha TEXT
);

revision_parents (
  child_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id)
);

evidence (
  revision_id TEXT NOT NULL,
  address_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (revision_id, address_id, role)
);

spans (
  span_id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL,
  entry_object_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  length INTEGER NOT NULL
);

artifacts (
  sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- graph_revision | flow_revision | context_set | view_state
  created_at INTEGER NOT NULL,
  source_set_json TEXT NOT NULL,
  lens TEXT NOT NULL,
  granularity TEXT NOT NULL
);

meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

没有线性 `superseded_by`。新修订通过 `revision_parents` 指向旧修订。没有「节点存一条 fact_ref」。每个 node/edge revision 通过 `evidence` 指向 1..N 个 `FactAddress`。

### 7.4 持久工件 vs 可删索引

| 种类 | 存哪 | 可否删 | 何时必须落盘 |
|---|---|---|---|
| 结构边投影 | sqlite | 可删，必须能从 JSONL 重建 | 每次 rebuild / 增量 apply |
| 语义边 / 摘要节点 | sqlite 查找副本 + **工件** | sqlite 可删；工件在「被用过」后不可默删 | 见下方触发 |
| GraphRevision | `artifacts/<sha>.json` | 用户显式永久删除才走墓碑 | 查看保存、开会话、生成 skill、转 Flow |
| FlowRevision / FlowSpec | 同上 | 同上 | Validate 通过并提交审批之前必须有 sha |
| ContextSet | 同上 | 同上 | 框选开会话 / 编辑 / 生成 skill 之前冻结 |
| ViewState | 同上 | 用户清空画布布局才删 | 用户手动拖拽落位、分区、钉住视口 |

「被用过」的定义（必须落成工件，不能只活在 sqlite）：

- 用户保存或钉住该图
- 用该选择开启会话
- 用该选择生成或修改 skill
- Convert to Flow 并进入 Validate / Approval
- 该修订被后续 GraphRevision 当作 parent

未查看、未保存、纯探索的 LLM 草稿可以只在内存 / sqlite，进程退出后允许消失。

自动布局坐标不是语义修订，不进 GraphRevision。用户手动排布是工作成果，必须落 ViewState 工件，刷新后不得被 ELK 默默覆盖。

工件格式（JSON，UTF-8，SHA-256 of canonical bytes）：

```text
GraphRevision {
  schemaVersion
  workspaceId
  sourceSet
  lens               -- structural | semantic | mixed
  granularity        -- operation | entry | span | file | cluster
  nodes[] / edges[]
  evidence[]
  parents[]          -- parent GraphRevision sha
}
```

### 7.5 SourceSet + Lens + Granularity

每次查询、每次凝练、每次画布打开都必须带这三项。Engine 不提供「给我整个 workspace 的图」。

```text
SourceSet     会话集合 / 路径 glob / skill 名 / 既有 artifact sha
Lens          structural（确定性）| semantic（LLM）| mixed
Granularity   operation | entry | span | file | cluster
```

语义 LOD：拉远看 cluster，拉近看 entry/span。嵌套图是 Sub Flow，不是另一套引擎。

adapters 投影 structural。Engine 侧 semantic 凝练编排（成本上限、离线诊断、round-trip）已落地（`ad64c6f67`）；生产 `semanticProvider` 尚未接入 Histos worker，桌面 semantic 凝练返回 `semantic_provider_unavailable`。接入是剩余切片，不是可选项。

### 7.6 ContextSet

框选节点 / 边并「就这些开会话 / 编辑 / 生成 skill」时：

1. Engine 把当前 SourceSet + Lens + Granularity + 选中地址冻结成 ContextSet 工件
2. 新会话 JSONL 追加 `context_attached`（经 `session-facts.js`）
3. `session_reference` 仍只服务 `@session` 提及，不替代 ContextSet

`context_attached` 载荷最小集：`id`、`lane`、`targetSessionId`、`contextSha`、`timestamp`。缺 sha 的开会话算失败。

选择不是 UI-only。刷新后视口草稿可以丢；ContextSet 工件不能丢。

上下文预算（`23d5bc5cf` 已实现确定性优先级裁剪，不得把超窗内容静默截断）：

```text
1. 节点凝练文本
2. 直接 Evidence 原文（span / hunk）
3. 邻居摘要
```

超预算时：先按上列优先级裁；仍超则返回 `budget_exceeded`，发生在任何 artifact / fact 写入之前（fail-closed，`23d5bc5cf`）。停在 Composer 前让用户缩选择的用户收缩 UX 尚未验证，禁止偷偷丢 Evidence。离线时 structural 透镜照常；semantic 透镜进入诊断，不得用空摘要冒充凝练。

### 7.7 Graph 与 Flow

- 一套 Graph Core。Flow 是带执行约束的 Graph，不是第二个引擎。
- 语义图节点没有「Run」。
- 路径：Convert to Flow → FlowSpec Draft → Validate → Approval（fail-closed）→ Pi 执行 → 新 facts → 新 GraphRevision。
- FlowSpec 也是内容寻址工件。Validate 失败不得进入审批放行。
- 当前 Validate 与 Pi 执行均已接通（P6 `b06a27c6c`）：Convert → Validate → 持久审批（复用既有 approval facts）→ `session.prompt`；不可达 / 重复 / 成环 / session 不匹配一律拒绝。

### 7.8 Skill 与删除

```text
Draft（铬件 / CodeMirror）
  → Diff（对当前 hashed 版本）
  → Apply（写文件，新 content hash / Git blob）
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
- 需要新事实类型时：先改 `packages/agent` codec/reducer，再改 `session-facts.js`，再改 Engine 适配器。

### 7.10 重建（形式化）

```text
SQLite = rebuild(JSONL facts, Git workspace, skill files, durable artifacts)
```

启动、schema 不匹配、或用户触发 rebuild：

1. 扫该 workspace 相关 JSONL facts → 重建结构 node/edge revisions + evidence
2. 按现行策略重切 spans
3. 读 `artifacts/*.json`。被用过的 GraphRevision / FlowRevision / ContextSet / ViewState **原样填回**查找库，不得重跑 LLM 覆盖其 sha
4. 未被引用的探索性语义边丢弃（允许空，不允许猜）
5. 旧 ContextSet 的 evidence 按 FactAddress 解析：原文还在则引用仍有效；原文缺失则标 missing，不得改写成「最新文件」
6. 进度可取消；取消不破坏 JSONL，不留下半套 schema_version

漂移规则：新的 semantic 凝练永远是新 GraphRevision（新 sha，parent 指向旧 sha）。旧工件字节不变。ContextSet 钉的是旧 sha，解析旧图，不跟随最新凝练。

---

## 8. 剩余实施顺序

每一刀单独可合并、可回滚、有测试。禁止把 Base UI / Vite 8 / TS 7 / Electron 44 / 语义凝练混成一次提交。

已完成的 R0–R5、H0、T1–T5 与 P1/P5/P6/P7 不再重做（提交见 §2）。P8 本地崩溃诊断已提交（`aafcdc324`）；P2/P3/P4 已深化（`ad64c6f67`、`23d5bc5cf`）。下面全部是剩余缺口，不是可选项。

```text
P2-g   生产 semanticProvider 接入 Histos worker
       保留成本上限与离线诊断；semantic 凝练在桌面端到端可用
       LLM eval 回归与成本遥测

P3-g   交互式嵌套 Sub Flow UI
       递归 compound ELK 布局已在 `ad64c6f67`；React Flow Sub Flow 交互未做

P4-g   超窗用户收缩 UX
       优先级裁剪与 budget_exceeded fail-closed 已在 `23d5bc5cf`；
       停在 Composer 前引导缩选择的交互未验证

P8-g   Electron crashReporter 上传
       normalized fatal 事件、dead 判定、host 重建、PTY ownership 清理、
       有界路径安全脱敏已在 `aafcdc324`；仅缺上传通道（当前本地诊断）

R6     packages/ravel-runtime facade
       仅当桌面必须与 Pi 包名解耦、且有真实分叉需求时做
       当前按设计跳过；不是栈的备选，也不阻塞上面任何一刀
```

并行规则：T* 工具链切片互斥（一次一个 major），T* 已全部落地。剩余 P* 缺口切片不得混提交。Canvas LOD 不进本表，只进 §6 判据。

MCP 网络传输、computer use、PR/gh 面板、跨项目记忆仍不在本计划。

---

## 9. 包与文件落点

已有：

```text
apps/ravel-desktop/src/renderer/ui/
apps/ravel-desktop/src/renderer/lib/stream-live.ts
apps/ravel-desktop/src/renderer/lib/operation-timeline.ts
apps/ravel-desktop/src/renderer/components/panels/GraphCanvas.tsx
apps/ravel-desktop/src/renderer/components/panels/GraphPanel.tsx
apps/ravel-desktop/electron/histos-host.js
apps/ravel-desktop/electron/histos-engine.js
apps/ravel-desktop/electron/histos-chunker.js
apps/ravel-desktop/electron/histos-adapters.js
apps/ravel-desktop/electron/histos-provenance.js
apps/ravel-desktop/electron/pty-host.js
apps/ravel-desktop/electron/pty-worker.mjs
apps/ravel-desktop/electron/session-facts.js
```

保持单写者：

```text
apps/ravel-desktop/electron/session-facts.js
packages/agent/src/harness/session/types.ts   只加经过 codec/reducer 的新 record
```

IPC（四方同步：`ipc-registry` / `ipc-contracts` / `preload` / renderer client）：

```text
omega:histosGetGraph
omega:histosRebuild
omega:histosGetNode
omega:histosFreezeContext
omega:histosGetArtifact
```

不把 sqlite 句柄、原始 SQL、文件绝对路径传给 renderer。PTY 与 Histos 各自独立通道，不建 generic dispatch。

---

## 10. 依赖

| 依赖 | 状态 | 约束 |
|---|---|---|
| `react` / `react-dom` 19.2.8 | 已 pin | 与 `@types/react` 同步 |
| `@vitejs/plugin-react` 6.1.0 + Compiler 1.0.0 | 已装（T2） | 不启用 Vite 开发服务器 |
| `tailwindcss` 4.3.3 | 已 pin | 外部 CSS |
| `@base-ui/react` 1.7.0 | 已装（T1） | 精确 pin；业务不直引 |
| `@radix-ui/*` | 已删除（T1） | 不得残留 |
| `zustand` 5.0.8 | 已装（T4） | 铬件 only |
| `@tanstack/react-virtual` 3.13.12 | 已 pin | 不要默默改 latest |
| `node:sqlite` | 已用 | Electron / Node 内置，不新增 npm 原生模块 |
| `@xyflow/react` 12.11.5 | 已 pin | 精确 pin |
| `elkjs` 0.12.0 | 已 pin | 布局进 worker |
| `codemirror` 及语言包 | 已 pin | 不要 `monaco-editor` |
| `@xterm/xterm` 5.5.0 | 已 pin | renderer 可引 |
| `node-pty` 1.1.0 | 已 pin | 只在 PTY worker 顶层 import；asarUnpack 全树 |
| Vite 8.2.2 / Rolldown | 已装（T2） | 见 §3.1 |
| TypeScript 7.0.2 | 已装（T3） | 见 §3.1 |
| Electron 44.0.0 | 已装（T5） | node-pty 按 44 ABI 重建 |
| `lucide-react` 1.34.0 | 已装（P1） | 精确 pin |
| Playwright Electron `@playwright/test` 1.62.1 | 已装（P7） | `p7:e2e`；只测桌面；不跑完整 `npm test` |

`undici` 若被间接升版，按 AGENTS.md 先读 changelog。Renderer 继续零原生依赖。electron-builder 不为铬件 rebuild。`asar: true`，`npmRebuild: false`，`asarUnpack: node_modules/node-pty/**`。

---

## 11. 测试与门禁

每阶段结束都跑：

```text
cd apps/ravel-desktop && node --test test/<focused>.test.mjs
npm run --workspace @ravel/desktop typecheck
npm run --workspace @ravel/desktop typecheck:renderer
npm run check
git diff --check
```

不跑完整 `npm test` / `npm run build`，除非用户要求。

R5 / 壳升级额外：

```text
npm run --workspace @ravel/desktop package:dir
RAVEL_PTY_SMOKE=1 npm run --workspace @ravel/desktop electron:smoke
```

企业代理 TLS 拦截时，electron-builder 用 `--config.electronDist=../../node_modules/electron/dist`。不得把强制杀进程当 smoke 成功。

| 阶段 | 测试 |
|---|---|
| 已完成 R0–R5 + H0 | 现有 histos / pty / electron-security / electron-smoke（桌面套件现 286 通过） |
| T1–T5（已落地） | 无 `@radix-ui/`；原语键盘与 drawer inert；单 IIFE + 外部 CSS；erasable + 两个 typecheck；Electron 44 ABI `.node` 在 unpacked 路径；真实 spawn/write/resize/kill；child exit 0 |
| P2 | 删 sqlite 保留 artifacts 后被用过的语义图仍在；非法 FactAddress 拒绝；无 provider 时 `semantic_provider_unavailable` |
| P6 | Validate 失败不得审批放行；语义节点无执行路径 |
| P7 | `p7:e2e`：Playwright Electron，provider-free，`app://` 加载 + 隔离 + best-effort PTY / ContextSet |

---

## 12. 风险

| 风险 | 处理 |
|---|---|
| 语义图被当成可执行 Flow | Convert to Flow 闸门；语义节点无 Run |
| 探索性 LLM 图丢了用户已用过的选择 | 「被用过」必须落 artifact；ContextSet 先于新会话 |
| sqlite 当权威 | 删库测试：时间线仍在，被用过的工件仍在 |
| Git 与 Histos 双版本 | file/checkpoint/skill 的 revisionId 锚定 Git；工件 sha 只用于凝练产物 |
| 凝练漂移破坏旧会话 | 旧 ContextSet 钉旧 sha；新凝练只追加新 GraphRevision |
| Windows 文件锁 | Engine 单进程单连接串行队列；Main / Agent 不打开该文件 |
| Vite 8 / Rolldown 破坏 IIFE | 修配置与插件，直到硬约束满足 |
| Radix / Base UI 双轨 | T1 结束前同一文件禁止双 import；结束后删除 Radix |
| React Flow 包体 | release gate 盯 asar；节点懒挂载仍在单 IIFE 约束内 |
| 过早自研 Canvas | §6 三条判据全满足才开口子 |
| Engine 写 facts | 静态断言：仅 `session-facts.js` 调用 `appendCustomEntry` |
| 打包 ConPTY 卡死 | 全树 unpack node-pty；autotest 用 `process.reallyExit`；smoke 看真实 exit |

回滚：每阶段独立 commit。sqlite 可删——产品退回「无探索图、有时间线、有 artifacts 则能重建被用过的图」。工具链切片失败时修目标版本，工作树丢弃，不把半截 major 配进 `main`。

---

## 13. 顺序摘要

```text
R0–R5     已完成（feature 分支；R5 hang-fix 已提交 `6ddb87bd1`）
app://    已完成
H0        R5 hang-fix 已提交
T1–T5     已落地：Base UI / Vite 8.2.2 + Rolldown / TS 7.0.2 / Zustand 5.0.8 / Electron 44.0.0
P1 P5 P6 P7   已提交（CJK+Lucide / ViewState / Flow→Pi / Playwright E2E）
P2 P3 P4 P8   已深化（`ad64c6f67` `23d5bc5cf` `aafcdc324`）；剩余：semanticProvider 接入、
              eval/成本遥测、嵌套 Sub Flow UI、收缩 UX、crashReporter 上传
R6        仅真实分叉需求（当前按设计跳过）
```

---

## 14. 成功标准

1. 铬件是琥珀工匠：微凸、hairline、∞ 图腾、克制发光；底层是 Base UI，不再能看出 Material 或 Radix 双轨。
2. 构建是 Vite 8.2.2 IIFE + 外部 CSS；语言是 TypeScript 7；壳是 Electron 44。
3. 长会话、流式输出、面板拖拽在目标预算内。
4. 任意 Histos 节点 / 边能指回 `FactAddress`；删查找库产品仍可用；被用过的 GraphRevision / ContextSet / ViewState 仍在。
5. 语义图不能直接执行；Flow 必须经过 Validate + 审批 + Pi。
6. 审批、隔离、IPC allowlist、JSONL 单写者与重构前同等或更严。
7. 凝练有成本 / 离线 / eval 护栏；三进程有崩溃上报；Playwright 覆盖主路径。
8. 后续加嵌套图或远景 Canvas 时，不必再换事实模型。
