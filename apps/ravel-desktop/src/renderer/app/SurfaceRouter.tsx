import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ChatSurface } from "../surfaces/chat/ChatSurface";
import { IdeSurface } from "../surfaces/ide/IdeSurface";
import { HistosSurface } from "../surfaces/histos/HistosSurface";

/**
 * Sole source of truth for the center-column Surface. It decides purely from
 * `surfaceMode` (product surface) — never from `agent.mode` or `layout.rightTab`.
 * Chat Surface is task 5 (ChatSurface: session sidebar + transcript + composer +
 * context drawer, reusing ChatPanel); IDE is task 6 (IdeSurface: workspace tree +
 * editor tabs + CodeMirror + bottom Diff/Worktree/terminal + search drawer);
 * Histos is task 7 (HistosSurface: toolbar + graph workspace + inspector +
 * flow drawer, reusing GraphCanvas/React Flow + ELK worker).
 */
export function SurfaceRouter(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  if (surfaceMode === "ide") return <IdeSurface />;
  if (surfaceMode === "histos") return <HistosSurface />;
  return <ChatSurface />;
}