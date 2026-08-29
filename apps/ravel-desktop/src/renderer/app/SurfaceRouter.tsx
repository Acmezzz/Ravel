import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ChatSurface } from "../surfaces/chat/ChatSurface";

function IdeSurfacePlaceholder(): React.ReactElement {
  return (
    <section className="ravel-surface ravel-surface-ide" aria-label="IDE 工作区" data-surface="ide">
      <div className="ravel-surface-placeholder">
        <strong>IDE 表面</strong>
        <p>IDE 编辑器工作区将在任务六落地为占位面板。</p>
      </div>
    </section>
  );
}

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
 * context drawer, reusing ChatPanel); IDE / Histos are placeholders until 6/7.
 */
export function SurfaceRouter(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  if (surfaceMode === "ide") return <IdeSurfacePlaceholder />;
  if (surfaceMode === "histos") return <HistosSurfacePlaceholder />;
  return <ChatSurface />;
}