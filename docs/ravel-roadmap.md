# Ravel 未完成任务与发布路线图

更新时间：2026-08-25

本文记录 Ravel 从 Omega/Pi 派生产品迁移完成后，仍需要处理的工作。任务按发布风险和依赖关系排序。

## 当前状态

已完成的迁移工作：

- 桌面目录迁移为 `apps/ravel-desktop`。
- Electron 产品身份迁移为 Ravel：应用 ID、产品名称、构建产物名称和 runtime 资源目录已更新。
- 根 workspace 名称迁移为 `ravel-monorepo`。
- 桌面 workspace 名称迁移为 `@ravel/desktop`。
- 增加 Omega → Ravel 用户数据迁移：`userData/omega` → `userData/ravel`。
- 加密 credentials 文件按 opaque blob 原样迁移，不解密、不重加密、不打印明文。
- 保留 `.pi` 配置、session、extension 布局和 Pi runtime 包名兼容性。
- 保留 `omega://`、`OMEGA_*` 和 `window.omega` 等兼容入口，同时增加 Ravel 入口。
- 增加 `UPSTREAM.md` 和第三方声明，保留 Pi/Mario Zechner 的版权与 MIT 许可。
- 完成 Ravel GitHub 仓库迁移并推送到 `origin/main`。
- 当前桌面测试通过：156/156（含 deep link 新增测试）。
- 当前 renderer typecheck、Electron Node syntax check 和根目录 `npm run check` 已通过。

P0/P1 发布准备（2026-08-25 完成）：

- 真实 Electron 打包与 smoke test 在 Windows 上验证通过（见 P0.1）。
- `ravel://` 协议注册与单实例转发实现并测试（见 P0.2）。
- userData 迁移真实启动链路验收脚本化并通过（见 P0.3）。
- 打包身份与更新链路完成配置级检查（见 P0.4）。
- 本地分支整理为 `main` 并清理旧分支（见 P1.1）。
- 有效文档中的旧路径已清理（见 P1.2）。
- GitHub Actions 增加 Desktop Release Gate，上游绑定 workflow 已删除（见 P1.3）。
- 版本/发布策略与安全报告渠道已明确（见 P1.4，`docs/ravel-release.md` 与 `SECURITY.md`）。

## P0：首次正式发布前必须完成

### 1. 运行真实 Electron 打包与 smoke test

状态：已完成（2026-08-25，Windows win-unpacked）。

执行：

```bash
npm run --workspace @ravel/desktop build:renderer
NODE_OPTIONS=--use-system-ca npm run --workspace @ravel/desktop package:dir   # 企业代理 TLS 拦截环境需要 --use-system-ca
npm run --workspace @ravel/desktop electron:smoke
```

验收结果：

- Windows 可执行文件为 `Ravel Desktop.exe`。
- `resources/ravel-runtime` 存在；`resources/ravel-runtime/.pi/extensions` 存在。
- coding-agent runtime 的 `dist` 存在。
- Worker handshake、DOM probe 和自动退出信号全部成功，退出码 0。
- smoke test 使用临时 userData（`mkdtempSync`），不污染真实用户目录。
- 失败时输出 stdout/stderr 尾部与缺失信号清单。

### 2. 补齐 Ravel 系统协议注册

状态：已实现并通过单元测试（2026-08-25）。

实现内容：

- `electron/deep-links.js`：deep link 解析（协议白名单、参数长度/控制字符校验）与注册策略。
- 打包产物默认注册 `ravel://`（`app.setAsDefaultProtocolClient`）；开发模式需 `RAVEL_AUTOTEST` 未设且 `RAVEL_REGISTER_PROTOCOL=1` 显式开启；自动化 smoke 一律跳过注册，避免污染运行机器。
- macOS 走 `open-url` 事件（窗口就绪前入队，创建后 flush）；Windows/Linux 冷启动走 argv 解析、热启动走 `second-instance` 转发到已有窗口。
- 单实例转发支持 workspace 切换与会话加载；非法链接静默忽略。
- 测试覆盖 workspace/session/非法参数三类解析与注册策略矩阵（`test/deep-links.test.mjs`）。

保留：`omega://` 作为旧版本兼容入口。

### 3. 完成真实用户数据迁移验收

状态：自动化验收完成（2026-08-25，`npm run --workspace @ravel/desktop migration:smoke`，15/15 通过）。对个人真实 profile 的最终人工确认留待发布前抽查。

已验证（合成旧目录 + 两次真实打包启动）：

- 启动后创建 `userData/ravel`；`workspaces.json`、`desktop-settings.json`、`credentials.bin.json` 和 `event-cache` 可读取。
- credentials blob 字节不变（sha256 对比）。
- 原 `userData/omega` 目录在两次启动后均未被删除或改写（整树哈希对比）。
- 已存在 `userData/ravel` 时第二次启动不重复迁移，marker 不被改写。

### 4. 检查生产打包身份和更新链路

状态：配置级检查完成（2026-08-25）；真实更新链路按发布策略推迟到首个正式版。

结论：

- `appId` 为 `com.ravel.desktop`；产品名 `Ravel Desktop`；artifact 名 `ravel-desktop-*`。
- updater 核心未被接线：首版前不配置 feed URL（避免指向不存在的发布源），下载/校验/临时文件清理逻辑由离线测试覆盖。
- 更新 manifest、发布目录和 smoke 脚本无旧 Omega release 路径依赖；`OMEGA_*` 环境变量 fallback 属于刻意保留的兼容标识。
- Windows 目标为 unpacked `dir`（NSIS 被 release gate 禁止）；macOS/Linux 目标待 CI 矩阵与签名方案确定后启用。

## P1：仓库正式运营前完成

### 5. 将本地开发分支切换为 main

状态：已完成（2026-08-25）。`feat/omega-runtime-foundation` 已改名为 `main` 并跟踪 `origin/main`；过期的本地 `main` 与残留远程追踪引用已删除。

### 6. 清理当前有效文档中的旧路径

状态：已完成（2026-08-25）。

- `apps/ravel-desktop/docs/system_design.md` 与 `implementation-status.md` 已更新为 Ravel 身份与路径。
- 带日期的审查报告（code-review / deep-review / frontend-backend-optimization 等）作为审计证据保留原始路径不动。

以下内容继续保留为兼容标识：

- `OMEGA_*` 环境变量 fallback、`omega://` deep link、`window.omega`、`omega:*` IPC channel。
- Pi runtime 包名和 `.pi` 目录。

### 7. 增加 CI 发布门禁

状态：已完成（2026-08-25）。

`.github/workflows/desktop-release-gate.yml`：

- Linux runner 上运行根目录 `npm run check`、`@ravel/desktop` 测试与 typecheck（main + renderer）。
- 构建 renderer，执行离线 release gate。
- 独立 job 在具备 Electron 构建环境的 runner 上构建 Pi runtime、打包 unpacked 产物并跑 electron smoke 与 migration smoke。
- 拒绝任何被 git 跟踪的 `release/`、`dist/`、`node_modules` 文件。

已删除上游绑定的 workflow：`build-binaries.yml`（Pi npm 发布）、`publish-model-catalog.yml`（发布到上游 R2）、`issue-analysis.yml`。通用检查类（ci、pr-gate、issue 门禁类、npm-audit）保留。

### 8. 完善版本、发布和仓库说明

状态：已完成（2026-08-25），决策记录在 `docs/ravel-release.md`。

- 版本策略：桌面版本号唯一来源为 `@ravel/desktop` 的 `version`，当前 `0.1.0`，首版前用 `0.x`。
- 分发：仅 GitHub Releases；不发布 npm 包；开发未完成期间不发布安装包或 exe Release。
- 首发平台 Windows；macOS/Linux 后续启用。
- 自动更新在首版前不接入 feed。
- 用户数据迁移说明与回滚说明见 `docs/ravel-release.md`。
- 安全报告渠道改为本仓库 GitHub 私密漏洞报告（`SECURITY.md`），不再使用上游联系邮箱。

## P2：后续架构独立化

### 9. 建立 `@ravel/runtime` facade

当前桌面端仍直接依赖：

```text
@earendil-works/pi-coding-agent
```

第一步不应立即重写 Pi runtime，而应新增：

```text
packages/ravel-runtime/
```

让桌面端依赖稳定的 Ravel API：

```text
apps/ravel-desktop
        ↓
@ravel/runtime
        ↓
@earendil-works/pi-coding-agent
```

建议先抽象：

- session 创建、恢复和销毁。
- prompt、steering、follow-up 和 abort。
- worker handshake 和 runtime health。
- model/provider 查询。
- transcript 与 event 投影。

### 10. 逐步内部化核心 Agent runtime

在 facade 稳定后，再评估拆分：

```text
packages/ravel-agent-core/
packages/ravel-protocol/
packages/ravel-provider/
packages/ravel-migration/
```

只有实际拥有明确产品差异的模块才应 fork 或重命名。Pi TUI、协议和底层 provider 等组件应按使用情况逐个处理，不要一次性重命名整个 Pi workspace 依赖图。

### 11. 建立独立迁移与兼容测试包

参考 Kimi Code 的 `migration-legacy` 思路，将兼容逻辑集中到 Ravel 自有包中，覆盖：

- Omega → Ravel desktop data migration。
- 旧 `.pi` session/config compatibility。
- 旧 deep link compatibility。
- 旧环境变量 fallback。
- 未来 package/runtime schema migration。

### 12. 评估独立分发形态

当前产品是 Electron desktop。后续可以评估：

- portable desktop 包。
- 安装包和自动更新。
- 独立 Ravel CLI。
- ACP 或其他自动化集成入口。
- 无 Node.js 环境的 native/single-binary 方案。

这些属于产品路线，不应与当前迁移稳定性工作混在同一个提交中。

## 暂不建议做的事情

在兼容迁移完成前，不建议：

- 删除 `.pi` 目录或重命名 Pi session 格式。
- 直接删除 `omega://`、`OMEGA_*`、`window.omega` 或 `omega:*`。
- 一次性重命名所有 `@earendil-works/pi-*` 包。
- 删除上游 Pi/Mario Zechner 版权和 MIT 声明。
- 将 credentials 解密后重新生成新的不兼容 blob。
- 把 Electron renderer 的 filesystem 或 Node 权限重新打开。
- 将 release、dist、node_modules 等生成物提交到 Git。

## 推荐执行顺序

```text
[x] P0.1 真实 Electron 打包与 smoke test          （2026-08-25 完成）
[x] P0.2 ravel:// 系统协议注册和第二实例转发      （2026-08-25 完成）
[x] P0.3 真实 userData 迁移验收                   （2026-08-25 完成）
[x] P0.4 生产更新链路和跨平台打包验证             （配置级完成；真实更新链路随首版）
[x] P1.1 本地分支整理为 main                      （2026-08-25 完成）
[x] P1.2 清理当前有效文档中的旧路径               （2026-08-25 完成）
[x] P1.3 增加 CI 发布门禁                         （2026-08-25 完成）
[x] P1.4 完善版本与发布说明                       （2026-08-25 完成）
[ ] P2.1 建立 @ravel/runtime facade
[ ] P2.2 内部化 Agent runtime
[ ] P2.3 独立迁移包和兼容测试
[ ] P2.4 评估 CLI/native 分发
```
