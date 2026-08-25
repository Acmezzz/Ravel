import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import { useAppStore } from "../../store/useAppStore";

export interface MarkdownProps {
  children: string;
}

const LOCAL_PATH = /^(?:[A-Za-z]:[\\/][^:?*"<>|]*|\/[^:?*"<>|]*|\.?\.?\/[^:?*"<>|]+)/;
const MARKDOWN_FLUSH_MS = 50;

/** Looks like a local file path (not a URL). */
function isLocalPath(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file:")) return false;
  return LOCAL_PATH.test(href);
}

/**
 * Markdown renderer.
 *
 * SECURITY: raw HTML is deliberately NOT enabled — we never load `rehype-raw`,
 * so any embedded HTML in assistant text is escaped/ignored (XSS-safe). Code
 * fences are highlighted via `rehype-highlight` (highlight.js). Anchors that
 * look like local file paths open the in-app viewer instead of navigating.
 *
 * Streaming text is flushed on rAF, at most every 50ms, so highlight/parse
 * does not run on every token.
 */
function MarkdownInner({ children }: MarkdownProps): React.ReactElement {
  const [rendered, setRendered] = React.useState(children);
  const pendingRef = React.useRef(children);
  const scheduledRef = React.useRef(false);
  const timerRef = React.useRef(0);
  const frameRef = React.useRef(0);

  React.useEffect(() => {
    pendingRef.current = children;
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    const started = performance.now();
    frameRef.current = requestAnimationFrame(() => {
      const wait = MARKDOWN_FLUSH_MS - (performance.now() - started);
      const flush = () => {
        scheduledRef.current = false;
        timerRef.current = 0;
        frameRef.current = 0;
        setRendered(pendingRef.current);
      };
      if (wait <= 0) flush();
      else timerRef.current = window.setTimeout(flush, wait);
    });
  }, [children]);

  React.useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a(props) {
            const { href, children: linkChildren, node: _node, ref: _ref, ...rest } = props as {
              href?: string;
              children?: React.ReactNode;
              node?: unknown;
              ref?: unknown;
              [key: string]: unknown;
            };
            if (href && isLocalPath(href)) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    void useAppStore.getState().openViewer(href.replace(/^file:\/\/\/?/, ""));
                  }}
                  title="在查看器中打开"
                  {...rest}
                >
                  {linkChildren}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...rest}>
                {linkChildren}
              </a>
            );
          },
          code(props) {
            const { className, children: codeChildren, node: _node2, ref: _ref2, ...rest } = props as {
              className?: string;
              children?: React.ReactNode;
              node?: unknown;
              ref?: unknown;
              [key: string]: unknown;
            };
            const match = /language-(\w+)/.exec(className ?? "");
            const isBlock =
              typeof codeChildren === "string" && (codeChildren.includes("\n") || codeChildren.length > 60);
            if (!isBlock) {
              return (
                <code className={className} {...rest}>
                  {codeChildren}
                </code>
              );
            }
            return (
              <CodeBlock language={match?.[1]} className={className}>
                {codeChildren}
              </CodeBlock>
            );
          },
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = React.memo(MarkdownInner);
