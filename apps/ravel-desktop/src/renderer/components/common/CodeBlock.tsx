import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

export interface CodeBlockProps {
  language?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Presentational code block. Highlighting is provided upstream by
 * `rehype-highlight` (which is highlight.js under the hood) — we only add the
 * language label and a copy button here, so no raw HTML is ever injected.
 */
export function CodeBlock({ language, className, children }: CodeBlockProps): React.ReactElement {
  const copy = React.useCallback(() => {
    const text = typeof children === "string" ? children : String(children ?? "");
    void navigator.clipboard?.writeText(text);
  }, [children]);

  return (
    <Box
      sx={{
        position: "relative",
        my: 1,
        "& .code-actions": { opacity: 0, transition: "opacity 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))" },
        "&:hover .code-actions": { opacity: 1 },
      }}
    >
      <Box className="code-actions" sx={{ position: "absolute", top: 6, right: 6, display: "flex", alignItems: "center", gap: 0.5, zIndex: 1 }}>
        {language ? (
          <Box
            sx={{
              fontSize: "0.65625rem",
              fontWeight: 650,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--omega-text-dim)",
              background: "var(--omega-bg-elevated)",
              border: "1px solid var(--omega-border)",
              borderRadius: "5px",
              px: 0.75,
              py: "1px",
            }}
          >
            {language}
          </Box>
        ) : null}
        <Tooltip title="复制">
          <IconButton
            size="small"
            aria-label="复制代码"
            onClick={copy}
            sx={{
              color: "var(--omega-text-dim)",
              background: "var(--omega-bg-elevated)",
              border: "1px solid var(--omega-border)",
              borderRadius: "6px",
              width: 24,
              height: 24,
              "&:hover": { color: "var(--omega-accent)", borderColor: "var(--omega-accent-line)" },
            }}
          >
            <ContentCopyIcon sx={{ fontSize: "0.8125rem" }} />
          </IconButton>
        </Tooltip>
      </Box>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </Box>
  );
}
