import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import IosShareIcon from "@mui/icons-material/IosShare";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { AgentStateSnapshot } from "../../types/dto";

function Stat({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <Box sx={{ minWidth: 84 }}>
      <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)" }}>{label}</Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: "var(--omega-text)" }}>{value}</Typography>
    </Box>
  );
}

export interface SessionInfoDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Session stats + system prompt viewer + HTML export. */
export function SessionInfoDialog({ open, onClose }: SessionInfoDialogProps): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<AgentStateSnapshot | null>(null);
  const [systemPrompt, setSystemPrompt] = React.useState<string | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const requestEpoch = React.useRef(0);

  const loadState = React.useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);
    try {
      const res = await ipc.getState();
      if (epoch !== requestEpoch.current) return;
      if (res.ok) {
        setSnapshot(res.data);
        useAppStore.getState().setAgent(res.data);
      } else setError(res.message);
    } catch (reason) {
      if (epoch === requestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      requestEpoch.current += 1;
      setPromptOpen(false);
      setSystemPrompt(null);
      setError(null);
      setPromptError(null);
      return;
    }
    setSnapshot(useAppStore.getState().agent);
    void loadState();
  }, [loadState, open]);

  const loadPrompt = React.useCallback(async (force = false) => {
    const next = force ? true : !promptOpen;
    setPromptOpen(next);
    if (next && systemPrompt === null) {
      setPromptError(null);
      try {
        const res = await ipc.getSystemPrompt();
        if (res.ok) setSystemPrompt(res.data.systemPrompt);
        else setPromptError(res.message);
      } catch (reason) {
        setPromptError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [promptOpen, systemPrompt]);

  const exportHtml = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await ipc.exportHtml();
      if (!res.ok) setError(res.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const usage = snapshot?.usage;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}>
        会话信息
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={busy ? <CircularProgress size={13} sx={{ color: "inherit" }} /> : <IosShareIcon sx={{ fontSize: 15 }} />}
          onClick={() => void exportHtml()}
          disabled={busy}
          sx={{ textTransform: "none" }}
        >
          导出 HTML
        </Button>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        {loading ? <Box role="status" aria-live="polite" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}><CircularProgress size={15} /><Typography sx={{ fontSize: 12, color: "var(--omega-text-muted)" }}>正在刷新会话信息…</Typography></Box> : null}
        {error ? <Box role="alert" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}><Typography sx={{ fontSize: 12, color: "var(--omega-danger)" }}>{error}</Typography><Button size="small" onClick={() => void loadState()} disabled={loading || busy} sx={{ textTransform: "none" }}>重试</Button></Box> : null}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1.5 }}>
          <Chip size="small" label={snapshot?.sessionName || "未命名会话"} />
          {snapshot?.model ? (
            <Chip size="small" variant="outlined" label={`${snapshot.model.provider}/${snapshot.model.id}`} />
          ) : null}
          <Chip size="small" variant="outlined" label={snapshot?.cwd ?? ""} sx={{ maxWidth: 260, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }} />
        </Box>
        <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap", mb: 1.5 }}>
          <Stat label="用户消息" value={snapshot?.stats.userMessages ?? 0} />
          <Stat label="助手消息" value={snapshot?.stats.assistantMessages ?? 0} />
          <Stat label="工具调用" value={snapshot?.stats.toolCalls ?? 0} />
          <Stat label="总消息" value={snapshot?.stats.totalMessages ?? 0} />
        </Box>
        <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap", mb: 1.5 }}>
          <Stat label="输入 tokens" value={usage?.input ?? 0} />
          <Stat label="输出 tokens" value={usage?.output ?? 0} />
          <Stat label="累计 tokens" value={usage?.total ?? 0} />
          <Stat label="成本 $" value={(usage?.cost ?? 0).toFixed(4)} />
          <Stat label="上下文" value={usage?.percent !== null && usage?.percent !== undefined ? `${Math.round(usage.percent)}%` : "暂无数据"} />
        </Box>
        <Divider sx={{ my: 1.5 }} />
        <Typography
          component="button"
          type="button"
          onClick={() => void loadPrompt()}
          sx={{ fontSize: 13, color: "var(--omega-accent)", cursor: "pointer", userSelect: "none", fontWeight: 600, border: "none", background: "transparent", p: 0 }}
        >
          {promptOpen ? "▾ 隐藏系统提示词" : "▸ 查看系统提示词"}
        </Typography>
        {promptOpen ? (
          <Box
            component="pre"
            sx={{
              m: 0,
              mt: 1,
              p: 1.25,
              borderRadius: "10px",
              border: "1px solid var(--omega-border)",
              background: "var(--omega-bg-code)",
              fontSize: 12,
              lineHeight: 1.6,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              color: "var(--omega-text-muted)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 300,
              overflowY: "auto",
            }}
          >
            {systemPrompt ?? (promptError ? "加载失败" : "加载中…")}
          </Box>
        ) : null}
        {promptError ? <Box role="alert" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75 }}><Typography sx={{ fontSize: 12, color: "var(--omega-danger)" }}>{promptError}</Typography><Button size="small" onClick={() => { setSystemPrompt(null); void loadPrompt(true); }} sx={{ textTransform: "none" }}>重试提示词</Button></Box> : null}
      </DialogContent>
    </Dialog>
  );
}
