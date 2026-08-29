import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import type { SurfaceMode } from "../store/useAppStore";

const SURFACE_TABS: ReadonlyArray<{ mode: SurfaceMode; label: string }> = [
  { mode: "chat", label: "Chat" },
  { mode: "ide", label: "IDE" },
  { mode: "histos", label: "Histos" },
];

/**
 * Three product-surface tabs (Chat / IDE / Histos). Switches only the `surfaceMode`
 * dimension; it never touches `agent.mode` or the right-panel tab.
 */
export function ShellSurfaceTabs(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  const setSurfaceMode = useAppStore((s) => s.setSurfaceMode);
  return (
    <div className="ravel-shell-tabs" role="tablist" aria-label="任务表面切换" data-surface-tabs>
      {SURFACE_TABS.map((tab) => {
        const active = surfaceMode === tab.mode;
        return (
          <button
            key={tab.mode}
            type="button"
            role="tab"
            aria-selected={active}
            data-surface-tab={tab.mode}
            aria-label={`切换到 ${tab.label} 表面`}
            className={active ? "ravel-shell-tab is-active" : "ravel-shell-tab"}
            onClick={() => setSurfaceMode(tab.mode)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}