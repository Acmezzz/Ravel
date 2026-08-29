/**
 * IDE 打开文件标签栏。
 *
 * 纯展示组件：tabs / activePath 与回调由 IdeSurface 传入。没有脏点 —— 编辑面是只读
 * 阅读器，文件改动由 Agent 完成，因此这里不存在「未保存」这一状态。
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
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
}

export function EditorTabs({ tabs, activePath, onActivate, onClose, onCloseAll }: EditorTabsProps): React.ReactElement {
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
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            className={isActive ? "ravel-ide-tab ravel-ide-tab-active" : "ravel-ide-tab"}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate(path);
              }
            }}
          >
            <button type="button" className="ravel-ide-tab-label" onClick={() => onActivate(path)} title={path}>
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
