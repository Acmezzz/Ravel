import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ChatSurface } from "../surfaces/chat/ChatSurface";
import { IdeSurface } from "../surfaces/ide/IdeSurface";

function HistosSurfacePlaceholder(): React.ReactElement {
  return (
    <section className="ravel-surface ravel-surface-histos" aria-label="历史数据库表面" data-surface="histos">
      <div className="ravel-surface-placeholder">
        <strong>Histos 表面</strong>
        <p>历史与图谱数据库表面将在任务七落地为占位面板。</p>
      </div>
    </section>
  );
}

/**
 * Sole source of truth for the center-column Surface. It decides purely from
 * `surfaceMode` (product surface) — never from `agent.mode` or `layout.rightTab`.
 * Chat Surface is task 5 (ChatSurface: session sidebar + transcript + composer +
 * context drawer, reusing ChatPanel); IDE is task 6 (IdeSurface: workspace tree +
 * editor tabs + CodeMirror + bottom Diff/Worktree/terminal + search drawer);
 * Histos is a placeholder until 7.
 */
export function SurfaceRouter(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  if (surfaceMode === "ide") return <IdeSurface />;
  if (surfaceMode === "histos") return <HistosSurfacePlaceholder />;
  return <ChatSurface />;
}