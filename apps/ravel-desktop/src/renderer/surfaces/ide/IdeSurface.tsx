/**
 * IDE 表面：左对话栏 + 中代码阅读区 + 右工作区目录 + 底部面板。
 *
 * 与对话表面共用同一个 ChatPanel 与同一份会话状态，所以切到 IDE 不会丢上下文；
 * 中栏是「编辑器 tabs + 只读代码阅读面 + 底部 Diff/Worktree/终端/Agent 面板」。
 *
 * 之前这里把工具条写成「IDE 工作区」标题 + 搜索按钮，文件树挤在编辑器左边、右侧空着，
 * 与设计的三栏方向正好相反。现在目录树回到右栏（340px），对话栏在左（360px）。
 */
import * as React from "react";
import { PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { ChatPanel } from "../../components/chat/ChatPanel";
import { SearchPanel } from "../../components/files/SearchPanel";
import { WorkspaceTree } from "./WorkspaceTree";
import { EditorTabs } from "./EditorTabs";
import { EditorGroup } from "./EditorGroup";
import { BottomPanel } from "./BottomPanel";
import { useIdeSurface } from "./useIdeSurface";

export function IdeSurface(): React.ReactElement {
  const v = useIdeSurface();
  const activeFile = v.activePath ? v.files[v.activePath] : undefined;
  const [treeOpen, setTreeOpen] = React.useState(true);

  return (
    <section className="ravel-ide-surface" data-surface="ide" aria-label="IDE 工作区">
      <aside className="ravel-ide-chat" aria-label="对话栏">
        <ChatPanel />
      </aside>

      <div className="ravel-ide-center">
        <EditorTabs tabs={v.tabs} activePath={v.activePath} onActivate={v.activate} onClose={v.closeTab} onCloseAll={v.closeAllTabs} />
        <EditorGroup activePath={v.activePath} file={activeFile} />
        <BottomPanel />
      </div>

      {treeOpen ? (
        <aside className="ravel-ide-tree-col" aria-label="工作区目录">
          <div className="ravel-ide-tree-header">
            <span className="overline-label" style={{ margin: 0 }}>工作区</span>
            <div className="ravel-ide-tree-actions">
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    size="sm"
                    label={v.searchOpen ? "关闭搜索" : "在工作区中搜索"}
                    active={v.searchOpen}
                    onClick={() => v.setSearchOpen(!v.searchOpen)}
                  >
                    <Search size={14} strokeWidth={1.8} aria-hidden="true" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>搜索文件</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton size="sm" label="收起目录栏" onClick={() => setTreeOpen(false)}>
                    <PanelRightClose size={14} strokeWidth={1.8} aria-hidden="true" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>收起目录栏</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {v.searchOpen ? (
            <div className="ravel-ide-search-body">
              <SearchPanel onOpenFile={v.openFile} />
            </div>
          ) : null}
          <div className="ravel-ide-tree-scroll">{v.searchOpen ? null : <WorkspaceTree onOpenFile={v.openFile} />}</div>
        </aside>
      ) : (
        <button type="button" className="ravel-ide-tree-restore" aria-label="展开目录栏" onClick={() => setTreeOpen(true)}>
          <PanelRightOpen size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>目录</span>
        </button>
      )}
    </section>
  );
}
