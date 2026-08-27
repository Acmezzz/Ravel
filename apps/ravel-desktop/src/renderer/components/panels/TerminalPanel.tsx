import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";

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

    const sessionId = `terminal-${crypto.randomUUID()}`;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 12,
      theme: { background: "#0d0e12", foreground: "#f3f0ea", cursor: "#e8b44a" },
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
