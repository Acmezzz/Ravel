import * as React from "react";
import { ChevronDown, FolderOpen, Plus, Shield, X } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Popover } from "../../ui/Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import type { ProjectTrustChoice, ProjectTrustInfo, WorkspaceInfo } from "../../types/dto";
import { ProjectTrustDialog } from "./ProjectTrustDialog";

function labelFor(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || root;
}

function trustChip(workspace: WorkspaceInfo): string | null {
  if (workspace.resourcesDormant) return "资源休眠";
  if (workspace.trust === "undecided" && workspace.requiresTrust) return "待信任";
  if (workspace.active) return "当前";
  return null;
}

function FolderOpenIcon(): React.ReactElement {
  return <FolderOpen style={{ display: "block", width: "1rem", height: "1rem", flex: "0 0 auto", color: "var(--ravel-accent)" }} strokeWidth={1.5} aria-hidden="true" />;
}

function AddIcon(): React.ReactElement {
  return <Plus style={{ display: "block", width: "1.0625rem", height: "1.0625rem", flex: "0 0 auto", color: "var(--ravel-accent)" }} strokeWidth={1.5} aria-hidden="true" />;
}

function ExpandMoreIcon(): React.ReactElement {
  return <ChevronDown style={{ display: "block", width: "0.9375rem", height: "0.9375rem", flex: "0 0 auto", marginLeft: "auto", color: "var(--ravel-text-muted)" }} strokeWidth={1.5} aria-hidden="true" />;
}

function CloseIcon(): React.ReactElement {
  return <X style={{ display: "block", width: "0.875rem", height: "0.875rem" }} strokeWidth={1.5} aria-hidden="true" />;
}

function ShieldIcon({ size }: { size: string }): React.ReactElement {
  return <Shield style={{ display: "block", width: size, height: size, flex: "0 0 auto" }} strokeWidth={1.4} aria-hidden="true" />;
}

let workspaceLoadGeneration = 0;

async function applyWorkspaceRecord(generation: number): Promise<void> {
  const store = useAppStore.getState();
  const [state, models, commands, sessions, git] = await Promise.all([
    ipc.getState(),
    ipc.listModels(),
    ipc.listCommands(),
    ipc.listSessions(),
    ipc.gitSnapshot(),
  ]).catch(() => []);
  if (generation !== workspaceLoadGeneration) return;
  if (state?.ok) {
    store.setAgent(state.data);
    if (state.data.queuedMessages) {
      store.setQueuedMessages({ steering: state.data.queuedMessages.steering, followUp: state.data.queuedMessages.followUp });
    }
    if (state.data.tree) store.setSessionTree(state.data.tree);
  }
  if (models?.ok) store.setModels(models.data);
  if (commands?.ok) store.setCommands(commands.data);
  if (sessions?.ok) store.applySessionPage(sessions.data);
  store.setGitSnapshot(git?.ok ? git.data : null);
  store.closeViewer();
  store.bumpWorkspaceEpoch();
}

const TRIGGER_BASE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 10px",
  height: 30,
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: 220,
  borderRadius: "9px",
  border: "1px solid var(--ravel-border)",
  background: "var(--ravel-bg-soft)",
  font: "inherit",
  textAlign: "left",
  transition:
    "background-color 140ms var(--ravel-ease-out, cubic-bezier(0.22,1,0.36,1)), border-color 140ms var(--ravel-ease-out, cubic-bezier(0.22,1,0.36,1)), color 140ms var(--ravel-ease-out, cubic-bezier(0.22,1,0.36,1)), opacity 140ms var(--ravel-ease-out, cubic-bezier(0.22,1,0.36,1))",
};

export function ProjectSwitcher(): React.ReactElement {
  const agent = useAppStore((state) => state.agent);
  const connection = useAppStore((state) => state.connection);
  const shutdownPhase = useAppStore((state) => state.shutdownPhase);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [workspaces, setWorkspaces] = React.useState<WorkspaceInfo[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingTrust, setPendingTrust] = React.useState<{ workspace: string; trust: ProjectTrustInfo | null } | null>(null);

  const refresh = React.useCallback(async () => {
    const result = await ipc.listWorkspaces();
    if (result.ok) setWorkspaces(result.data);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = React.useCallback(async (root: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.switchWorkspace({ workspace: root });
      if (result.ok) {
        const generation = ++workspaceLoadGeneration;
        useAppStore.getState().loadTranscript(result.data);
        await applyWorkspaceRecord(generation);
        setAnchor(null);
        await refresh();
      } else if (result.code === "trust_required") {
        const trust = await ipc.inspectProjectTrust({ workspace: root });
        setPendingTrust({ workspace: root, trust: trust.ok ? trust.data : null });
      } else {
        setError(result.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const choose = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.chooseWorkspace();
      if (result.ok) {
        setWorkspaces(result.data.workspaces);
        let trust = result.data.trust;
        if (!trust) {
          const inspected = await ipc.inspectProjectTrust({ workspace: result.data.root });
          trust = inspected.ok ? inspected.data : undefined;
        }
        if (trust?.requiresTrust && trust.decision === "undecided") {
          setPendingTrust({ workspace: result.data.root, trust });
          setBusy(false);
          return;
        }
        await switchTo(result.data.root);
        return;
      }
      if (result.code !== "cancelled") setError(result.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [switchTo]);

  const decideTrust = React.useCallback(async (decision: ProjectTrustChoice) => {
    if (!pendingTrust) return;
    setBusy(true);
    try {
      const result = await ipc.decideProjectTrust({ workspace: pendingTrust.workspace, decision });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setWorkspaces(result.data.workspaces);
      setPendingTrust(null);
      if (result.data.reloaded) {
        const generation = ++workspaceLoadGeneration;
        await applyWorkspaceRecord(generation);
        setAnchor(null);
      } else {
        await switchTo(pendingTrust.workspace);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [pendingTrust, switchTo]);

  const removeWorkspace = React.useCallback(async (workspace: WorkspaceInfo, event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    setError(null);
    const result = await ipc.removeWorkspace({ workspace: workspace.realRoot });
    if (result.ok) setWorkspaces(result.data);
    else setError(result.message);
    setBusy(false);
  }, []);

  const current = agent?.cwd || "未选择项目";
  const currentWorkspace = workspaces.find((item) => item.realRoot === current);
  const disabled = busy || connection === "running" || shutdownPhase !== "idle";
  const dormant = Boolean(currentWorkspace?.resourcesDormant || agent?.projectTrusted === false);

  return (
    <>
      <button
        type="button"
        className={disabled ? "omega-switcher-trigger is-disabled" : "omega-switcher-trigger"}
        style={{ ...TRIGGER_BASE_STYLE, ...(disabled ? { cursor: "default", opacity: 0.55 } : {}) }}
        disabled={disabled}
        onClick={(event) => {
          setError(null);
          setAnchor(event.currentTarget);
          void refresh();
        }}
      >
        <FolderOpenIcon />
        <span
          title={current}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ravel-text)" }}
        >
          {labelFor(current)}
        </span>
        {dormant ? (
          <span
            className="omega-chip omega-chip-warning omega-switcher-chip"
            style={{ flex: "0 0 auto", background: "var(--ravel-warning-soft)", border: "none" }}
          >
            <ShieldIcon size="0.75rem" />
            未信任
          </span>
        ) : null}
        <ExpandMoreIcon />
      </button>

      <Popover
        open={Boolean(anchor)}
        anchor={anchor}
        onOpenChange={(next) => { if (!next) setAnchor(null); }}
        ariaLabel="切换项目"
        className="omega-header-menu"
      >
        {workspaces.map((workspace) => {
          const chip = trustChip(workspace);
          const isCurrent = workspace.realRoot === current;
          return (
            <div key={workspace.workspaceId} className="omega-switcher-row" style={{ display: "flex", alignItems: "center", minWidth: 240 }}>
              <button
                type="button"
                className="omega-menu-item"
                aria-current={isCurrent ? "true" : undefined}
                disabled={busy}
                style={{ minWidth: 0, flex: 1, fontWeight: isCurrent ? 600 : undefined, ...(isCurrent ? { background: "var(--ravel-accent-soft)", color: "var(--ravel-accent-strong)" } : {}) }}
                onClick={() => void switchTo(workspace.realRoot)}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>{labelFor(workspace.displayPath)}</span>
                    {chip ? <span className="omega-chip">{chip}</span> : null}
                  </span>
                  <span
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "0.65625rem",
                      fontWeight: 400,
                      color: "var(--ravel-text-dim)",
                      fontFamily: "ui-monospace, Consolas, monospace",
                    }}
                  >
                    {workspace.displayPath}
                  </span>
                </span>
              </button>
              {!isCurrent ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      size="sm"
                      label={`从列表中移除 ${labelFor(workspace.displayPath)}`}
                      onClick={(event) => void removeWorkspace(workspace, event)}
                      style={{ color: "var(--ravel-text-dim)", flex: "0 0 auto" }}
                      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--ravel-danger)"; }}
                      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--ravel-text-dim)"; }}
                    >
                      <CloseIcon />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent>从列表中移除</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="omega-menu-item" disabled={busy} onClick={() => void choose()}>
          <AddIcon /> 添加工作区…
        </button>
        <button type="button" className="omega-menu-item" disabled={busy} onClick={() => { setAnchor(null); useAppStore.getState().setTrustCenterOpen(true); }}>
          <ShieldIcon size="1.0625rem" /> 信任中心…
        </button>
        {currentWorkspace?.requiresTrust ? (
          <button
            type="button"
            className="omega-menu-item"
            disabled={busy}
            onClick={() => {
              void ipc.inspectProjectTrust({ workspace: current }).then((result) => {
                setPendingTrust({ workspace: current, trust: result.ok ? result.data : null });
              });
            }}
          >
            <ShieldIcon size="1.0625rem" /> 项目信任…
          </button>
        ) : null}
        {error ? (
          <div role="alert" style={{ padding: "6px 16px", maxWidth: 280, color: "var(--ravel-danger)", fontSize: "0.65625rem" }}>{error}</div>
        ) : null}
      </Popover>

      <ProjectTrustDialog
        open={pendingTrust !== null}
        workspace={pendingTrust?.workspace ?? ""}
        trust={pendingTrust?.trust}
        busy={busy}
        onDecide={(decision) => void decideTrust(decision)}
        onCancel={() => setPendingTrust(null)}
      />
    </>
  );
}
