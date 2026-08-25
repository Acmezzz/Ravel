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
- 当前桌面测试通过：151/151。
- 当前 renderer typecheck、Electron Node syntax check 和根目录 `npm run check` 已通过。

## P0：首次正式发布前必须完成

### 1. 运行真实 Electron 打包与 smoke test

状态：未在新 Ravel 仓库完成最终验证。

执行：

```bash
npm run --workspace @ravel/desktop build:renderer
npm run --workspace @ravel/desktop package:dir
npm run --workspace @ravel/desktop electron:smoke
```

验收标准：

- Windows 可执行文件为 `Ravel Desktop.exe`。
- `resources/ravel-runtime` 存在。
- `resources/ravel-runtime/.pi/extensions` 存在。
- coding-agent runtime 的 `dist` 存在。
- Worker handshake、DOM probe 和自动退出信号全部成功。
- smoke test 使用临时 userData，不会污染真实用户目录。
- 失败时能输出可定位的 stdout、stderr 和缺失信号。

### 2. 补齐 Ravel 系统协议注册

状态：代码能够解析 `ravel://` 和兼容的 `omega://`，但需要确认并补齐操作系统级注册。

需要实现或验证：

- Windows：注册 `ravel://` 默认协议。
- macOS：处理 `open-url` 事件。
- Linux：处理启动参数中的 deep link。
- 单实例模式下，将第二次启动收到的 deep link 转发到已有窗口。
- 覆盖 workspace、session 和非法参数的测试。
- 保留 `omega://` 作为旧版本兼容入口。

建议使用 Electron 的 `app.setAsDefaultProtocolClient("ravel")`，并把注册逻辑限制在正式打包或明确的开发模式中。

### 3. 完成真实用户数据迁移验收

状态：迁移模块和单元测试已完成，真实 Electron 启动链路尚需验证。

需要验证：

- 旧目录存在时，启动 Ravel 后创建 `userData/ravel`。
- `workspaces.json`、`desktop-settings.json`、`credentials.bin.json` 和 `event-cache` 可读取。
- credentials blob 的字节内容保持不变。
- 原 `userData/omega` 目录不被删除或覆盖。
- 已存在 `userData/ravel` 时不重复迁移。
- 迁移中断或复制失败时不会产生假成功 marker。
- 重启应用后不会重复执行迁移。
- 旧 session 和 workspace 仍可在桌面界面中打开。

### 4. 检查生产打包身份和更新链路

状态：配置已改名，生产验证尚需完成。

需要验证：

- `appId` 为 `com.ravel.desktop`。
- 产品显示名和安装/解压目录均为 Ravel。
- artifact 文件名为 `ravel-desktop-*`。
- updater 的下载、校验和、临时文件清理仍然正常。
- 更新 manifest、发布目录和 smoke 脚本不再依赖旧 Omega release 路径。
- Windows、macOS、Linux 的目标配置与 CI 构建矩阵一致。

## P1：仓库正式运营前完成

### 5. 将本地开发分支切换为 main

当前本地分支仍叫：

```text
feat/omega-runtime-foundation
```

它目前跟踪远程 `origin/main`。建议在确认不再需要旧分支名称后执行：

```bash
git branch -m main
git push -u origin main
```

如远程已有正确的 `main`，不要强制推送；先确认本地和远程提交一致。

### 6. 清理当前有效文档中的旧路径

历史审查报告应保留原始路径，作为审计证据；当前有效文档则应逐步改为 Ravel 路径。

需要检查：

- `apps/ravel-desktop/docs/implementation-status.md`
- `apps/ravel-desktop/docs/system_design.md`
- `apps/ravel-desktop/docs/frontend-backend-optimization-2026-08-24.md`
- CI 和发布说明中的 `apps/omega-desktop`。

以下内容应继续保留为兼容标识，不应贸然删除：

- `OMEGA_*` 环境变量 fallback。
- `omega://` deep link。
- `window.omega`。
- `omega:*` IPC channel。
- Pi runtime 包名和 `.pi` 目录。

### 7. 增加 CI 发布门禁

当前静态检查和单元测试已存在，建议在 GitHub Actions 中增加独立的 Ravel 发布门禁：

- Linux 上运行根目录 `npm run check`。
- 运行 `@ravel/desktop` 测试和 typecheck。
- 构建 renderer。
- 执行离线 release gate。
- 在具备 Electron 构建环境的 runner 上执行 unpacked package smoke test。
- 检查仓库中没有被跟踪的 `release/`、`dist/` 和 node_modules。

### 8. 完善版本、发布和仓库说明

需要明确：

- Ravel 的版本号策略。
- GitHub Release 产物命名。
- 是否发布 npm package、桌面安装包或仅发布 unpacked/portable 包。
- 支持的操作系统和最低 Node/Electron 版本。
- 用户数据迁移说明和回滚说明。
- 安全漏洞报告地址是否仍使用上游 Pi 的联系信息。

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
P0.1 真实 Electron 打包与 smoke test
P0.2 ravel:// 系统协议注册和第二实例转发
P0.3 真实 userData 迁移验收
P0.4 生产更新链路和跨平台打包验证
P1.1 本地分支整理为 main
P1.2 清理当前有效文档中的旧路径
P1.3 增加 CI 发布门禁
P1.4 完善版本与发布说明
P2.1 建立 @ravel/runtime facade
P2.2 内部化 Agent runtime
P2.3 独立迁移包和兼容测试
P2.4 评估 CLI/native 分发
```
