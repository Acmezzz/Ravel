import * as React from "react";

/**
 * Middle-column layout host for the active product Surface.
 *
 * A structural wrapper that guarantees the Surface's own scrollable/zoomable
 * subtree always has a bounded, real height: `min-height: 0` lets a flex/grid
 * child shrink rather than blow out the viewport, and `overflow: hidden`
 * keeps the chat virtual list and graph zoom (task 6/7) contained to the column.
 */
export function ShellLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className="ravel-shell-layout"
      data-shell-layout
      style={{ minHeight: 0, minWidth: 0, flex: "1 1 auto", display: "flex", overflow: "hidden" }}
    >
      {children}
    </div>
  );
}