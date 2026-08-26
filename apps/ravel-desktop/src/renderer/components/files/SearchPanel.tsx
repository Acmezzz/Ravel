import * as React from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import CircularProgress from "@mui/material/CircularProgress";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import type { SearchMatch } from "../../types/dto";

/**
 * Workspace-wide text search (ripgrep with a git-grep fallback). Clicking a
 * match opens the file in the viewer at that line.
 */
export function SearchPanel(): React.ReactElement {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchMatch[] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const openViewer = useAppStore((s) => s.openViewer);
  const requestEpoch = React.useRef(0);

  const run = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const epoch = ++requestEpoch.current;
      if (!value) {
        setResults(null);
        setTruncated(false);
        setError(null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await ipc.projectSearch({ query: value });
        if (epoch !== requestEpoch.current) return;
        if (result.ok) {
          setResults(result.data.results);
          setTruncated(result.data.truncated);
        } else {
          setResults([]);
          setError(result.message ?? "search failed");
        }
      } finally {
        if (epoch === requestEpoch.current) setBusy(false);
      }
    },
    [],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <TextField
        size="small"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          void run(event.target.value);
        }}
        placeholder={t("search.placeholder")}
        aria-label={t("search.aria")}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: "0.9375rem", color: "var(--omega-text-muted)" }} />
            </InputAdornment>
          ),
          endAdornment: busy ? <CircularProgress size={14} /> : undefined,
          sx: { borderRadius: "10px", background: "var(--omega-bg-soft)" },
        }}
      />
      {error ? (
        <Typography sx={{ fontSize: "0.6875rem", color: "var(--omega-danger)" }}>{error}</Typography>
      ) : null}
      {truncated && results ? (
        <Typography sx={{ fontSize: "0.59375rem", color: "var(--omega-warning)" }}>{t("search.truncated")}</Typography>
      ) : null}
      {(results ?? []).map((match) => (
        <Box
          key={`${match.path}:${match.line}`}
          onClick={() => void openViewer(match.path)}
          sx={{
            px: 0.75,
            py: 0.4,
            borderRadius: "8px",
            border: "1px solid var(--omega-border)",
            background: "var(--omega-bg-soft)",
            cursor: "pointer",
            minWidth: 0,
            "&:hover": { borderColor: "var(--omega-accent-line)", background: "var(--omega-accent-soft)" },
          }}
        >
          <Typography className="mono-num" noWrap sx={{ fontSize: "0.625rem", color: "var(--omega-accent)" }}>
            {match.path}:{match.line}
          </Typography>
          <Typography className="mono-num" noWrap sx={{ fontSize: "0.65625rem", color: "var(--omega-text-soft)" }}>
            {match.text.trim()}
          </Typography>
        </Box>
      ))}
      {results !== null && results.length === 0 && !busy && !error ? (
        <Typography sx={{ fontSize: "0.6875rem", color: "var(--omega-text-dim)" }}>{t("search.noResults")}</Typography>
      ) : null}
    </Box>
  );
}
