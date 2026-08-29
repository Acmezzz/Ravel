import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { TitleBar } from "../components/layout/TitleBar";

/**
 * Unified shell title bar. Bridges the existing `TitleBar` chrome (Ravel monogram,
 * workspace label, window controls) — which already holds the correct
 * `WebkitAppRegion: drag` affordances and CSP-safe guarded IPC calls — and adds a
 * Git branch indicator. It intentionally reuses the frameless title bar visual so
 * the window chrome stays consistent and unbroken.
 */
export function ShellHeader(): React.ReactElement {
  const branch = useAppStore((s) => s.gitSnapshot?.branch ?? null);
  return (
    <div className="ravel-shell-header" data-shell-header>
      <TitleBar />
      {branch ? (
        <div className="ravel-shell-branch" title={`当前分支：${branch}`}>
          <span className="ravel-shell-branch-label" aria-hidden="true">⑂</span>
          <span className="ravel-shell-branch-name">{branch}</span>
        </div>
      ) : null}
    </div>
  );
}