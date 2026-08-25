import * as React from "react";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import CheckIcon from "@mui/icons-material/Check";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";
import type { ModelInfo } from "../../types/dto";

/** Module-level switch token: stale results from a closed picker are ignored (port of pi-app, MIT). */
let modelSwitchToken = 0;

export interface ModelPickerProps {
  anchor: HTMLElement | null;
  onClose: () => void;
}

function groupByProvider(models: ModelInfo[]): Array<{ provider: string; models: ModelInfo[] }> {
  const groups: Array<{ provider: string; models: ModelInfo[] }> = [];
  for (const model of models) {
    const group = groups.find((entry) => entry.provider === model.provider);
    if (group) group.models.push(model);
    else groups.push({ provider: model.provider, models: [model] });
  }
  return groups;
}

export function ModelPicker({ anchor, onClose }: ModelPickerProps): React.ReactElement {
  const models = useAppStore((s) => s.models);
  const setAgent = useAppStore((s) => s.setAgent);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (anchor) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [anchor]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(q));
  }, [models, query]);

  const groups = React.useMemo(() => groupByProvider(filtered), [filtered]);
  const flatModels = React.useMemo(() => groups.flatMap((group) => group.models), [groups]);

  const pick = React.useCallback(
    async (model: ModelInfo) => {
      const token = ++modelSwitchToken;
      const key = `${model.provider}/${model.id}`;
      setPending(key);
      setError(null);
      try {
        const res = await ipc.setModel({ provider: model.provider, modelId: model.id });
        if (token !== modelSwitchToken) return;
        if (res.ok) {
          setAgent(res.data);
          onClose();
        } else setError(res.message);
      } catch (reason) {
        if (token === modelSwitchToken) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (token === modelSwitchToken) setPending(null);
      }
    },
    [setAgent, onClose],
  );

  return (
    <Popover
      open={Boolean(anchor)}
      aria-label="选择模型"
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: { width: 320, maxHeight: 420, display: "flex", flexDirection: "column", p: 0.75 },
        },
      }}
    >
      <Box sx={{ px: 0.75, pt: 0.75, pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="搜索模型…"
          label="搜索模型"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(Math.max(flatModels.length - 1, 0), index + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
            else if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(flatModels.length - 1, 0)); }
            else if (event.key === "Enter" && flatModels[activeIndex]) { event.preventDefault(); void pick(flatModels[activeIndex]); }
          }}
          aria-controls="omega-model-list"
          aria-activedescendant={flatModels[activeIndex] ? `omega-model-${flatModels[activeIndex].provider}-${flatModels[activeIndex].id}` : undefined}
        />
        {error ? <Typography role="alert" sx={{ fontSize: "0.75rem", color: "var(--omega-danger)", mt: 0.75 }}>{error}</Typography> : null}
      </Box>
      <Box id="omega-model-list" role="listbox" aria-label="模型列表" sx={{ overflowY: "auto", px: 0.75, pb: 0.75 }}>
        {groups.length === 0 ? (
          <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)", px: 1, py: 1.5 }}>无匹配模型</Typography>
        ) : (
          groups.map((group) => (
            <Box key={group.provider} sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: "0.65625rem", fontWeight: 700, color: "var(--omega-text-dim)", letterSpacing: "0.06em", px: 1, py: 0.5 }}>
                {group.provider.toUpperCase()}
              </Typography>
              {group.models.map((model) => {
                const key = `${model.provider}/${model.id}`;
                const isPending = pending === key;
                return (
                  <Box
                    key={key}
                    id={`omega-model-${model.provider}-${model.id}`}
                    {...clickableRole}
                    role="option"
                    aria-selected={Boolean(model.selected)}
                    aria-busy={isPending}
                    onClick={() => (pending ? undefined : void pick(model))}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 1.25,
                      py: 0.75,
                      borderRadius: "9px",
                      cursor: pending ? "wait" : "pointer",
                      opacity: pending && !isPending ? 0.5 : 1,
                      "&:hover": { background: "var(--omega-hover-fill)" },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)" }} noWrap>
                        {model.id}
                      </Typography>
                      <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} noWrap>
                        {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : ""}
                        {model.reasoning ? " · reasoning" : ""}
                      </Typography>
                    </Box>
                    {isPending ? <CircularProgress size={14} sx={{ color: "var(--omega-accent)" }} /> : null}
                    {model.selected && !isPending ? <CheckIcon sx={{ fontSize: "1rem", color: "var(--omega-accent)" }} /> : null}
                  </Box>
                );
              })}
            </Box>
          ))
        )}
      </Box>
    </Popover>
  );
}
