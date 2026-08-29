/**
 * 任务六：IDE 编辑器内容区（CodeMirror 6）。
 *
 * EditorView 实例留在此组件内，不进全局 Zustand —— 这是刻意的取舍：CodeMirror 的 doc /
 * selection / scroll 是高频、持续变化的状态，写入全局 store 会让无关组件随之重绘。
 * 这里用一个常驻的 EditorView，仅在文件内容变化时 dispatch 一次整体替换，保留光标与滚动位置。
 */
import * as React from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import type { IdeFileSlot } from "./useIdeSurface";

const SNIPPET_THEME = EditorView.theme({
  "&": { fontSize: "12px", height: "100%", backgroundColor: "var(--ravel-bg-code)" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--ravel-bg-code)" },
});

/** 常驻单实例 CodeMirror 编辑面：创建一次，内容变化时原位替换 doc。 */
function CodeMirrorSurface({ content }: { content: string }): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          lineNumbers(),
          SNIPPET_THEME,
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // 只在挂载时创建；后续内容更新由下方 effect 原位替换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (content === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  return <div className="ravel-ide-editor-host" ref={hostRef} data-codemirror />;
}

/** 空态 / 加载 / 错误 / 二进制与文本编辑的统一分发。 */
export function EditorGroup({ activePath, file }: { activePath: string | null; file: IdeFileSlot | undefined }): React.ReactElement {
  if (!activePath) {
    return (
      <div className="ravel-ide-editor ravel-ide-editor-empty" role="status">
        <span className="overline-label">编辑器</span>
        <p>从左侧文件树或搜索中打开一个文件以开始编辑。</p>
      </div>
    );
  }

  if (!file || file.loading) {
    return (
      <div className="ravel-ide-editor ravel-ide-editor-empty" role="status" aria-busy="true" aria-live="polite">
        <span className="omega-file-viewer-spinner" aria-hidden="true" />
        <span>正在加载 {activePath}…</span>
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="ravel-ide-editor ravel-ide-editor-empty" role="alert">
        <p className="omega-error-text">{file.error}</p>
      </div>
    );
  }

  if (file.binary) {
    return (
      <div className="ravel-ide-editor ravel-ide-editor-empty">
        <p className="omega-muted-text">该二进制文件不支持内嵌编辑，可用资源管理器或外部应用打开。</p>
      </div>
    );
  }

  return (
    <div className="ravel-ide-editor">
      <CodeMirrorSurface content={file.content} />
    </div>
  );
}