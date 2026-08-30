import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { createId } from "../../lib/uid";

/** A terminal surface backed by one isolated PTY session. Output stays in xterm, not Zustand. */
export function TerminalPanel(): React.ReactElement {
  const t = useT();
  const cwd = useAppStore((state) => state.agent?.cwd ?? "");
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !cwd) return;

    // 从 CSS 变量读取终端主题色，支持深浅模式切换
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--ravel-bg-code").trim() || "#1e1e1e";
    const fg = styles.getPropertyValue("--ravel-text").trim() || "#e0e0e0";
    const cursor = styles.getPropertyValue("--ravel-accent").trim() || "#89ABE3";
    const border = styles.getPropertyValue("--ravel-border").trim() || "#3a3836";

    const sessionId = createId("terminal");
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--ravel-font-mono)",
      fontSize: 12,
      theme: {
        background: bg,
        foreground: fg,
        cursor: cursor,
        cursorAccent: bg,
        selectionBackground: styles.getPropertyValue("--ravel-selection").trim() || "rgba(137, 171, 227, 0.28)",
        black: border,
        brightBlack: styles.getPropertyValue("--ravel-text-dim").trim() || "#8C8983",
        red: styles.getPropertyValue("--ravel-danger").trim() || "#C0504A",
        brightRed: styles.getPropertyValue("--ravel-danger").trim() || "#C0504A",
        green: styles.getPropertyValue("--ravel-success").trim() || "#3E8E5A",
        brightGreen: styles.getPropertyValue("--ravel-success").trim() || "#3E8E5A",
        yellow: styles.getPropertyValue("--ravel-warning").trim() || "#B07D2E",
        brightYellow: styles.getPropertyValue("--ravel-warning").trim() || "#B07D2E",
        blue: cursor,
        brightBlue: styles.getPropertyValue("--ravel-accent-strong").trim() || "#4F7CC4",
        magenta: styles.getPropertyValue("--ravel-chart-5").trim() || "#C9D9F0",
        brightMagenta: styles.getPropertyValue("--ravel-chart-5").trim() || "#C9D9F0",
        cyan: styles.getPropertyValue("--ravel-info").trim() || "#4F7CC4",
        brightCyan: styles.getPropertyValue("--ravel-info").trim() || "#4F7CC4",
        white: fg,
        brightWhite: fg,
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      fitAddon.fit();
      void ipc.ptyResize({ sessionId, cols: terminal.cols, rows: terminal.rows });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const offData = ipc.onPtyData((data) => {
      if (data.sessionId === sessionId) terminal.write(data.chunk);
    });
    const offExit = ipc.onPtyExit((data) => {
      if (data.sessionId === sessionId) {
        terminal.write(`\r\n[${t("terminal.exited", { code: data.exitCode ?? "unknown" })}]\r\n`);
        setStatus(t("terminal.exited", { code: data.exitCode ?? "unknown" }));
      }
    });
    const offInput = terminal.onData((data) => {
      void ipc.ptyWrite({ sessionId, data });
    });

    let disposed = false;
    void (async () => {
      resize();
      const result = await ipc.ptyCreate({ sessionId, cwd, cols: terminal.cols, rows: terminal.rows });
      if (disposed || result.ok) return;
      setStatus(t("terminal.startFailed", { message: result.message }));
      terminal.write(`\r\n[${result.message}]\r\n`);
    })();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      offData();
      offExit();
      offInput.dispose();
      void ipc.ptyKill({ sessionId });
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, t]);

  return (
    <section className="omega-terminal-panel" aria-label={t("terminal.title")}>
      {!cwd ? <p className="omega-muted-text">{t("terminal.noWorkspace")}</p> : null}
      {status ? <p className="omega-terminal-status" role="status">{status}</p> : null}
      <div ref={hostRef} className="omega-terminal-surface" />
    </section>
  );
}
