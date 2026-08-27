import * as React from "react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";

/** Custom frameless title bar; window controls remain guarded IPC calls. */
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function TitleBar(): React.ReactElement {
  const agent = useAppStore((state) => state.agent);
  const [maximized, setMaximized] = React.useState(false);
  React.useEffect(() => { void ipc.isMaximized().then((res) => { if (res.ok) setMaximized(res.data.maximized); }); return ipc.onWindowStateChanged((data) => setMaximized(Boolean(data?.maximized))); }, []);
  const workspaceLabel = React.useMemo(() => { const cwd = agent?.cwd; if (!cwd) return ""; const parts = cwd.split(/[\\/]/).filter(Boolean); return parts[parts.length - 1] ?? cwd; }, [agent?.cwd]);
  return <div className="omega-titlebar" style={dragStyle}>
    <div className="omega-titlebar-brand"><span className="omega-titlebar-mark">∞</span><strong>RAVEL DESKTOP</strong></div>{workspaceLabel ? <><span className="omega-titlebar-separator">·</span><span className="omega-titlebar-workspace">{workspaceLabel}</span></> : null}<div className="omega-titlebar-spacer" />
    <div className="omega-titlebar-controls" style={noDragStyle}><Tooltip><TooltipTrigger asChild><IconButton size="sm" label="最小化窗口" className="omega-titlebar-control" onClick={() => void ipc.minimize()}>−</IconButton></TooltipTrigger><TooltipContent>最小化</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><IconButton size="sm" label={maximized ? "向下还原窗口" : "最大化窗口"} className="omega-titlebar-control" onClick={() => void ipc.toggleMaximize()}>{maximized ? "❐" : "□"}</IconButton></TooltipTrigger><TooltipContent>{maximized ? "还原" : "最大化"}</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><IconButton size="sm" label="关闭窗口" className="omega-titlebar-control omega-titlebar-close" onClick={() => void ipc.closeWindow()}>×</IconButton></TooltipTrigger><TooltipContent>关闭</TooltipContent></Tooltip></div>
  </div>;
}
