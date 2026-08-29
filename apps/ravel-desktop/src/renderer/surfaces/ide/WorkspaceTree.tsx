/**
 * 任务六：IDE 文件树外壳。
 * 复用既有 FileTree（懒加载 IPC 目录遍历、上传、刷新），仅把文件打开的 click 路由到
 * IDE 编辑 tab（而非全局 viewer 对话框）。默认无 onOpenFile 时仍回落到 viewer 行为。
 */
import * as React from "react";
import { FileTree } from "../../components/files/FileTree";

export function WorkspaceTree({ onOpenFile }: { onOpenFile: (path: string) => void }): React.ReactElement {
  return (
    <div className="ravel-ide-tree" role="group" aria-label="IDE 工作区文件树">
      <FileTree onOpenFile={onOpenFile} />
    </div>
  );
}