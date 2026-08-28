<p align="center">
  <strong>Ravel</strong>
</p>

# Ravel

Ravel 是一套本地优先的编码 Agent 产品：Electron 桌面端 + 基于 Pi agent harness 的运行时。

本仓库是基于 [earendil-works/pi-mono](https://github.com/badlogic/pi-mono) 的独立 Ravel 产品仓库。上游 Pi 包仍在 `packages/` 中维护；产品入口是 `@ravel/desktop`。

## 产品入口

* **[@ravel/desktop](apps/ravel-desktop)**：Electron 桌面工作台（React 19 + Base UI + Tailwind 4）。主进程沙箱、utilityProcess Worker、Pi JSONL session 权威源。
* **[@earendil-works/pi-coding-agent](packages/coding-agent)**：编码 Agent CLI / SDK（桌面端 Worker 的运行时）
* **[@earendil-works/pi-agent-core](packages/agent)**：Agent runtime（工具调用与状态）
* **[@earendil-works/pi-ai](packages/ai)**：多供应商 LLM API

桌面端安全红线：`contextIsolation`、无 `nodeIntegration`、CSP `script-src 'self'`、路径包含检查、IPC allowlist。详见 [apps/ravel-desktop/docs/system_design.md](apps/ravel-desktop/docs/system_design.md)。

## 上游 Pi 包

| Package | Description |
|---------|-------------|
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library |

上游文档：[pi.dev](https://pi.dev)。Pi 本身不内置桌面权限系统；Ravel Desktop 在 Electron 层补了 permission profile、workspace allowlist 和 Project Trust。

## Development

```bash
npm install --ignore-scripts
npm run build
npm run check
./test.sh
./pi-test.sh

# Desktop
npm start --workspace=@ravel/desktop
npm test --workspace=@ravel/desktop
npm run typecheck --workspace=@ravel/desktop
```

桌面端开发说明见 [apps/ravel-desktop/README.md](apps/ravel-desktop/README.md)。

## Contributing

见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)。安全报告见 [SECURITY.md](SECURITY.md)。

## License

MIT。上游 Pi 版权归 Mario Zechner；Ravel 桌面产品层版权见 [LICENSE](LICENSE)。
