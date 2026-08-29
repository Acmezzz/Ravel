/**
 * 任务六：IDE 表面组合根。
 *
 * 组合：工作区文件树（WorkspaceTree，复用 FileTree）+ 编辑器（EditorTabs + EditorGroup，
 * CodeMirror 常驻实例，不写全局）+ 底部面板（BottomPanel，复用 Diff/Worktree/Terminal）
 * + 搜索抽屉（复用 SearchPanel，结果点击进编辑器 tab）。
 *
 * 结构：作为 Shell 中列内（region / main 内二线）的独立 region landmark，依据
 * `surfaceMode` 由 SurfaceRouter 渲染。编辑器内容 / PTY 输出等高频状态留在各自
 * 组件 / hook，不写入全局 Zustand。
 */
import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "../../ui/Button";
import { WorkspaceTree } from "./WorkspaceTree";
import { EditorTabs } from "./EditorTabs";
import { EditorGroup } from "./EditorGroup";
import { BottomPanel } from "./BottomPanel";
import { SearchPanel } from "../../components/files/SearchPanel";
import { useIdeSurface } from "./useIdeSurface";

export function IdeSurface(): React.ReactElement {
  const v = useIdeSurface();
  const activeFile = v.activePath ? v.files[v.activePath] : undefined;

  return (
    <section
      className="ravel-ide-surface"
      data-surface="ide"
      aria-label="IDE 工作区"
    >
      <div className="ravel-ide-toolbar">
        <span className="overline-label" style={{ margin: 0 }}>IDE 工作区</span>
        <Button
          size="sm"
          variant="outline"
          leading={<Search size={14} aria-hidden="true" strokeWidth={1.6} />}
          onClick={() => v.setSearchOpen(!v.searchOpen)}
          aria-pressed={v.searchOpen}
        >
          {v.searchOpen ? "收起搜索" : "在工作区中搜索"}
        </Button>
      </div>

      <div className="ravel-ide-body">
        <div className="ravel-ide-sidebar">
          <WorkspaceTree onOpenFile={v.openFile} />
        </div>
        <div className="ravel-ide-main">
          <EditorTabs
            tabs={v.tabs}
            activePath={v.activePath}
            dirty={v.dirty}
            onActivate={v.activate}
            onClose={v.closeTab}
            onCloseAll={v.closeAllTabs}
          />
          <EditorGroup activePath={v.activePath} file={activeFile} />
        </div>
        {v.searchOpen ? (
          <aside className="ravel-ide-search" aria-label="搜索抽屉">
            <div className="ravel-ide-search-header">
              <span className="overline-label" style={{ margin: 0 }}>搜索</span>
              <Button size="sm" variant="quiet" onClick={() => v.setSearchOpen(false)}>收起</Button>
            </div>
            <div className="ravel-ide-search-body">
              <SearchPanel onOpenFile={v.openFile} />
            </div>
          </aside>
        ) : null}
      </div>

      <BottomPanel bottomTab={v.bottomTab} onTabChange={v.setBottomTab} />
    </section>
  );
}