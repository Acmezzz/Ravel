import * as React from "react";
import { useAppStore } from "../../store/useAppStore";

/**
 * Subscribes to stable store references only and derives the per-session
 * slices with `useMemo`. An object-returning shallow selector produced a new
 * snapshot on every render, which looped forever (React #185) and crashed the
 * renderer before the workbench could mount.
 */
export function ExtensionSurface(): React.ReactElement | null {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const allStatuses = useAppStore((state) => state.extensionStatuses);
  const allWidgets = useAppStore((state) => state.extensionWidgets);
  const statuses = React.useMemo(() => allStatuses.filter((item) => item.sessionId === sessionId), [allStatuses, sessionId]);
  const widgets = React.useMemo(() => allWidgets.filter((item) => item.sessionId === sessionId), [allWidgets, sessionId]);
  if (!sessionId || (statuses.length === 0 && widgets.length === 0)) return null;
  return <div className="omega-extension-surface">
    {statuses.length > 0 ? <div className="omega-extension-statuses">{statuses.map((status) => <span key={status.key} className="omega-chip omega-extension-status">{status.key}: {status.text}</span>)}</div> : null}
    {widgets.map((widget) => <section key={widget.key} className="omega-extension-widget"><span className="omega-extension-widget-title">{widget.key}</span>{widget.lines.map((line, index) => <div key={`${widget.key}-${index}`} className="omega-extension-widget-line">{line}</div>)}</section>)}
  </div>;
}
