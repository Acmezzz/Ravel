import * as React from "react";
import { Code2, MessageSquare, Waypoints } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import type { SurfaceMode } from "../store/useAppStore";
import type { LucideIcon } from "lucide-react";

const SURFACE_TABS: ReadonlyArray<{ mode: SurfaceMode; label: string; hint: string; icon: LucideIcon }> = [
  { mode: "chat", label: "对话", hint: "Ctrl+1", icon: MessageSquare },
  { mode: "ide", label: "IDE", hint: "Ctrl+2", icon: Code2 },
  { mode: "histos", label: "Histos", hint: "Ctrl+3", icon: Waypoints },
];

/**
 * The three product surfaces as one segmented control, living in the centre of
 * the title bar (the design's single cross-surface navigator).
 *
 * It switches only the `surfaceMode` dimension: never `agent.mode` (the Agent
 * profile) and never `layout.rightTab`. Switching surfaces keeps the active
 * session, so moving to IDE and back does not lose transcript state.
 */
export function ShellSurfaceTabs(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  const setSurfaceMode = useAppStore((s) => s.setSurfaceMode);
  return (
    <div className="ravel-seg" role="tablist" aria-label="界面模式" data-surface-tabs>
      {SURFACE_TABS.map((tab) => {
        const active = surfaceMode === tab.mode;
        const Icon = tab.icon;
        return (
          <button
            key={tab.mode}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${tab.label}模式（${tab.hint}）`}
            data-surface-tab={tab.mode}
            data-active={active ? "true" : "false"}
            className="ravel-seg-item"
            onClick={() => setSurfaceMode(tab.mode)}
          >
            <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
