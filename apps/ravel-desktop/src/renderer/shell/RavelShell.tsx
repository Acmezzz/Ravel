import * as React from "react";
import { Workbench } from "../components/layout/Workbench";
import { ShellHeader } from "./ShellHeader";
import { ShellRail } from "./ShellRail";
import { ShellSurfaceTabs } from "./ShellSurfaceTabs";
import { ShellOverlayHost } from "./ShellOverlayHost";

/**
 * Unified Ravel shell — the single top-level composition, providing the app
 * landmark. It lays out, from top to bottom:
 *   - chrome: ShellHeader (frameless title bar + git branch) then ShellSurfaceTabs
 *     (Chat / IDE / Histos), so the three product surfaces are switchable inline;
 *   - a body row of ShellRail (activity rail) beside the Workbench three-column
 *     grid, whose center column is the active Surface (see Workbench);
 *   - the ShellOverlayHost, which owns the modal/overlay layers.
 *
 * It only assembles existing units; each is a composition point extended by
 * later surface tasks. Declaring `<main aria-label>` here gives the window a
 * single stable region for AT users.
 */
export function RavelShell(): React.ReactElement {
  return (
    <main className="ravel-shell" aria-label="Ravel 工作区" data-shell-root>
      <div className="ravel-shell-chrome">
        <ShellHeader />
        <ShellSurfaceTabs />
      </div>
      <div className="ravel-shell-body">
        <ShellRail />
        <div className="ravel-shell-workspace" style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Workbench />
        </div>
      </div>
      <ShellOverlayHost />
    </main>
  );
}