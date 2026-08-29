import * as React from "react";
import {
  Bot,
  Files,
  MessageSquare,
  Settings,
  Search,
  Waypoints,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip";
import { useAppStore } from "../store/useAppStore";
import type { SurfaceMode } from "../store/useAppStore";
import type { LucideIcon } from "lucide-react";

interface RailItem {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** The surface this item represents, when it is one of the three. */
  surface?: SurfaceMode;
  /** Momentary action (opens an overlay) rather than a persistent surface. */
  run?: () => void;
}

/**
 * The shell's activity rail (48px, single instance).
 *
 * It used to be duplicated: this rail plus the legacy `LeftNav` and the
 * collapsed `RightPanel` icon strip all rendered at once, which is why the app
 * showed two icon columns. The rail is now the only vertical navigator, and
 * each item drives real store state instead of local component state — the
 * three surface keys set `surfaceMode`, the rest open their overlay.
 */
export function ShellRail(): React.ReactElement {
  const surfaceMode = useAppStore((s) => s.surfaceMode);
  const setSurfaceMode = useAppStore((s) => s.setSurfaceMode);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const items: RailItem[] = [
    { key: "chat", label: "对话", hint: "Ctrl+1", icon: MessageSquare, surface: "chat" },
    { key: "files", label: "文件工作区", hint: "Ctrl+3", icon: Files, surface: "ide" },
    { key: "graph", label: "Histos 图谱", hint: "Ctrl+4", icon: Waypoints, surface: "histos" },
    {
      key: "search",
      label: "搜索 / 命令面板",
      hint: "Ctrl+K",
      icon: Search,
      run: () => setCommandPaletteOpen(true),
    },
    {
      key: "extensions",
      label: "扩展与资源",
      hint: "",
      icon: Bot,
      run: () => useAppStore.getState().setResourceCenterOpen(true),
    },
    {
      key: "settings",
      label: "设置",
      hint: "Ctrl+,",
      icon: Settings,
      run: () => setSettingsOpen(true),
    },
  ];

  return (
    <nav className="ravel-rail" aria-label="主导航" data-region="activityRail">
      <div className="ravel-rail-group">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.surface ? surfaceMode === item.surface : false;
          const button = (
            <button
              key={item.key}
              type="button"
              className="ravel-rail-item"
              data-nav-key={item.key}
              data-active={active ? "true" : "false"}
              aria-label={item.hint ? `${item.label}（${item.hint}）` : item.label}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (item.surface) setSurfaceMode(item.surface);
                else item.run?.();
              }}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          );
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">
                {item.hint ? `${item.label} · ${item.hint}` : item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="ravel-rail-footer">
        <span className="ravel-rail-rule" aria-hidden="true" />
        <button
          type="button"
          className="ravel-rail-kbd"
          aria-label="打开命令面板"
          onClick={() => setCommandPaletteOpen(true)}
        >
          ⌘K
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="ravel-rail-avatar" aria-label="账户设置" onClick={() => setSettingsOpen(true)}>
              YF
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">账户与设置</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}
