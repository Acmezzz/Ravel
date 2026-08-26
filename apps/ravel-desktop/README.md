# Ravel Desktop

本地优先的 Electron 编码 Agent 工作台。位于 monorepo 的 `apps/ravel-desktop`，作为 npm workspace 成员 `@ravel/desktop`，依赖兼容的 `@earendil-works/pi-coding-agent` runtime。

## 能力

- 主进程只做窗口、IPC、fs/git 特权操作；Agent 跑在 `utilityProcess` Worker 里
- 自动加载 monorepo `.pi/extensions` 下的通用扩展
- React 18 + MUI 5 + Tailwind 三栏工作台：会话、对话、Diff / Worktree
- 安全边界：`contextIsolation`、无 `nodeIntegration`、CSP、路径包含、IPC allowlist、permission profile

## 结构

```
apps/ravel-desktop/
  package.json
  electron/
    main.js             # 窗口 + IPC + 特权操作
    preload.js          # 窄桥 window.omega
    worker.mjs          # utilityProcess 里的 Agent runtime
    agent-bridge.js     # session / 事件投影
  src/renderer/         # React 工作台
  index.html
  scripts/              # sdk-check / release-gate / electron-smoke
  test/                 # Node 测试（IPC、路径、Git、渲染层静态回归）
  docs/                 # 系统设计与审查清单
```

## 运行

在 monorepo 根先 `npm install --ignore-scripts`，再：

```bash
npm start               # 启动桌面端
npm run dev             # Vite watch 渲染层
npm test                # 桌面测试
npm run typecheck
npm run typecheck:renderer
npm run sdk-check       # 无 GUI 的 SDK 冒烟
npm run release:gate    # 离线发布门禁
```

环境变量：`RAVEL_WORKSPACE` 指定工作区，`RAVEL_EXTENSIONS_ROOT` 覆盖扩展目录。

## 注意

- 改 `packages/coding-agent` 后需先在仓库根 `npm run build`，桌面端用的是 `dist/`。
- 打包用 `electron-builder` unpacked `dir`（Windows 不用 NSIS）。开发扩展从 monorepo `.pi/extensions` 加载；打包后从 `extraResources/ravel-runtime/.pi/extensions` 加载。
- 详细设计见 `docs/system_design.md`，审查与修复清单见 `docs/code-review-2026-08-24.md`。
