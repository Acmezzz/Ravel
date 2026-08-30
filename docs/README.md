# Ravel 项目文档

更新日期：2026-08-30

本目录只保留有明确职责的文档。当前状态、已验证结果和下一步入口以 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md) 为准；代码和测试优先于任何历史文字。

| 文档 | 角色 | 是否当前执行依据 |
|---|---|---|
| [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md) | 当前实现状态、能力边界、测试快照和剩余工作 | 是 |
| [`ravel-feature-inventory.md`](./ravel-feature-inventory.md) | 功能全景清单：每个功能的实现位置与 Histos 接入状态（已投影/接口就绪/未设计） | 是（清单） |
| [`ravel-core-design-and-next-slices.md`](./ravel-core-design-and-next-slices.md) | 产品不变量：事实权威、单写者、隔离、审批和工件规则 | 是（规范） |
| [`ravel-histos-refactor-plan.md`](./ravel-histos-refactor-plan.md) | R0–R5、H0、T1–T5 的历史验收与锁定栈档案 | 否（历史证据） |
| [`ravel-design-activity-session-reference-mcp.md`](./ravel-design-activity-session-reference-mcp.md) | S2–S4 设计与验收记录 | 否（历史证据） |
| [`ravel-example-agent-borrowing.md`](./ravel-example-agent-borrowing.md) | 外部项目借鉴决策和证据边界 | 否（决策证据） |
| [`ravel-release.md`](./ravel-release.md) | 版本、打包、迁移和发布门禁 | 是（发布规范） |

## 阅读规则

1. `ravel-histos-next-cycle.md` 的状态只依据当前源码、测试输出和 Git 提交，不沿用旧 HEAD 或旧通过数。
2. “契约存在”“纯函数测试通过”不等于生产接入完成。尤其不能把 `skill-inject`、memo durable 或 workflow 生产执行写成已交付。
3. `semanticProvider` 已具备 Histos worker → Main → Agent worker 的 relay 代码和测试；真实 provider 依赖模型、凭据和运行环境，仍须单独验收。
4. `.workbuddy/artifacts/` 是项目调研和审查证据，不是实施状态入口；`.workbuddy/memory/` 是项目数据，不删除、不改写。
5. `apps/ravel-desktop/docs/system_design.md` 和 `implementation-status.md` 的历史内容若与当前文档冲突，以当前代码和本文档为准。
