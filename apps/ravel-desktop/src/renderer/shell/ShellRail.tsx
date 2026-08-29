import * as React from "react";
import {
  Bot,
  FileSearch,
  Files,
  History,
  MessageCircle,
  Settings,
  Waypoints,
} from "lucide-react";

/**
 * Activity rail (chat / history / files / graph / search / extensions / settings).
 * Each item is a button keyed by `data-nav-key` and flagged active with `data-active`.
 * This is a declared composition point: concrete panels for each key are wired in
 * by later surface tasks; switching still drives the store.
 */
const RAIL_ITEMS: ReadonlyArray<{ key: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { key: "chat", label: "Chat 表面", icon: MessageCircle },
  { key: "history", label: "会话历史", icon: History },
  { key: "files", label: "文件", icon: Files },
  { key: "graph", label: "图谱", icon: Waypoints },
  { key: "search", label: "搜索", icon: FileSearch },
  { key: "extensions", label: "扩展", icon: Bot },
  { key: "settings", label: "设置", icon: Settings },
];

export function ShellRail(): React.ReactElement {
  const [activeKey, setActiveKey] = React.useState<string>("chat");
  return (
    <nav className="ravel-shell-rail" aria-label="活动栏">
      {RAIL_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={active ? "ravel-shell-rail-item is-active" : "ravel-shell-rail-item"}
            data-nav-key={item.key}
            data-active={active ? "true" : "false"}
            aria-label={item.label}
            aria-pressed={active}
            onClick={() => setActiveKey(item.key)}
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}