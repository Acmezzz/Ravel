import * as React from "react";
import { Bot, Search, Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip";
import { useAppStore } from "../store/useAppStore";
import type { LucideIcon } from "lucide-react";

interface RailItem {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Momentary action (opens an overlay) rather than a persistent surface. */
  run: () => void;
}

/**
 * The shell's activity rail (48px, single instance).
 *
 * It used to be duplicated twice over: this rail plus the legacy `LeftNav` and
 * the collapsed `RightPanel` icon strip all rendered at once (two icon
 * columns), and — worse — three of its items mirrored the surface tabs that
 * live in the title bar, so 对话/IDE/Histos appeared in two places at once and
 * the two copies could disagree about which surface was active.
 *
 * Surface navigation is owned exclusively by `ShellSurfaceTabs` in the title
 * bar. This rail only carries actions that have no other home: search,
 * resources, settings.
 */
export function ShellRail(): React.ReactElement {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const items: RailItem[] = [
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
          const button = (
            <button
              key={item.key}
              type="button"
              className="ravel-rail-item"
              data-nav-key={item.key}
              aria-label={item.hint ? `${item.label}（${item.hint}）` : item.label}
              onClick={item.run}
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
