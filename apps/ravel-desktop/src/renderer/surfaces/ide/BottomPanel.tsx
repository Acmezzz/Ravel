import * as React from "react";
import { ChevronDown, ChevronUp, TerminalSquare } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { TerminalPanel } from "../../components/panels/TerminalPanel";

export function BottomPanel(): React.ReactElement {
  const [open, setOpen] = React.useState(true);

  return (
    <section className={open ? "ravel-ide-bottom is-open" : "ravel-ide-bottom"} aria-label="终端面板">
      <div className="ravel-ide-bottom-header">
        <div className="ravel-ide-bottom-title">
          <TerminalSquare size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>终端</span>
          <span className="ravel-ide-bottom-caption">工作区 Shell</span>
        </div>
        <div className="ravel-ide-bottom-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton size="sm" label={open ? "收起终端" : "展开终端"} onClick={() => setOpen((value) => !value)}>
                {open ? <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" /> : <ChevronUp size={14} strokeWidth={1.8} aria-hidden="true" />}
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{open ? "收起终端" : "展开终端"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {open ? (
        <div className="ravel-ide-bottom-body">
          <TerminalPanel />
        </div>
      ) : null}
    </section>
  );
}
