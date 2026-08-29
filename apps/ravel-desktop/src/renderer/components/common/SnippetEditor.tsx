import * as React from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { styleCspNonce } from "../../theme/tokens";

const MAX_SNIPPET_CHARS = 4_096;

/** Bounded CodeMirror 6 surface for node/inline snippets. Whole files stay in FileViewer. */
export function SnippetEditor({ value, readOnly = true }: { value: string; readOnly?: boolean }): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value.slice(0, MAX_SNIPPET_CHARS),
        extensions: [
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.lineWrapping,
          EditorView.cspNonce.of(styleCspNonce),
          EditorView.theme({
            "&": { fontSize: "12px", maxHeight: "160px", backgroundColor: "transparent" },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [readOnly, value]);

  return <div ref={hostRef} className="omega-snippet-editor" />;
}
