import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import type { ProjectTrustChoice, ProjectTrustInfo } from "../../types/dto";

export interface ProjectTrustDialogProps { open: boolean; workspace: string; trust?: ProjectTrustInfo | null; busy?: boolean; onDecide: (decision: ProjectTrustChoice) => void; onCancel: () => void; }
function labelFor(root: string): string { const parts = root.split(/[\\/]/).filter(Boolean); return parts.at(-1) || root; }

export function ProjectTrustDialog({ open, workspace, trust, busy, onDecide, onCancel }: ProjectTrustDialogProps): React.ReactElement {
	return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}><DialogContent aria-busy={busy || undefined}><DialogTitle>信任此项目？</DialogTitle><div className="omega-dialog-content-area omega-form-stack">{busy ? <p role="status" aria-live="polite" className="omega-muted-text">正在保存信任设置…</p> : null}<p>「{labelFor(workspace)}」包含可执行的项目扩展、技能或 prompt。</p><p className="omega-mono-text">{workspace}</p><div className="omega-callout"><p>信任后才会加载该项目自己的 `.pi` 资源和技能。选择「永不信任」仍可打开工作区，但这些资源会保持休眠。</p></div>{trust?.saved === "trusted" ? <p className="omega-muted-text">已保存过信任决策，可在此重新确认。</p> : null}</div><DialogFooter><Button onClick={onCancel} disabled={busy}>取消</Button><Button onClick={() => onDecide("never")} disabled={busy}>永不信任</Button><Button onClick={() => onDecide("once")} disabled={busy}>仅本次</Button><Button variant="solid" onClick={() => onDecide("always")} disabled={busy}>始终信任</Button></DialogFooter></DialogContent></Dialog>;
}
