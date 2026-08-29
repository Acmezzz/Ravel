/**
 * IDE 编辑器内容区（CodeMirror 6，只读阅读器）。
 *
 * 之前这里只给了 `backgroundColor` 和 `height:100%`，没有文字颜色、没有撑满高度的宿主
 * 规则，也没有任何着色，所以表现为「只有行号、正文一片空白」。现在：
 *  - 宿主 `.ravel-editor-host` 由 CSS 保证 `height:100%`，主题再锁定 `&`/scroller 高度；
 *  - 自带分词器产出 CodeMirror mark decorations，颜色全部取 `--ravel-chart-*` /
 *    state token，不新增依赖，也不碰 highlight.js 的私有 API；
 *  - 行号、当前行高亮、软折行开关、选区「引用到对话」。
 *
 * 只读是刻意的：Renderer 没有文件写入通道，工作区改动由 Agent 的 edit/write 工具落进
 * JSONL 事实。选区引用把上下文交回对话，才是这个产品里改代码的正确闭环。
 *
 * EditorView 实例留在组件内，不进全局 Zustand。
 */
import * as React from "react";
import { Quote, WrapText } from "lucide-react";
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { Compartment, EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Button, IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import type { IdeFileSlot } from "./useIdeSurface";

/* ------------------------------------------------------------- tokenizer */

const KEYWORDS = new Set([
  "abstract", "and", "any", "as", "assert", "async", "await", "boolean", "break", "case",
  "catch", "class", "const", "constructor", "continue", "crate", "debugger", "declare",
  "default", "def", "delete", "do", "dyn", "elif", "else", "enum", "export", "extends",
  "false", "finally", "fn", "for", "from", "function", "get", "global", "go", "if",
  "implements", "impl", "import", "in", "infer", "instanceof", "interface", "is", "keyof",
  "lambda", "let", "match", "module", "mut", "namespace", "never", "new", "nonlocal",
  "None", "not", "null", "number", "object", "of", "or", "package", "pass", "private",
  "property", "protected", "pub", "readonly", "ref", "return", "satisfies", "self", "set",
  "static", "string", "struct", "super", "switch", "symbol", "this", "throw", "trait",
  "True", "true", "try", "type", "typeof", "undefined", "unique", "unknown", "use", "var",
  "void", "where", "while", "with", "yield",
]);

/**
 * Line-oriented token pass. Each line is independent, which is cheap and stable
 * for the languages this reader shows; it never re-parses the whole document.
 */
const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(@[A-Za-z_$][\w$]*)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const text = line.text;
    if (!text.trim()) continue;
    TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null = TOKEN_RE.exec(text);
    while (match) {
      const [raw, comment, str, decorator, num, word] = match;
      let cls: string | undefined;
      if (comment) cls = "cm-tok-comment";
      else if (str) cls = "cm-tok-string";
      else if (decorator) cls = "cm-tok-decorator";
      else if (num) cls = "cm-tok-number";
      else if (word) {
        if (KEYWORDS.has(word)) cls = "cm-tok-keyword";
        else if (/^[A-Z][\w$]*$/.test(word)) cls = "cm-tok-type";
        else if (text.slice(match.index + word.length).trimStart().startsWith("(")) cls = "cm-tok-func";
      }
      if (cls) builder.add(line.from + match.index, line.from + match.index + raw.length, Decoration.mark({ class: cls }));
      match = TOKEN_RE.exec(text);
    }
  }
  return builder.finish();
}

const highlightField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (value, tr) => (tr.docChanged ? buildDecorations(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

/* ----------------------------------------------------------------- theme */

const EDITOR_THEME = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--ravel-bg-code)", color: "var(--ravel-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ravel-font-mono)", lineHeight: "20px", overflow: "auto" },
  ".cm-content": { caretColor: "var(--ravel-accent)", padding: "10px 0 48px" },
  ".cm-gutters": {
    backgroundColor: "var(--ravel-bg-code)",
    color: "var(--ravel-text-dim)",
    border: "none",
    borderRight: "1px solid var(--ravel-border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", fontVariantNumeric: "tabular-nums" },
  ".cm-activeLine": { backgroundColor: "var(--ravel-hover-fill)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--ravel-hover-fill)", color: "var(--ravel-accent)" },
  ".cm-selectionBackground": { backgroundColor: "var(--ravel-selection)" },
});

/* --------------------------------------------------------------- surface */

function EditorSurface({
  doc,
  wrap,
  onSelection,
}: {
  doc: string;
  wrap: boolean;
  onSelection: (range: { from: number; to: number } | null) => void;
}): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onSelectionRef = React.useRef(onSelection);
  onSelectionRef.current = onSelection;
  // lineWrapping is a plain extension, so toggling it goes through a Compartment.
  const wrapRef = React.useRef(new Compartment());

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightField,
          EDITOR_THEME,
          // CodeMirror mounts its base theme as a runtime <style>; index.html
          // allows that through `style-src ... 'unsafe-inline'`.
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          wrapRef.current.of(wrap ? [EditorView.lineWrapping] : []),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet) return;
            const range = update.state.selection.main;
            onSelectionRef.current(range.empty ? null : { from: range.from, to: range.to });
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per file (the caller keys this component by path); later doc and
    // wrap changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the whole doc when another file is activated / finishes loading.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === doc) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    view.scrollDOM.scrollTop = 0;
    onSelectionRef.current(null);
  }, [doc]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapRef.current.reconfigure(wrap ? [EditorView.lineWrapping] : []) });
  }, [wrap]);

  return <div className="ravel-editor-host" ref={hostRef} data-codemirror />;
}

/** 只读代码阅读器：工具条 + 编辑面 + 状态条。 */
export function EditorGroup({ activePath, file }: { activePath: string | null; file: IdeFileSlot | undefined }): React.ReactElement {
  const [wrap, setWrap] = React.useState(false);
  const [selection, setSelection] = React.useState<{ from: number; to: number } | null>(null);
  const setComposerPrefill = useAppStore((s) => s.setComposerPrefill);

  if (!activePath) {
    return (
      <div className="ravel-editor ravel-editor-empty" role="status">
        <span className="ravel-editor-empty-mark" aria-hidden="true">{"{ }"}</span>
        <p className="ravel-editor-empty-title">未打开文件</p>
        <p className="ravel-editor-empty-hint">从右侧工作区文件树选择文件，或按 Ctrl+K 搜索。</p>
      </div>
    );
  }

  if (!file || file.loading) {
    return (
      <div className="ravel-editor ravel-editor-empty" role="status" aria-busy="true" aria-live="polite">
        <span className="omega-file-viewer-spinner" aria-hidden="true" />
        <span>正在加载 {activePath}…</span>
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="ravel-editor ravel-editor-empty" role="alert">
        <p className="omega-error-text">无法打开 {activePath}</p>
        <p className="ravel-editor-empty-hint">{file.error}</p>
      </div>
    );
  }

  if (file.binary) {
    return (
      <div className="ravel-editor ravel-editor-empty">
        <p className="omega-muted-text">该文件是二进制内容，不支持内嵌阅读。</p>
        <p className="ravel-editor-empty-hint">可在资源管理器中打开，或改用外部应用。</p>
      </div>
    );
  }

  const lines = file.content ? file.content.split("\n").length : 0;

  return (
    <div className="ravel-editor">
      <div className="ravel-editor-toolbar">
        <span className="ravel-editor-path" title={activePath}>{activePath}</span>
        <span className="ravel-editor-toolbar-spacer" />
        {selection ? (
          <Button
            size="sm"
            variant="outline"
            leading={<Quote size={13} strokeWidth={1.8} aria-hidden="true" />}
            onClick={() => setComposerPrefill(`@${activePath}:${selection.from}-${selection.to}`)}
          >
            引用到对话
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size="sm"
              label={wrap ? "关闭软折行" : "开启软折行"}
              active={wrap}
              onClick={() => setWrap((current) => !current)}
            >
              <WrapText size={14} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>{wrap ? "关闭软折行" : "软折行"}</TooltipContent>
        </Tooltip>
      </div>

      <EditorSurface key={activePath} doc={file.content} wrap={wrap} onSelection={setSelection} />

      <div className="ravel-editor-status">
        <span>{lines.toLocaleString()} 行</span>
        <span className="ravel-editor-status-sep" aria-hidden="true" />
        <span>{file.content.length.toLocaleString()} 字符</span>
        <span className="ravel-editor-status-spacer" />
        {file.truncated ? <span className="ravel-editor-status-warn">已截断（文件过大）</span> : null}
        <span>只读 · 改动请交给 Agent</span>
      </div>
    </div>
  );
}
