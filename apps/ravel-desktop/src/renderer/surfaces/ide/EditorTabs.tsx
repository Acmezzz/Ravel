/**
 * 任务六：IDE 打开文件标签栏（关闭 / 激活 / 脏标记）。
 * 纯展示组件：tabs / activePath / dirty 与回调均由 IdeSurface 传入。
 */
import * as React from "react";
import { X } from "lucide-react";
import { IconButton } from "../../ui/Button";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface EditorTabsProps {
  tabs: string[];
  activePath: string | null;
  dirty: ReadonlySet<string>;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
}

export function EditorTabs({ tabs, activePath, dirty, onActivate, onClose, onCloseAll }: EditorTabsProps): React.ReactElement {
  if (tabs.length === 0) {
    return (
      <div className="ravel-ide-tabbar" role="tablist" aria-label="打开的编辑器标签">
        <span className="ravel-ide-tabbar-empty">未打开文件</span>
      </div>
    );
  }
  return (
    <div className="ravel-ide-tabbar" role="tablist" aria-label="打开的编辑器标签">
      {tabs.map((path) => {
        const isActive = path === activePath;
        const isDirty = dirty.has(path);
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            className={`ravel-ide-tab${isActive ? " ravel-ide-tab-active" : ""}${isDirty ? " ravel-ide-tab-dirty" : ""}`}
          >
            <button type="button" className="ravel-ide-tab-label" onClick={() => onActivate(path)} title={path}>
              {isDirty ? <span className="ravel-ide-tab-dirty-dot" aria-hidden="true" /> : null}
              {basename(path)}
            </button>
            <IconButton size="sm" label={`关闭 ${basename(path)}`} className="ravel-ide-tab-close" onClick={() => onClose(path)}>
              <X size={13} aria-hidden="true" strokeWidth={1.8} />
            </IconButton>
          </div>
        );
      })}
      <div className="ravel-ide-tabbar-spacer" />
      {tabs.length > 1 ? (
        <IconButton size="sm" label="关闭全部标签" className="ravel-ide-tab-close-all" onClick={onCloseAll}>
          <X size={13} aria-hidden="true" strokeWidth={2} />
        </IconButton>
      ) : null}
    </div>
  );
}