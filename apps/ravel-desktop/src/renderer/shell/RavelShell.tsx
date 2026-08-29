import * as React from "react";
import { ShellHeader } from "./ShellHeader";
import { ShellRail } from "./ShellRail";
import { ShellLayout } from "./ShellLayout";
import { ShellOverlayHost } from "./ShellOverlayHost";
import { SurfaceBoundary } from "./SurfaceBoundary";
import { SurfaceRouter } from "../app/SurfaceRouter";
import { useAppStore } from "../store/useAppStore";

/**
 * The one and only application shell.
 *
 * Before this refactor the shell was a thin wrapper *around* the legacy
 * `Workbench`, so both rendered their own chrome at once: two header bars, two
 * icon rails and three stacked session lists. `RavelShell` now owns the layout
 * directly:
 *
 *   ShellHeader (44px: identity · surface tabs · agent controls · window btns)
 *   body: ShellRail (48px) | ShellLayout → SurfaceRouter → Chat | IDE | Histos
 *   ShellOverlayHost (palette, branch tree, file viewer, extension UI, trust)
 *
 * Each Surface renders its own side panels (session list, context drawer,
 * workspace tree, inspector), so nothing here duplicates them. Focus mode
 * removes the rail; below the compact breakpoint the rail stays but surfaces
 * collapse their secondary columns through CSS.
 */
export function RavelShell(): React.ReactElement {
  const focusMode = useAppStore((s) => s.layout.focusMode);
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  return (
    <main className="ravel-shell" aria-label="Ravel 工作区" data-shell-root>
      <ShellHeader />
      <div className="ravel-shell-body" data-focus-mode={focusMode ? "true" : "false"}>
        {focusMode ? null : <ShellRail />}
        <ShellLayout>
          <SurfaceBoundary resetKey={surfaceMode}>
            <SurfaceRouter />
          </SurfaceBoundary>
        </ShellLayout>
      </div>
      <ShellOverlayHost />
    </main>
  );
}
