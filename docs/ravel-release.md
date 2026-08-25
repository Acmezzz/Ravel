# Ravel 发布策略

更新时间：2026-08-25。本文件明确 Ravel Desktop 的版本、产物和分发决策；与 `docs/ravel-roadmap.md` 配套。

## 版本号

- 单包版本策略：`apps/ravel-desktop/package.json` 的 `version` 是桌面产品的唯一版本号（当前 `0.1.0`）。上游 Pi 包版本独立演进，不代表 Ravel 产品版本。
- 首个正式版前使用 `0.x`；破坏性变更在 `0.x` 内升 minor。进入 `1.0.0` 后遵循 semver：breaking 升 major，功能升 minor，修复升 patch。
- electron-builder 的 artifact 文件名为 `ravel-desktop-${version}-${os}-${arch}.${ext}`，与版本号自动对齐。

## 分发形态

- 只通过 GitHub Releases 分发，不发布任何 npm 包。
- 当前开发未完成，暂不发布任何安装包或 exe Release；仓库保持"可本地打包验证"状态（见下）。
- 首个发布平台为 Windows。`win.target` 为 unpacked `dir`，NSIS 被 `scripts/release-gate.mjs` 显式禁止；引入安装器时需要同步修改该门禁并评审签名方案（Authenticode 未配置前不发布安装器）。
- macOS / Linux 打包目标已在配置中预留（dmg/AppImage），待 CI 矩阵与签名/公证方案确定后再启用发布。

## 自动更新

- 首版发布前 updater 不接入任何 feed：`electron/updater-service.js` 仅提供 manifest 校验、HTTPS-only 下载、SHA-256/size 校验、临时文件清理等离线核心，由 `test/updater.test.mjs` 覆盖。
- 首次正式发布时再配置 feed URL（预期指向 GitHub Releases 的 latest manifest）；在那之前不写死任何发布地址，避免指向不存在的发布源。

## 本地打包验证（当前门禁）

```bash
npm run build:offline                                   # 构建 Pi runtime 包
npm run --workspace @ravel/desktop build:renderer       # 渲染层产物
npm run --workspace @ravel/desktop package:dir          # unpacked 打包（Windows 下需 NODE_OPTIONS=--use-system-ca 时仅限企业代理 TLS 拦截环境）
npm run --workspace @ravel/desktop electron:smoke       # 真实启动 smoke
npm run --workspace @ravel/desktop migration:smoke      # Omega -> Ravel 数据迁移验收
```

CI 门禁见 `.github/workflows/desktop-release-gate.yml`（repo checks、桌面测试、typecheck、renderer 构建、离线 release gate、Linux runner 上的真实打包 smoke 与迁移 smoke）。

## 用户数据迁移与回滚

- Ravel 启动时将旧版 `%APPDATA%/Ravel Desktop/omega`（workspaces.json、desktop-settings.json、credentials.bin.json、event-cache）复制到同目录的 `ravel/`，并写入 `.migration.json` marker。
- credentials 加密 blob 按原样复制，不解密、不重加密；字节一致性由 `migration:smoke` 的 sha256 对比保证。
- 回滚方式：旧 `omega/` 目录永不删除或改写，因此可以直接回退到旧版本应用继续使用。若需强制重新迁移，删除新生成的 `ravel/` 目录后重启即可（迁移只在 `ravel/` 不存在且 `omega/` 存在时执行一次）。
