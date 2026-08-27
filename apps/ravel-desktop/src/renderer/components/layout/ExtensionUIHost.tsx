import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import type { ExtensionUIRequest, ExtensionUIResponse } from "../../types/dto";

const INTERACTIVE = new Set(["select", "confirm", "input", "editor"]);

type Notice = { message: string; severity: "info" | "warning" | "error" } | null;

function responseFor(request: ExtensionUIRequest, value: string | boolean): ExtensionUIResponse {
  const base = { type: "extension_ui_response" as const, id: request.id, sessionId: request.sessionId, runId: request.runId, generation: request.generation };
  return typeof value === "boolean" ? { ...base, confirmed: value } : { ...base, value };
}

export function ExtensionUIHost(): React.ReactElement {
  const setRequest = useAppStore((s) => s.setExtensionUiRequest);
  const setStatus = useAppStore((s) => s.setExtensionStatus);
  const clearStatus = useAppStore((s) => s.clearExtensionStatus);
  const setWidget = useAppStore((s) => s.setExtensionWidget);
  const clearWidget = useAppStore((s) => s.clearExtensionWidget);
  const setTitle = useAppStore((s) => s.setExtensionTitle);
  const setPrefill = useAppStore((s) => s.setComposerPrefill);
  const request = useAppStore((s) => s.extensionUiRequest);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [queue, setQueue] = React.useState<ExtensionUIRequest[]>([]);
  const [value, setValue] = React.useState("");
  const [notice, setNotice] = React.useState<Notice>(null);

  React.useEffect(() => {
    const off = ipc.onExtensionUiRequest((incoming) => {
      if (!INTERACTIVE.has(incoming.method)) {
        if (incoming.method === "notify") setNotice({ message: incoming.message, severity: incoming.notifyType ?? "info" });
        else if (incoming.method === "setStatus") {
          if (incoming.statusText === undefined) clearStatus(incoming.sessionId, incoming.statusKey);
          else setStatus({ key: incoming.statusKey, text: incoming.statusText, sessionId: incoming.sessionId });
        } else if (incoming.method === "setWidget") {
          if (!incoming.widgetLines) clearWidget(incoming.sessionId, incoming.widgetKey);
          else setWidget({ key: incoming.widgetKey, lines: incoming.widgetLines, placement: incoming.widgetPlacement ?? "aboveEditor", sessionId: incoming.sessionId });
        } else if (incoming.method === "setTitle") {
          setTitle(incoming.title);
          document.title = incoming.title ? `${incoming.title} · Ravel` : "Ravel Desktop";
        } else if (incoming.method === "set_editor_text") setPrefill(incoming.text);
        return;
      }
      if (incoming.sessionId !== activeSessionId) {
        void ipc.extensionUiCancel({
          type: "extension_ui_response",
          id: incoming.id,
          sessionId: incoming.sessionId,
          runId: incoming.runId,
          generation: incoming.generation,
          cancelled: true,
        });
        return;
      }
      const current = useAppStore.getState().extensionUiRequest;
      if (current) setQueue((items) => [...items, incoming]);
      else setRequest(incoming);
    });
    return off;
  }, [activeSessionId, clearStatus, clearWidget, setPrefill, setRequest, setStatus, setTitle, setWidget]);

  React.useEffect(() => {
    if (!request) return;
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  React.useEffect(() => {
    const current = useAppStore.getState().extensionUiRequest;
    if (current && current.sessionId !== activeSessionId) {
      void ipc.extensionUiCancel({
        type: "extension_ui_response",
        id: current.id,
        sessionId: current.sessionId,
        runId: current.runId,
        generation: current.generation,
        cancelled: true,
      });
      setRequest(null);
    }
    setQueue((items) => {
      const stale = items.filter((item) => item.sessionId !== activeSessionId);
      for (const item of stale) {
        void ipc.extensionUiCancel({
          type: "extension_ui_response",
          id: item.id,
          sessionId: item.sessionId,
          runId: item.runId,
          generation: item.generation,
          cancelled: true,
        });
      }
      return items.filter((item) => item.sessionId === activeSessionId);
    });
  }, [activeSessionId, setRequest]);

  const finish = React.useCallback(async (result?: ExtensionUIResponse) => {
    const current = useAppStore.getState().extensionUiRequest;
    if (!current) return;
    if (result) await ipc.extensionUiResponse(result);
    else await ipc.extensionUiCancel({ type: "extension_ui_response", id: current.id, sessionId: current.sessionId, runId: current.runId, generation: current.generation, cancelled: true });
    const [next, ...rest] = queue;
    setQueue(rest);
    setRequest(next ?? null);
  }, [queue, setRequest]);

  const submit = React.useCallback(() => {
    if (!request) return;
    if (request.method === "confirm") void finish(responseFor(request, value === "true"));
    else void finish(responseFor(request, value));
  }, [finish, request, value]);

  const title = request && "title" in request ? request.title : "扩展请求";
  const isConfirm = request?.method === "confirm";
  const isSelect = request?.method === "select";
  const isEditor = request?.method === "editor";

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <>
      <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) void finish(); }}>
        <DialogContent className={`extension-ui-host-dialog-content${isEditor ? " omega-dialog-wide" : ""}`}>
          <DialogTitle className="extension-ui-host-dialog-title">{title}</DialogTitle>
          <div className="extension-ui-host-content">
            {request?.method === "confirm" && <p className="extension-ui-host-message">{request.message}</p>}
            {isSelect && (
              <TextField
                autoFocus
                select
                className="extension-ui-host-select"
                aria-label="选择选项"
                value=""
                onChange={(event) => void finish(responseFor(request, event.target.value))}
              >
                <option value="" disabled>请选择</option>
                {request.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            )}
            {(request?.method === "input" || isEditor) && (
              <TextField
                autoFocus
                className="extension-ui-host-input"
                multiline={isEditor}
                minRows={isEditor ? 10 : 1}
                label={request.method === "input" ? request.placeholder : undefined}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (!isEditor && event.key === "Enter") { event.preventDefault(); submit(); }
                }}
              />
            )}
          </div>
          <DialogFooter className="extension-ui-host-footer">
            <Button variant="quiet" onClick={() => void finish()}>取消</Button>
            {!isSelect && <Button variant="solid" onClick={submit}>{isConfirm ? "确认" : "提交"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {notice ? (
        <div className={`extension-ui-host-notice extension-ui-host-notice-${notice.severity}`} role={notice.severity === "error" ? "alert" : "status"} aria-live={notice.severity === "error" ? "assertive" : "polite"}>
          <span>{notice.message}</span>
          <Button variant="quiet" size="sm" aria-label="关闭通知" onClick={() => setNotice(null)}>关闭</Button>
        </div>
      ) : null}
    </>
  );
}
