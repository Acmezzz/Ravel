import * as React from "react";
import { Copy } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";

export interface CodeBlockProps { language?: string; className?: string; children: React.ReactNode; }

/** Presentational code block; highlighting is provided upstream by rehype-highlight. */
export function CodeBlock({ language, className, children }: CodeBlockProps): React.ReactElement {
  const copy = React.useCallback(() => {
    const text = typeof children === "string" ? children : String(children ?? "");
    void navigator.clipboard?.writeText(text);
  }, [children]);
  return <div className="omega-code-block">
    <div className="code-actions">
      {language ? <span className="omega-code-language">{language}</span> : null}
      <Tooltip><TooltipTrigger asChild><IconButton size="sm" label="复制代码" className="omega-code-copy" onClick={copy}><Copy className="omega-code-copy-icon" strokeWidth={1.5} aria-hidden="true" /></IconButton></TooltipTrigger><TooltipContent>复制</TooltipContent></Tooltip>
    </div>
    <pre><code className={className}>{children}</code></pre>
  </div>;
}
