import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import type { ProjectTrustChoice, WorkspaceInfo } from "../../types/dto";

const choices: Array<{ value: ProjectTrustChoice; label: string }> = [{ value: "once", label: "仅本次信任" }, { value: "always", label: "始终信任" }, { value: "never", label: "不信任" }];
function Chip({ children, tone }: { children: React.ReactNode; tone?: string }): React.ReactElement { return <span className={`omega-chip${tone ? ` omega-chip-${tone}` : ""}`}>{children}</span>; }

export function TrustCenter(): React.ReactElement {
	const open = useAppStore((s) => s.layout.trustCenterOpen); const setOpen = useAppStore((s) => s.setTrustCenterOpen);
	const [items, setItems] = React.useState<WorkspaceInfo[]>([]); const [busy, setBusy] = React.useState<string | null>(null); const [error, setError] = React.useState<string | null>(null); const [pendingChoice, setPendingChoice] = React.useState<Record<string, ProjectTrustChoice | "">>({});
	const refresh = React.useCallback(async () => { const result = await ipc.listWorkspaces(); if (result.ok) setItems(result.data); else setError(result.message); }, []);
	React.useEffect(() => { if (open) void refresh(); }, [open, refresh]);
	const decide = async (workspace: WorkspaceInfo, decision: ProjectTrustChoice) => { setBusy(workspace.realRoot); setError(null); setPendingChoice((current) => ({ ...current, [workspace.realRoot]: decision })); const result = await ipc.decideProjectTrust({ workspace: workspace.realRoot, decision }); if (result.ok) setItems(result.data.workspaces); else setError(result.message); setBusy(null); };
	return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="omega-dialog-wide"><DialogTitle>项目 Trust Center</DialogTitle><div className="omega-dialog-content-area omega-form-stack"><p className="omega-muted-text">集中管理项目扩展、skills 和 prompt 的执行信任。父目录已有信任时会在项目状态中显示继承提示。</p>{items.map((workspace) => { const inherited = items.some((parent) => parent.realRoot !== workspace.realRoot && workspace.realRoot.startsWith(`${parent.realRoot.replace(/[\\/]$/, "")}${workspace.realRoot.includes("\\") ? "\\" : "/"}`) && parent.trust === "trusted"); return <div key={workspace.workspaceId} className="omega-trust-row"><div className="omega-trust-name"><strong title={workspace.displayPath}>{workspace.displayPath}</strong><span>{workspace.resourcesDormant ? "项目资源休眠" : "项目资源可用"}</span></div>{inherited ? <Chip>继承父目录信任</Chip> : null}<Chip tone={workspace.trust === "trusted" ? "success" : undefined}>{workspace.trust === "trusted" ? "trusted" : workspace.trust === "untrusted" ? "untrusted" : "undecided"}</Chip><TextField select aria-label={`设置 ${workspace.displayPath} 的信任`} value={pendingChoice[workspace.realRoot] ?? (workspace.trust === "trusted" ? "always" : workspace.trust === "untrusted" ? "never" : "")} disabled={busy === workspace.realRoot} onChange={(event) => { const value = event.target.value as ProjectTrustChoice; if (value) void decide(workspace, value); }}><option value="">请选择</option>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</TextField></div>; })}{items.length === 0 ? <p className="omega-muted-text">还没有已授权工作区。</p> : null}{error ? <p className="omega-error-text">{error}</p> : null}</div><DialogFooter><Button onClick={() => setOpen(false)}>完成</Button></DialogFooter></DialogContent></Dialog>;
}
