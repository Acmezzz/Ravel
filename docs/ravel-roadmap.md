# Ravel 未完成工作

更新日期：2026-08-28
状态：**索引仍有效；当前执行顺序认 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)。** 已完成的迁移、切片 0/1、S2–S4、Histos R0–R5 不再列为待办。R0–R5 与锁定栈档案认 [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md)。发布策略认 [`ravel-release.md`](./ravel-release.md)。

当前工作树：`main`（HEAD `9b98e529b`，已推送 origin；feat 分支已并入并删除）。H0、T1–T5、P1/P5/P6/P7/P8 与 P2/P3/P4 深化均已提交。不发 npm，暂不发安装器 / exe Release。

没有备选栈。T* 一次只升一个 major。失败修目标版本，不退回 Vite 6 / TS 5 / Radix / Electron 43 作为长期形态。

---

## 已提交，不重开

| 切片 | 提交 | 内容 |
|---|---|---|
| H0 R5 hang-fix | `6ddb87bd1`（`1e89737ee` 延续） | `process.reallyExit(0)`、`asarUnpack: node_modules/node-pty/**`、PTY smoke 看真实 child exit 0 |
| T1 Base UI | `bf455eb7a` | Radix 已删除 |
| T2 Vite 8.2.2 + Rolldown | `b538026ae` | classic IIFE、`codeSplitting: false`、外部 CSS |
| T3 TypeScript 7.0.2 | `7b99944cd` | 根与桌面统一 |
| T4 Zustand 5.0.8 | `36cfd7b66` | |
| T5 Electron 44.0.0 | `7a964b1c2` | node-pty 按 44 ABI 重建 |

---

## 现在就该做

剩余缺口全部在产品深度，不在工具链。本周期切片（N0–N6：checkpoint、semanticProvider、会话结构入库、Plan 模式、资源蒸馏、同工作区记忆、跨库 ContextSet）只认 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)。下表是历史 P* 对照，其中 P3/P4/P8 与凝练 eval 已明确推迟。

| 缺口 | 说明 |
|---|---|
| P2 生产语义提供者 | `semanticProvider` 未接入 Histos worker，桌面 semantic 凝练返回 `semantic_provider_unavailable`。成本上限与离线诊断已在 Engine 落地 |
| P2 eval / 成本遥测 | LLM 凝练的 eval 回归与成本遥测未做 |
| P3 嵌套 Sub Flow UI | 递归 compound ELK 布局已提交；完整交互式嵌套 Sub Flow UI 未做 |
| P4 超窗收缩 UX | 确定性优先级裁剪与 `budget_exceeded` fail-closed 已提交；超窗后停到 Composer 前让用户缩选择的交互未验证，诊断之外无收缩引导 |
| P8 crashReporter 上传 | 三进程崩溃结构化诊断已提交；Electron `crashReporter` 上传未接入，仅本地诊断 |

---

## 外部调研结论（2026-08-28，vibe-memory / StrataGate / archify）

三库对照后的净收获，按可信度排序。archify（24.5★）为唯一大规模验证项目；两个记忆库的 benchmark 均为小样本自报，只取设计不取数字。

- **确定项 — GraphRevision 结构化 diff**：两个已验证 revision 之间输出 added / removed / changed / moved / rerouted 的纯函数。artifact 已是 canonical JSON + SHA-256，成本低，直接服务语义凝练审查。参照 archify 的 Before / Delta / After。
- **候选项 — ContextSet 证据门控**：检索命中不等于证据充分。Ravel 已可沿 FactAddress 回溯原文，门控只做 advisory 诊断字段，不做子系统。参照 StrataGate 的 evidence gate。
- **不立项**：修正推翻边（取代语义已由 revision DAG `parents` 表达，矛盾检测是 LLM 低可靠判断）；使用反馈加权（Ravel 无检索排序系统，留作未来 ranking 的约束）；open-tail 压缩边界（Ravel 按需从 JSONL 重建，无此问题）。L0–L5 分层与 typed IR 确定性编译与现有三层不变量 / canonical artifact 同构，仅作佐证。
- **选型警示（弱证据）**：vibe-memory 自报 <2B 本地模型做 LLM 边分类 33% / 53s。任务不同（分类 ≠ 凝练），不能外推到 semanticProvider，但支持"接 API provider 或保持 offline fail-closed，不走本地小模型"的默认选择。

---

## 产品深度（P*）

| 切片 | 状态 |
|---|---|
| P1 | 完成 `65fcf42b0`：CJK fallback（PingFang SC / Microsoft YaHei / Noto Sans CJK）+ Lucide 图标 |
| P2 | 部分：凝练 round-trip、parentId 保持、成本上限、离线诊断已落地（`ad64c6f67`）。剩生产 semanticProvider、eval、成本遥测 |
| P3 | 部分：递归 compound ELK 布局已落地。剩交互式嵌套 Sub Flow UI |
| P4 | 部分：cumulative canonical budget + 优先级裁剪（凝练文本 > 直接 Evidence > 邻居摘要），`budget_exceeded` 在任何工件 / fact 写入之前返回（`23d5bc5cf`）。剩用户收缩选择 UX |
| P5 | 完成 `18ec2df39`：ViewState 手动画布排布持久化，自动 ELK 不覆盖 |
| P6 | 完成 `b06a27c6c`：Convert → Validate → 持久审批（复用既有 approval facts）→ `session.prompt`。fail-closed；不可达 / 重复 / 成环 / session 不匹配拒绝。语义图执行路径保持 404 |
| P7 | 完成 `9d3c867ba` + `d8412f5a2`：`apps/ravel-desktop/e2e/` 隔离 Playwright Electron 门禁，provider-free，覆盖 `app://` 加载 + 隔离 + best-effort PTY / ContextSet |
| P8 | 部分 `aafcdc324`：normalized `(type,location,report)` fatal 事件、意外 clean exit 判 dead、PTY send 失败杀 host、Histos dead host 重建、PTY 死亡清 ownership、有界路径安全日志脱敏。剩 crashReporter 上传 |

---

## 有真实分叉需求再做

R6：`packages/ravel-runtime` facade，把桌面从直接依赖 `@earendil-works/pi-coding-agent` 改为稳定 API。当前按设计跳过：不是栈的备选，也不阻塞 P*。

内部化 `ravel-agent-core` / 独立 CLI / native 单二进制：产品路线，不与当前锁定栈混提交。

---

## 明确不做

- 删除 `.pi` 目录或重命名 Pi session 格式
- 现在删除 `omega://`、`OMEGA_*`、`window.omega`、`omega:*` IPC
- 一次性重命名所有 `@earendil-works/pi-*` 包
- 删除上游 Pi/Mario Zechner 版权和 MIT 声明
- 把 credentials 解密后重加密
- 打开 renderer filesystem / `nodeIntegration`
- 把 `release/`、`dist/`、`node_modules` 提交进 Git
- Neo4j / Monaco / 自研 Canvas / 第二套 agent runtime
- 语义图直接 Run
- Plan/Todo 假面板、Scout/Workflow、子 agent worktree
- MCP 网络传输、computer use、跨项目记忆
- 发 npm 包；Authenticode 未配置前发 NSIS / exe 安装器

Canvas 远景层不进待办。必须同时满足：可见简单节点持续 > ~2000、交互 P95 > 16ms、elkjs worker + 视口裁剪 + 节点回收仍不够。

---

## 顺序

```text
H0   R5 hang-fix                    已提交
T1–T5   锁定栈                       已装齐（Electron 44.0.0 / Vite 8.2.2 / TS 7.0.2 / Zustand 5.0.8 / Base UI 1.7.0）
P1 P5 P6 P7   已提交
P2 P3 P4 P8   剩余：semanticProvider 接入 / eval 与成本遥测 / 嵌套 Sub Flow UI / 收缩 UX / crashReporter 上传
R6   仅真实分叉需求（按设计跳过）
```
