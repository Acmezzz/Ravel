import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { ipc } from "../../ipc/client";
import type { ChangeApprovalResult, GitStageItem } from "../../types/dto";

export interface ApprovalBarProps {
  snapshotToken: string;
  selectedFiles: string[];
  selectedItems: GitStageItem[];
  hasUntrackedSelected: boolean;
  onApplied: (result: ChangeApprovalResult) => void;
}

function WarningIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 2.4 14.4 13.2H1.6L8 2.4Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.4v3.2M8 11.4v.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Diff approval bar. Accept = no-op (keep changes). Reject = revert the
 * selected files on the MAIN process (git checkout / git clean). Rejecting
 * untracked files is irreversible — we force a second confirmation with a
 * clear risk warning. See system_design.md §3.4 / 决策 #6.
 */
export function ApprovalBar({ snapshotToken, selectedFiles, selectedItems, hasUntrackedSelected, onApplied }: ApprovalBarProps): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const accept = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await ipc.approveChange({ action: "accept" });
      if (res.ok) onApplied(res.data);
      else setError(res.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [onApplied]);

  const openReject = React.useCallback(() => {
    if (selectedFiles.length === 0) return;
    setConfirmOpen(true);
  }, [selectedFiles.length]);

  const confirmReject = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await ipc.approveChange({ action: "reject", files: selectedFiles, items: selectedItems, snapshotToken });
      if (res.ok) {
        onApplied(res.data);
        setConfirmOpen(false);
      } else setError(res.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [selectedFiles, selectedItems, snapshotToken, onApplied]);

  return (
    <div className="omega-approval">
      {error ? <p role="alert" className="omega-error-text omega-approval-error">{error}</p> : null}
      <Button variant="solid" fullWidth onClick={() => void accept()} disabled={busy}>
        保留全部改动
      </Button>
      <Button className="omega-button-danger" fullWidth onClick={openReject} disabled={busy || selectedFiles.length === 0}>
        还原所选 · {selectedFiles.length}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent className="omega-dialog-narrow">
          <DialogTitle className="omega-approval-title">
            <WarningIcon className="omega-icon-warning" /> 确认还原改动？
          </DialogTitle>
          <div className="omega-dialog-content-area omega-form-stack">
            <p className="omega-muted-text">
              将还原选中的 {selectedFiles.length} 个文件。已纳入 git 的文件会回到上一次提交/暂存状态。
            </p>
            {hasUntrackedSelected ? (
              <div className="omega-approval-untracked">
                <WarningIcon className="omega-icon-warning-sm" />
                <p className="omega-error-text">
                  其中包含未跟踪的新文件，还原将通过 git clean 永久删除，此操作不可撤销。
                </p>
              </div>
            ) : null}
            <ul className="omega-approval-files">
              {selectedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="solid" className="omega-button-danger-solid" onClick={() => void confirmReject()} disabled={busy}>
              确认还原
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
