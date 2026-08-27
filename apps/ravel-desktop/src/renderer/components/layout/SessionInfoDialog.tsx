import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { AgentStateSnapshot } from "../../types/dto";

function Stat({ label, value }: { label: string; value: string | number }): React.ReactElement { return <div className="omega-session-stat"><span>{label}</span><strong>{value}</strong></div>; }
export interface SessionInfoDialogProps { open: boolean; onClose: () => void; }

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
  const loadState = React.useCallback(async () => { const epoch = ++requestEpoch.current; setLoading(true); setError(null); try { const res = await ipc.getState(); if (epoch !== requestEpoch.current) return; if (res.ok) { setSnapshot(res.data); useAppStore.getState().setAgent(res.data); } else setError(res.message); } catch (reason) { if (epoch === requestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason)); } finally { if (epoch === requestEpoch.current) setLoading(false); } }, []);
  React.useEffect(() => { if (!open) { requestEpoch.current += 1; setPromptOpen(false); setSystemPrompt(null); setError(null); setPromptError(null); return; } setSnapshot(useAppStore.getState().agent); void loadState(); }, [loadState, open]);
  const loadPrompt = React.useCallback(async (force = false) => { const next = force || !promptOpen; setPromptOpen(next); if (next && systemPrompt === null) { setPromptError(null); try { const res = await ipc.getSystemPrompt(); if (res.ok) setSystemPrompt(res.data.systemPrompt); else setPromptError(res.message); } catch (reason) { setPromptError(reason instanceof Error ? reason.message : String(reason)); } } }, [promptOpen, systemPrompt]);
  const exportHtml = React.useCallback(async () => { setBusy(true); setError(null); try { const res = await ipc.exportHtml(); if (!res.ok) setError(res.message); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }, []);
  const usage = snapshot?.usage;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent className="omega-dialog-wide"><DialogTitle><span className="omega-session-dialog-title">会话信息</span><Button size="sm" variant="outline" onClick={() => void exportHtml()} disabled={busy}>{busy ? "导出中…" : "导出 HTML"}</Button></DialogTitle><div className="omega-dialog-content-area">
    {loading ? <p role="status" aria-live="polite" className="omega-muted-text">正在刷新会话信息…</p> : null}{error ? <div role="alert" className="omega-inline-error"><span className="omega-error-text">{error}</span><Button size="sm" variant="quiet" onClick={() => void loadState()} disabled={loading || busy}>重试</Button></div> : null}
    <div className="omega-session-tags"><span className="omega-chip">{snapshot?.sessionName || "未命名会话"}</span>{snapshot?.model ? <span className="omega-chip">{snapshot.model.provider}/{snapshot.model.id}</span> : null}<span className="omega-chip omega-session-cwd" title={snapshot?.cwd ?? ""}>{snapshot?.cwd ?? ""}</span></div>
    <div className="omega-session-stats"><Stat label="用户消息" value={snapshot?.stats.userMessages ?? 0} /><Stat label="助手消息" value={snapshot?.stats.assistantMessages ?? 0} /><Stat label="工具调用" value={snapshot?.stats.toolCalls ?? 0} /><Stat label="总消息" value={snapshot?.stats.totalMessages ?? 0} /></div><div className="omega-session-stats"><Stat label="输入 tokens" value={usage?.input ?? 0} /><Stat label="输出 tokens" value={usage?.output ?? 0} /><Stat label="累计 tokens" value={usage?.total ?? 0} /><Stat label="成本 $" value={(usage?.cost ?? 0).toFixed(4)} /><Stat label="上下文" value={usage?.percent != null ? `${Math.round(usage.percent)}%` : "暂无数据"} /></div>
    <hr className="omega-divider" /><button type="button" className="omega-session-prompt-toggle" onClick={() => void loadPrompt()}>{promptOpen ? "▾ 隐藏系统提示词" : "▸ 查看系统提示词"}</button>{promptOpen ? <pre className="omega-session-prompt">{systemPrompt ?? (promptError ? "加载失败" : "加载中…")}</pre> : null}{promptError ? <div role="alert" className="omega-inline-error"><span className="omega-error-text">{promptError}</span><Button size="sm" variant="quiet" onClick={() => { setSystemPrompt(null); void loadPrompt(true); }}>重试提示词</Button></div> : null}
  </div></DialogContent></Dialog>;
}
