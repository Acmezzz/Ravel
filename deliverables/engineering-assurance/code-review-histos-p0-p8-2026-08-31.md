# Ravel × Histos P0–P8 全路线实现审查报告

**日期**：2026-08-31
**工作流**：工作流 1（全面代码审查）+ 工作流 5（技术债/冗余扫描）
**参与成员**：Archi（架构师）、Cody（代码审查师）、Tessa（测试专家）
**审查基线**：`main` @ `99976d1e0`（收口 `86cdf3325`、`95932d7c2`），对比本轮前基线 `2c75a12f5`
**审查性质**：只读分析 + 运行取证，未修改任何源码

> **修复跟进（2026-08-31 当日完成，提交 `63cf56093` → `bdde66529`）**：本报告指出的全部阻断/高/中问题已按行动清单修复（除真实 provider 与打包类外部验收）。修复后全量桌面测试 **553 tests：552 pass / 1 fail**（唯一失败为基线既有 `p1-cjk-lucide`）。修复明细见文末「十一、修复跟进记录」。

---

## 📌 TL;DR

- **整体结论**：引擎/事实层实现扎实且诚实，但**只有 P0（部分）、P1（6/7 域）、P2 真正端到端可用**。P3/P7/P8 是"引擎已实现 + 测试已过 + 整条链路没接线"的孤儿功能；P5/P6 存在**测试通过但行为错误**的实质缺陷。
- **严重度分布**：🔴严重 3 项 / 🟠高 9 项 / 🟡中 7 项 / 🟢低 4 项（去重合并后）
- **阻塞性**：**🔴 不通过**。存在已抹除内容仍可搜到（违反删除语义）、purge 账目静默丢失（违反设计 §2.1）、复原路径完全不可达（文档宣称"可复原"）三类阻断问题。
- **关于"多余代码"**：确认存在——9 个引擎方法、1 条完整 IPC 通道、7 个常量/别名、1 个渲染层 hook 方法、1 个 renderer 参数，**全部零生产调用方**。
- **关键反转**：新增 42 个测试中 **39 个是真行为测试**（推翻"纸面覆盖"假设）；但 `histos-selection.test.mjs:92` 这个纯正则断言通过的同时，被测工具实际不可用。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🔴 **不通过**（功能完整性与行为正确性均未达标） |
| 阻塞项数量 | 3（FTS5 假命中+已抹除可搜、purge 账目丢失、复原不可达） |
| 关键行动项 | 12 条（见文末行动清单） |
| 用户问题 1：是否完全实现文档/spec | **否**。P3/P7/P8 未接线、P6 L1 空壳、P1 缺 profile 域、spec tasks.md/checklist.md 勾选框 100% 未勾选 |
| 用户问题 2：功能是否全部正常 | **否**。端到端可用仅 P0（部分）/P1（6 域）/P2；P3/P7/P8 完全不可达；P5 FTS 行为错误；P6 不可达 |
| 用户问题 3：有无多余代码 | **有**。9 方法 + 1 IPC 通道 + 7 常量/别名 + restore() + asOf 渲染层零调用 |
| 建议下一步 | 先补 P0 闭环（复原通道 + purge fail-closed + 画布刷新），再决定 P3/P7/P8 是补接线还是降级标注 |

---

## 一、用户三问的直接回答

### 1.1 是否完全实现了文档和 spec 的内容？

**否。** 逐周期判定：

| 周期 | 规范要求 | 判定 | 断在哪一环 |
|---|---|---|---|
| P0 追溯层 | 归档/复原/抹除/asOf | ⚠️ **部分** | 归档/抹除可用；**复原不可用**；画布不自动刷新；无 session 时 purge 丢账目 |
| P1 config_changed | 7 域全写入点 | ⚠️ **6/7** | `profile` 域零写入（`recordConfig("profile"` 全仓 0 命中） |
| P2 Fact Graph 表面 | 事实页签/统计/右键 | ✅ **完整** | 唯一端到端完整的功能 |
| P3 策略共创 | 草案→校验→人审→工件 | ❌ **未接线** | 引擎+测试齐备，**无 IPC 通道、无 UI、无 agent 工具** |
| P4 repo source | 模块地图 | ❌ **用户不可达** | `omega:histosIndexRepo` 六方同步但**渲染层零调用点** |
| P5 观测 | diagnostic/FTS5/GoalState/usage | ⚠️ **部分** | GoalState 已接主流程 ✅；**FTS5 行为错误**；诊断双写重复 triple |
| P6 图会话 | L0/L1/L2 + histos_expand | ❌ **不可达** | `buildSelectionPrompt` 零调用；**L1 是 L0 重排**；expand 取不回压缩原文 |
| P7 能力流程 + 项目知识 | 解析工件 + 版本化入图 | ❌ **未接线** | 同 P3，无生产调用方 |
| P8 成果浏览 + handoff | 工件库 + 交接 | ❌ **未接线** | 同 P3，无生产调用方 |

**spec 纪律问题**：
- `.trae/specs/implement-histos-full-roadmap/tasks.md` 与 `checklist.md` 的**勾选框 100% 未勾选**（全文 `- [ ]`），与文档宣称的"全部完成"直接矛盾。
- R16 要求门禁全绿，但 `next-cycle.md` 自认 `packages/ai` 11 个 TS 错误 + 1 个测试失败按基线保留 → 与 R16 冲突。
- `next-cycle.md:98`「3 个 checkpoint 失败已修复」vs `:29`「checkpoint 当前仍有失败测试」→ 文档内部矛盾。
- `feature-inventory.md` 日期滞后（08-30 < 完成日 08-31），§3/§5/§6/§7/§12 多处状态与已实现相反。

### 1.2 所有功能是否全部实现且正常？

**否。** 端到端可用性清单（引擎→IPC→渲染层→用户操作）：

| 功能 | 判定 | 断点 |
|---|---|---|
| 归档节点/triple | ⚠️ 部分可用 | 画布需手动刷新（渲染层未订阅事件） |
| 抹除 purge | ⚠️ 部分可用 | 无 session 时 purge_record 静默丢失 |
| **复原归档** | ❌ **不可用** | 无 tombstone 列举通道 + `restore()` 无调用方 |
| 配置变更留痕（6 域） | ✅ 可用 | 全链路通 |
| profile/设置变更留痕 | ❌ 未接线 | 主进程写入点缺失 |
| Fact 面板（查询/筛选/统计） | ✅ 可用 | 唯一端到端完整 |
| 策略共创 | ❌ 不可达 | 断在主进程（无 IPC） |
| 仓库索引/模块地图 | ❌ 不可达 | 断在渲染层（无调用点） |
| FTS5 关键词搜索 | ❌ **行为错误** | clear/raw DELETE 后返回错误行 |
| 诊断/goal/usage 落盘 | ⚠️ 部分可用 | 派生层产生重复 triple |
| 选区对话/渐进式披露 | ❌ 不可达 | 零生产调用方 + L1 空壳 |
| histos_expand 取回原文 | ❌ 不可用 | worker 只读内存 entries |
| capability flow / 项目知识 / handoff | ❌ 不可达 | 同 P3 |

### 1.3 有无多余代码？

**有，且数量不小。** 详见第五节。

---

## 二、🔴 严重问题（3 项，阻断）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | **FTS5 索引失同步 → 已抹除内容仍可搜到 + 假命中** | Tessa 实测：写 3 条含 `zebraquark` → `clear()` → 重写 3 条无关内容 → `searchFts("zebraquark")` **命中 3 条 beta 行**；绕过 factGraph 直删后 `searchFts("different")` 命中 `"brand new payload one"`。根因：`fact_triples_fts` 是 `content='fact_triples'` 外部内容表，`clear()` 用 `DELETE FROM fact_triples_fts` **清不掉 FTS 索引**（须用 `'delete-all'` 命令）；`applyDiagnostics` 的 raw `DELETE FROM fact_triples WHERE subject=?`（engine:924）与 purge（`engine.js:1130`）均不同步删 FTS → rowid 复用后 JOIN 到错误行 | **违反删除语义**：抹除后的文本仍可全文搜到；搜索结果张冠李戴 |
| 2 | **purge 先删后记账，无 session 时账目静默丢失** | `main.js:2347-2370`：先 `await histos.call("purgeEntries")` 提交物理删除（engine 内已 `COMMIT`），**后**判 `if (result?.purgeFact && worker?.sessionId)`；无 session 时 `purgeRecord={ok:false,"no active session"}` 但删除已生效。三方（Archi/Cody/Tessa）一致确认 | 违反设计文档 §2.1「抹除这件事本身留痕」；审计链断裂 |
| 3 | **归档的"可复原"是假的** | 29 个 `omega:histos*` 通道中**没有 ListTombstones**；`useHistosFactPanel.ts:96` 的 `restore()` **零组件调用**；`tombstones` 表无任何 SELECT 暴露通道。而 `HistosGraphWorkspace.tsx:116` 按钮写「归档（可复原）」、`FactsPanel.tsx:116` 写「可复原」 | 用户拿不到 tombstoneId → 复原路径完全不可达；UI 在误导用户 |

---

## 三、🟠 高严重度（9 项）

| # | 类别 | 文件:行 | 问题 | 建议 |
|---|---|---|---|---|
| 4 | 正确性 | `useHistosFactPanel.ts:20`（唯一订阅方） | 归档/抹除后**画布不刷新**（只有 Facts 面板刷新）；`useHistosGraphQuery.ts` 仅 `useEffect([refresh, workspaceEpoch])` 无事件订阅；engine 确实 emit（`:1034`/`:1156`） | `useHistosGraphQuery`/`HistosSurface` 订阅 `on_entries_archived/purged` 触发 `refresh()` |
| 5 | 正确性 | `worker.mjs:439-451` | `sessionManagerEntryReader` **忽略 `sessionId` 形参**，只读当前会话内存 entries → 压缩后/跨会话 entry 一律 `not_found`（Tessa 实测 worker 返回 `not_found`，而 engine 的 `expandEvidence` 能取回） | 回落到 `selection.jsonlEntryReader(sessionsRoot)`；`expandEvidence` 未进 worker 分发表 |
| 6 | 正确性 | `histos-selection.js:36-37` vs `:55` | **L1 是 L0 的换行重排**（Tessa 实测归一化后 `identical:true`，L1 独有信息 = 0；长 title 场景 L0=1238B / L1=1241B，L1 反而更长） | L1 应接 condense/distill 产物，否则删掉这层 |
| 7 | 正确性 | `main.js:2385/2387` | **诊断双写**：`applyDiagnostics`（`Date.now()`#1）与 `recordDiagnosticObserved`→JSONL→派生（`Date.now()`#2）两条路进 `fact_triples`，source 与 validFrom 均不同 → Tessa 实测**同 subject+predicate 落 2 行** | main 侧生成一次 `ts` 传给两条路径，或统一 source |
| 8 | 安全 | `worker.mjs:1361/1382` | `approveSkillEdit` 只校验 `draftId.startsWith("draft-")`，propose 不持久化 draft、`newContent` 由调用方重传 → **人审门形同虚设** | propose 存 `{draftId,filePath,nextHash}`；approve 查表并校验 `contentHashOf(newContent)===nextHash` |
| 9 | 架构 | `histos-engine.js:1461/1471/1502/1547/1594/1627/950/965/988` | **9 个引擎方法零生产调用方**（排除 test/ 后唯一命中是 `histos-worker.mjs:181-188` 分发表本身；main.js 实际只 call 14 个方法，不含这 9 个） | 补 IPC+UI，或文档降级标注为"引擎就绪，未接线" |
| 10 | 架构 | `histosIndexRepo` 全链路 | **孤儿 IPC 通道**：contracts/registry/schemas/main/preload/client/dto 六方同步，但 `src/renderer` 下 `.tsx` 调用数 = **0** | 同上 |
| 11 | 正确性 | `CONFIG_PREDICATE_BY_DOMAIN` 有 `custom_config_profile`，但 14 处 `recordConfig(` 无一使用 | **profile 域无生产者**，`feature-inventory.md` §12 第 7 项缺口未补 | 补 `updateSettings`/`updateDesktopSettings`/`setPermissionProfile` 三处接线 |
| 12 | 性能 | `engine.js:521/557`、`:1818-1825`、`repo-source.js:192` | ①`revisionMatches`/`revisionLensMatches` **每行** `database.prepare`，`graphRows` 触发 2(N+M) 次；②`getNode` 为读 1 个节点跑完整 `graphRows()`（+3 次全表扫描）；③相对导入解析 `files.find()` 嵌双层循环 → O(F²·N) 次 `resolve()` | 外层 prepare 一次；evidence/parents 改参数化单查；预建 `Map<absPath, relPath>` |
| 13 | 可维护 | `global.css` | 新增 `ravel-histos-node-menu`/`-facts-panel`/`-fact-row` 三个 class **零 CSS 规则** → 菜单无 `position:absolute`，`left/top` 失效，渲染到画布下方而非光标处 | 补 CSS（absolute/z-index/背景/边框） |

---

## 四、🟡 中 / 🟢 低（11 项）

| # | 严重度 | 文件:行 | 问题 |
|---|---|---|---|
| 14 | 🟡 | `engine.js:950` | `ftsSearch` **不做墓碑过滤**（queryFacts:882 / graphRows:613 都做了）→ 已归档内容仍可搜到 |
| 15 | 🟡 | `engine.js:924-945` | applyDiagnostics 的「删旧」与「写新」两个事务，writeFacts 失败则旧诊断已丢 |
| 16 | 🟡 | `main.js:585` | `recordConfig` 在 `!worker?.sessionId` 时直接 return → 无会话时 14 处设置写入的 config_changed 全静默丢弃 |
| 17 | 🟡 | `session-facts.js` | `goal_state` 只校验 objective/status/rounds，`tokensUsed/timeUsedSeconds/continuationsUsed` 未校验；`requireString(message/model)` 无长度上限 |
| 18 | 🟡 | `FactsPanel.tsx:17` | `PREDICATE_OPTIONS` 只列 10 个新谓词中的 3 个，其余 7 个下拉选不到 |
| 19 | 🟡 | `repo-source.js:130/161` | 同文件 `readFileSync` 两次 |
| 20 | 🟡 | `checkpoint-service.js:203` | prune 循环内每个 stale 都跑一次 `git rev-parse` 子进程 |
| 21 | 🟢 | `checkpoint-service.js:55/206` | `listCheckpoints` 的 id 未校验 40-hex 就进 `join(gitDir,...)` → 恶意仓库可路径穿越 |
| 22 | 🟢 | `engine.js:1479` | `approveStrategyDraft` 允许 `input.budget` 覆盖已校验的 maxBudget |
| 23 | 🟢 | `FactsPanel.tsx:45` | `triple.id ?? ""` 可能提交空 id |
| 24 | 🟢 | `repo-source.js:19` | IGNORED_DIRS 硬编码本项目专属 `ravel-ui-refresh`/`.workbuddy`，且无 `.env/.pem/.key` 忽略规则 |

---

## 五、死代码与冗余清单

### (a) 未接线的导出/方法（写了没人调用）

**引擎方法（9 个）**：`createStrategyDraft:1461`、`approveStrategyDraft:1471`、`applyCapabilityFlows:1502`、`applyProjectKnowledge:1547`、`createHandoff:1594`、`listArtifacts():1627`、`ftsSearch:950`、`buildSelectionPrompt:965`、`expandEvidence:988`
→ 全部仅 `histos-worker.mjs:176-188` 分发 + 单测，**零生产调用**。

**IPC 通道（1 条）**：`omega:histosIndexRepo`（contracts.js:115 / registry:117 / schemas:495 / main:2372 / preload:470 / client.ts:99 / dto.ts:1132 / ipc-contracts.ts:114）→ 六方同步齐全，**渲染层零引用**。

**渲染层**：
- `useHistosFactPanel.restore:96`（同文件的 archive/purge/refresh/relatedTo 均有调用方，唯独 restore 没有）
- `asOf`：engine:97-100 + schema + `dto.ts:1044` 齐全，**渲染层零传入** → 时间旅行未接线

**事件**：`on_strategy_approved`（engine:1491 emit、event-bus:36 注册、**零订阅**）

**零引用常量/别名（7 个）**：`SELECTION_CONSTANTS`(selection:145)、`REPO_SOURCE_CONSTANTS`(repo:219)、`CAPABILITY_FLOW_CONSTANTS`(capability-flow:114)、`MAX_STRATEGY_BUDGET`(strategy:23)、`SCHEMA_VERSION`(schema:16)、`scanSession`(adapters:569)、`structuralGraph`(adapters:571)

**其他**：`jsonlEntryReader`(selection:116) 只被死的 `engine.expandEvidence` 和测试使用；`CONFIG_DOMAINS` 的 `"profile"` 域无生产者。

### (b) 重复实现

- `MAX_EVIDENCE_ITEMS` 双定义：`selection:16`（=128，仅被死的 SELECTION_CONSTANTS 引用）vs `provenance:34`（=100000，真实使用）→ 同名易误用
- 诊断双写（见 #7）
- `PREDICATE_OPTIONS` 手工维护，与派生谓词集合脱钩（见 #18）
- `repo-source.js:53` `hashId` 是 `sha256` 的纯别名

### (c) 残留垃圾

- `worker.mjs:440` `void sessionManager;` —— 无意义空语句（下一行闭包真的用了 `sessionManager`）
- `sessionManagerEntryReader` 的 `sessionId` 形参解构后完全未用
- `adapters.js:587 projectMcpConfigGraph(configs)` 被 `engine.js:1289` 传第二个参数 `{workspaceId}`，签名只收一个 → 多余实参
- `histos-selection.js:16/145` 常量为导出而导出

### (d) 架构债

- **God object**：`histos-engine.js` 112KB，P0/P3/P4/P5/P7/P8 全塞进同一个类
- **命名易混**：`histos-capability.js`（executor wiring）vs `histos-capability-flow.js`（P7 解析）

---

## 六、测试质量评估（Tessa 实测）

- **比例**：新增 9 个测试文件共 **42 个 test：纯行为 39、混合(API+源码正则) 2、纯源码正则 1**（2.4%）
- **结论**：**推翻"纸面覆盖"假设**——新增测试主体是真行为测试，质量高于既有 `histos-ipc.test.mjs` 那类正则护栏。`assert.match(` 共 24 次，但 23 次落在混合块内对真实 API 结果的断言上。
- **典型真行为测试**：`histos-tombstones.test.mjs:104`「archive hides a node from all four read paths; restore revives it with an audit trail」——真实建引擎、真实归档、四条读路径断言。
- **典型伪覆盖**：`histos-selection.test.mjs:92` —— 仅读 `agent-bridge.js` 断言 `/"histos_expand"/`。**它通过了，而实际该工具取不回压缩原文**（#5）。这正是"全绿 ≠ 行为正确"的活样本。

### 覆盖缺口（按危害排序）

1. FTS clear/重写后的一致性（p5 test 只测新鲜写入命中 + miss，**从不测 clear 后再写**）
2. purge 在无 session 时的记账
3. 诊断双写幂等
4. 渲染层事件订阅 / 归档后画布刷新（**无任何渲染层测试**）
5. L0→L1 的信息增益
6. profile 域写入

---

## 七、架构不变量核对（7 条硬约束）

| # | 不变量 | 结论 | 证据 |
|---|---|---|---|
| 1 | 事实权威（改图不改写事实） | ✅ 未违反 | — |
| 2 | **单写者** | ✅ **未违反** | 全仓生产代码 `appendCustomEntry` 仅 `session-facts.js:260` 一处，且有 `session-facts.test.mjs:301` 自动断言 |
| 3 | JSONL 单行永不重写 | ✅ 未违反 | — |
| 4 | 审批 fail-closed | ⚠️ **部分违反** | 审批账目归档/抹除保护生效（engine:595-609）；但 purge 账目可静默丢失（#2） |
| 5 | 工件不可变 | ⚠️ **部分违反** | `engine.js:1130` purge 与 `:924` applyDiagnostics 直 `DELETE FROM fact_triples`，绕过 `FactGraphBackend` 契约，导致 FTS 脱同步（#1） |
| 6 | 删除两级语义 | ⚠️ **违反** | 复原路径不可达（#3）；已抹除内容仍可搜到（#1） |
| 7 | 渐进式披露 | ⚠️ **违反** | L1 = L0 重排（#6）；expand 取不回压缩/跨会话原文（#5） |

---

## 八、✅ 行动清单（按优先级）

| # | 行动 | 负责角色 | 紧急度 | 预期产出 |
|---|------|---------|--------|---------|
| 1 | **修 FTS5 索引同步**：`clear()` 改用 `'delete-all'` 命令；purge（engine:1130）与 applyDiagnostics（:924）删除前同步清 `fact_triples_fts` | 主程 | **P0** | 抹除后搜不到；clear 后无假命中 |
| 2 | **purge 改为先记账后删除**：无 session 时 fail-closed 拒绝，而非删除后提示记账失败 | 主程 | **P0** | `omega:histosPurge` 在无 session 时整体失败，物理删除不发生 |
| 3 | **补复原闭环**：新增列举墓碑的 IPC + engine 方法，UI 暴露"已归档"列表与复原按钮 | 主程 + 前端 | **P0** | 用户可看到并复原归档项；或 UI 文案改为不可复原 |
| 4 | **画布订阅归档/抹除事件**：`useHistosGraphQuery`/`HistosSurface` 订阅 `on_entries_archived/purged` 触发 refresh | 前端 | P1 | 归档后画布即时更新 |
| 5 | **ftsSearch 过滤墓碑**：复用 `activeTombstoneIds(db,"triple")` | 主程 | P1 | 已归档内容不被全文搜到 |
| 6 | **修 histos_expand**：`sessionManagerEntryReader` 回落到 `jsonlEntryReader(sessionsRoot)`，并把 `expandEvidence` 加入 worker 分发表 | 主程 | P1 | 压缩后/跨会话原文可取回 |
| 7 | **决定 P3/P7/P8 与 P4 的去向**：要么补 IPC + UI 接线，要么在文档降级标注为「引擎就绪，未接线」 | 架构 + 产品 | P1 | 文档与实现一致，消除孤儿代码或激活功能 |
| 8 | **修 L1 空壳**：L1 接 condense/distill 产物，或删除该层 | 主程 | P1 | 渐进式披露第二层有真实信息增益 |
| 9 | **补 profile 域与诊断双写修复**：三处 settings 写入点补 `recordConfig("profile")`；诊断两路统一 `ts` 与 source | 主程 | P2 | 7 域全覆盖；诊断不产生重复 triple |
| 10 | **补 3 个 CSS class 规则**（node-menu/facts-panel/fact-row） | 前端 | P2 | 右键菜单定位正确 |
| 11 | **修 approveSkillEdit 人审门**：propose 持久化 draft + approve 校验 content hash | 主程 | P2 | 人审真正被强制 |
| 12 | **文档纪律收口**：勾选 spec tasks.md/checklist.md；修 next-cycle 内部矛盾；feature-inventory 日期与状态同步 | 文档 | P2 | 文档与实现一致 |

---

## 九、⚠️ 待完善 / 已知局限

1. **机理分歧未完全收敛**：关于"诊断双写为何不去重"，Tessa 实测 triple id 为 `sha256(subject,predicate,object,source,validFrom,validUntil)` 截断（内容寻址，因 source/validFrom 不同 → id 不同）；Cody 则指出 `sqlite-fact-graph.js:47-56` 的 `generateId` 是 8 位随机 hex（非内容寻址，无去重能力）。**两者对同一现象给出不同机理**，但"落 2 行"的后果三方一致确认。建议修复前先复核 `histos-fact-graph.js:126` 与 `histos-sqlite-fact-graph.js:47` 两条 id 生成路径的实际调用关系——若为随机 id，问题比"去重失效"更严重（**完全无基于内容的去重**）。
2. **渲染层零测试**：本报告关于渲染层的结论（画布不刷新、菜单定位错误、restore 无调用方）均来自静态分析 + grep，无运行时验证。项目无任何渲染层测试。
3. **未做打包/真机验证**：按用户约束未执行打包与真机冒烟，Electron 运行态行为（右键菜单实际渲染、IPC 端到端）未经真机确认。
4. **性能问题未实测**：#12 三项性能问题为静态分析结论，无 benchmark 数据支撑。

---

## 十、值得肯定

1. **IPC 安全闭环完整**：4 条新通道六方同步 + `senderAllowed`/schemas/registry/preload 双重校验，`electron-security.test.mjs:157-158` 同步覆盖；`histosIndexRepo` 的 root 严格由 Main 从 `authorizedWorkspace(activeCwd)` 解析，渲染层不能传路径。
2. **凭据零泄漏**：`recordConfigChange` 四字段白名单 + `projectMcpConfigGraph`(adapters:587) 显式字段白名单 + main.js 14 处 `recordConfig` 无一携带 apiKey/headers/auth —— Cody 逐条 grep 验证。
3. **墓碑语义干净**：`revoked_at` 保留审计链、`copyTombstones` 让 rebuild 继承归档（engine:680/749）、`assertEntriesArchivable` fail-closed 保护审批账目、purge 拒绝 `session_index` 并回传 owning sessions hint。
4. **单写者不变量守住**：全仓生产代码 `appendCustomEntry` 仅一处，且有测试自动断言。
5. **checkpoint-service 的 PortableGit 修复教科书级**：绕过会静默丢弃三段式 ref 的 `update-ref`，直写 loose ref 后 `verifyRef` 读回校验、失败即抛，注释写清了「为什么」（2.55.0.windows.3 会连带删除同目录其他 ref）。
6. **新增测试质量高于预期**：39/42 是行为测试。

---

## 📚 数据来源 & 成员产出索引

- **Archi（架构师）**：规格符合性矩阵（P0–P8 逐项）、文档 vs 实现偏差清单（8 条）、架构不变量违反项（6 条）、架构债与多余抽象（8 项）
- **Cody（代码审查师）**：审查发现表（19 条，含安全/性能/正确性/可维护）、死代码与冗余清单（3 类）、对架构师判断的逐条取证（10 条，其中 1 条推翻、1 条部分推翻）
- **Tessa（测试专家）**：运行取证报告（10 项，其中 7 项确认不可用、1 项推翻"纸面覆盖"假设、1 项修正机理）、功能可用性总清单、测试质量盘点（42 test 分类）
- **验证基线**：`npm test --workspace=@ravel/desktop` = 546 tests / 545 pass / 1 fail（`p1-cjk-lucide`，经基线 `2c75a12f5` worktree 对照确认非本轮引入）

---

> 本报告由工程保障团队 AI 协作生成（Archi / Cody / Tessa 三方独立产出，主理人甄宇航汇编），关键决策请由人类工程负责人复核。

---

## 十一、修复跟进记录（2026-08-31，提交链 `63cf56093` → `bdde66529`）

| # | 原发现 | 修复提交 | 修复内容 |
|---|---|---|---|
| 1 | 🔴 FTS5 索引失同步（clear/删除后假命中、已抹除可搜） | `63cf56093` | `clear()` 改用 `'delete-all'` 命令；`purgeEntries`/`applyDiagnostics` 删除前同步走 FTS `'delete'`；新增 clear+rewrite 假命中回归测试 |
| 2 | 🔴 purge 先删后记账，无 session 账目静默丢失 | `08448e118` | 无活动 session 时 fail-closed 拒绝（`no_active_session`），物理删除不再可能无账目提交；契约测试断言"session 检查先于删除" |
| 3 | 🔴 复原不可达（无 tombstone 列举通道） | `b57b63b71` | `engine.listTombstones` + `omega:histosListTombstones` 六方同步 + FactsPanel「已归档」列表 + 复原按钮（restore() 首个真实调用方）；ledger 顺序/审计 trail 测试 |
| 4 | 🟠 诊断双写重复 triple | `63cf56093` | 派生层不再投影 `diagnostic_observed`（JSONL 权威全历史，graph 索引由 `applyDiagnostics` 专责 dedupe）；写新先于删旧（失败不丢旧诊断） |
| 5 | 🟠 ftsSearch 不做墓碑过滤 | `63cf56093` | engine 层过滤 active tombstones；归档→搜不到→复原→可搜 测试 |
| 6 | 🟠 histos_expand 读内存 entries、忽略 sessionId | `434d46a9c` | 内存 miss 回落 `jsonlEntryReader(sessionsRoot)`；压缩后/跨会话可取回 |
| 7 | 🟠 L1 = L0 重排（渐进式披露空壳） | `434d46a9c` | L1 只携带节点 summary/distill 文本，无摘要节点明确标注；信息增益断言 |
| 8 | 🟡/🟠 9 个引擎方法零生产调用 | 部分处理 | P6 系（buildSelectionPrompt/expandEvidence）经 worker 工具与列表测试存活；P3/P7/P8 系保持"引擎就绪"并在 spec 诚实标注 |
| 9 | 🟡 `recordConfig` 无 session 静默丢弃 | 未修 | 需产品决策（无会话时设置写入的事实记录策略），留待后续 |
| 10 | 🟡 profile 域零写入 | `43faba05b` | `updateSettings`/`updateDesktopSettings`/`setPermissionProfile` 三处接线（bookkeeping 字段排除） |
| 11 | 🟡 归档后画布不刷新 | `43faba05b` | `useHistosGraphQuery` 订阅 `on_entries_archived/restored/purged` |
| 12 | 🟠 右键菜单无 CSS 渲染错位 | `4f425ef48` | `ravel-histos-node-menu` 补 absolute 定位等 3 组规则 |
| 13 | 🟠 approveSkillEdit 人审门形同虚设 | `4f425ef48` | propose 注册 `{draftId,filePath,nextHash}`，approve 校验匹配（unknown_draft/draft_mismatch） |
| 14 | 🟢 checkpoint id 未校验 40-hex | `4f425ef48` | `refFor` fail-closed 校验 |
| 15 | 🟡 PREDICATE_OPTIONS 缺 7 个谓词 | `4f425ef48` | 补全 custom_* 全家族 |
| 16 | 🟠 死代码/冗余（ponytail） | `62328fe8d` | 删 7 个 0 引用常量/别名、MAX_EVIDENCE_ITEMS 双定义、多余实参（net -12 行） |
| 17 | ❌ spec tasks.md/checklist.md 勾选框未勾 | `bdde66529` | 全部勾选；未实现项（Task 24.2/25.2）诚实保留未勾并注明；P3/P4/P7/P8 标注"引擎就绪、产品未接线" |

**修复后验证**：553 tests：552 pass / 1 fail（唯一失败 `p1-cjk-lucide` 为基线既有，经 `2c75a12f5` worktree 对照确认非本轮引入）。

**仍遗留（需产品/真实环境决策，不在本次修复范围）**：
- P3/P7/P8 与 P4 的用户路径接线（引擎已就绪，需 IPC+UI 或正式降级标注——spec 已诚实标注，文档不再过度宣称）
- Task 24.2 Inspector「展开原文」、25.2 图选区生成 skill 草稿（渲染层入口）
- 真实 provider 验收、嵌套 Sub Flow UX、crashReporter 上传
- `recordConfig` 无会话时的持久化策略
