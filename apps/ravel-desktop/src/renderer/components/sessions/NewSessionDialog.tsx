import * as React from "react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { Button } from "../../ui/Button";
import { useAppStore } from "../../store/useAppStore";
import { ipc, unwrap } from "../../ipc/client";

export interface NewSessionDialogProps { open: boolean; onClose: () => void; }

export function NewSessionDialog({ open, onClose }: NewSessionDialogProps): React.ReactElement {
  const [title, setTitle] = React.useState("");
  const [workspace, setWorkspace] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const applySessionPage = useAppStore((state) => state.applySessionPage);
  const setActiveSession = useAppStore((state) => state.setActiveSession);
  const loadTranscript = useAppStore((state) => state.loadTranscript);
  const setAgent = useAppStore((state) => state.setAgent);
  React.useEffect(() => { if (!open) { setTitle(""); setWorkspace(""); setBusy(false); setError(null); } }, [open]);
  const handleCreate = React.useCallback(async () => { setBusy(true); try { const record = await unwrap(await ipc.newSession({ title: title || undefined, workspace: workspace || undefined })); setActiveSession(record.id); loadTranscript(record); const state = await ipc.getState(); if (state.ok) setAgent(state.data); const list = await ipc.listSessions(); if (list.ok) applySessionPage(list.data); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }, [title, workspace, setActiveSession, loadTranscript, applySessionPage, setAgent, onClose]);
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}><DialogContent aria-busy={busy || undefined}><DialogTitle>新建会话</DialogTitle><div className="omega-dialog-content-area omega-form-stack">{error ? <p role="alert" className="omega-error-text">{error}</p> : null}<TextField label="标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="未命名会话" autoFocus /><TextField label="工作区路径" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="留空则使用当前工作区" /></div><DialogFooter><Button variant="quiet" onClick={onClose} disabled={busy}>取消</Button><Button variant="solid" onClick={() => void handleCreate()} disabled={busy}>创建</Button></DialogFooter></DialogContent></Dialog>;
}
