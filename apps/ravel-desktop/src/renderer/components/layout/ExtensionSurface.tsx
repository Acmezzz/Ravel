import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store/useAppStore";

export function ExtensionSurface(): React.ReactElement | null {
  const { sessionId, statuses, widgets } = useAppStore(useShallow((state) => ({ sessionId: state.activeSessionId, statuses: state.extensionStatuses.filter((item) => item.sessionId === state.activeSessionId), widgets: state.extensionWidgets.filter((item) => item.sessionId === state.activeSessionId) })));
  if (!sessionId || (statuses.length === 0 && widgets.length === 0)) return null;
  return <div className="omega-extension-surface">
    {statuses.length > 0 ? <div className="omega-extension-statuses">{statuses.map((status) => <span key={status.key} className="omega-chip omega-extension-status">{status.key}: {status.text}</span>)}</div> : null}
    {widgets.map((widget) => <section key={widget.key} className="omega-extension-widget"><span className="omega-extension-widget-title">{widget.key}</span>{widget.lines.map((line, index) => <div key={`${widget.key}-${index}`} className="omega-extension-widget-line">{line}</div>)}</section>)}
  </div>;
}
