# Ravel 发布策略

更新日期：2026-08-28
状态：**有效。** 产品切片不在本文。下一刀认 [`ravel-histos-next-cycle.md`](./ravel-histos-next-cycle.md)。

本文件明确 Ravel Desktop 的版本、产物和分发决策。不发任何 npm 包。开发未完成前不发安装包或 exe Release。

---

## 版本号

- 单包版本策略：`apps/ravel-desktop/package.json` 的 `version` 是桌面产品的唯一版本号（当前 `0.1.0`）。上游 Pi 包版本独立演进，不代表 Ravel 产品版本。
- 首个正式版前使用 `0.x`；破坏性变更在 `0.x` 内升 minor。进入 `1.0.0` 后遵循 semver：breaking 升 major，功能升 minor，修复升 patch。
- electron-builder 的 artifact 文件名为 `ravel-desktop-${version}-${os}-${arch}.${ext}`，与版本号自动对齐。

---

## 分发形态

- 只通过 GitHub Releases 分发，不发布任何 npm 包。
- 当前开发未完成，暂不发布任何安装包或 exe Release；仓库保持「可本地打包验证」状态。
- 首个发布平台为 Windows。`win.target` 为 unpacked `dir`，NSIS 被 `scripts/release-gate.mjs` 显式禁止；引入安装器时需要同步修改该门禁并评审签名方案（Authenticode 未配置前不发布安装器）。
- macOS / Linux 打包目标已在配置中预留（dmg/AppImage），待 CI 矩阵与签名/公证方案确定后再启用发布。

---

## 打包约束（当前必须满足）

```yaml
asar: true
asarUnpack:
  - node_modules/node-pty/**
npmRebuild: false
```

必须解包整个 `node-pty` 树。只解包 `*.node` 不够：Windows ConPTY 还要 `conoutSocketWorker.js` 与 `conpty_console_list_agent.js`，它们不能从 asar 里 fork。

原生模块按 Electron 44.0.0 重建（`rebuild:native` 用 `electron-rebuild -v 44.0.0`；迁移前基线为 Electron 43.4.1 / ABI 148）。T5 已落地，壳锁定在 44.0.0；下一次壳升级仍是独立切片，不混进其它 major。

企业代理 TLS 拦截导致 electron-builder 拉 Electron zip 失败时，使用已安装的本地发行：

```text
--config.electronDist=../../node_modules/electron/dist
```

打包目录被占用（Windows 上 hung Electron 会 EBUSY `release/`）时，写到未锁定的输出目录，不要杀别人的进程来腾路径。

---

## 自动更新

- 首版发布前 updater 不接入任何 feed：`electron/updater-service.js` 仅提供 manifest 校验、HTTPS-only 下载、SHA-256/size 校验、临时文件清理等离线核心，由 `test/updater.test.mjs` 覆盖。
- 首次正式发布时再配置 feed URL（预期指向 GitHub Releases 的 latest manifest）；在那之前不写死任何发布地址。

---

## 本地打包验证

```bash
npm run build:offline
npm run --workspace @ravel/desktop build:renderer
npm run --workspace @ravel/desktop package:dir
npm run --workspace @ravel/desktop electron:smoke
RAVEL_PTY_SMOKE=1 npm run --workspace @ravel/desktop electron:smoke
npm run --workspace @ravel/desktop migration:smoke
```

PTY smoke 必须观察到真实 child exit code 0，以及 spawn / write / resize / kill。超时后杀进程不算成功。`RAVEL_RELEASE_DIR` 可覆盖默认 `release/win-unpacked`。

CI 门禁见 `.github/workflows/desktop-release-gate.yml`。Playwright Electron E2E 已在 Histos 计划 P7 落地（`apps/ravel-desktop/e2e/`，`p7:e2e`）；并入发布门禁时不替代上述 smoke。

---

## 用户数据迁移与回滚

- Ravel 启动时将旧版 `%APPDATA%/Ravel Desktop/omega`（workspaces.json、desktop-settings.json、credentials.bin.json、event-cache）复制到同目录的 `ravel/`，并写入 `.migration.json` marker。
- credentials 加密 blob 按原样复制，不解密、不重加密；字节一致性由 `migration:smoke` 的 sha256 对比保证。
- Histos 查找库在 `userData/ravel/histos/<workspaceId>/index.sqlite`，可删。durable artifacts 在同目录 `artifacts/`。删 sqlite 不得删 artifacts。
- 回滚方式：旧 `omega/` 目录永不删除或改写。若需强制重新迁移，删除新生成的 `ravel/` 目录后重启（迁移只在 `ravel/` 不存在且 `omega/` 存在时执行一次）。
