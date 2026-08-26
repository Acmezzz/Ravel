import * as React from "react";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloseIcon from "@mui/icons-material/Close";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import type { ProjectTrustChoice, ProjectTrustInfo, WorkspaceInfo } from "../../types/dto";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { clickableRole } from "../../lib/a11y";

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
      <Box
        {...(disabled ? {} : clickableRole)}
        onClick={(event) => {
          if (!disabled) {
            setError(null);
            setAnchor(event.currentTarget);
            void refresh();
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          height: 30,
          flex: "0 1 auto",
          minWidth: 0,
          maxWidth: 220,
          borderRadius: "9px",
          border: "1px solid var(--omega-border)",
          background: "var(--omega-bg-soft)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
          transition: "background-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), border-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), opacity 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
          "&:hover": { borderColor: "var(--omega-accent-line)", background: "var(--omega-accent-soft)" },
        }}
      >
        <FolderOpenOutlinedIcon sx={{ fontSize: "1rem", color: "var(--omega-accent)", flex: "0 0 auto" }} />
        <Typography
          sx={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--omega-text)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={current}
        >
          {labelFor(current)}
        </Typography>
        {dormant ? (
          <Chip
            size="small"
            icon={<ShieldOutlinedIcon sx={{ fontSize: "0.75rem" }} />}
            label="未信任"
            sx={{
              height: 18,
              fontSize: "0.65625rem",
              flex: "0 0 auto",
              background: "var(--omega-warning-soft)",
              color: "var(--omega-warning)",
              border: "none",
              "& .MuiChip-icon": { ml: 0.5, color: "var(--omega-warning)" },
            }}
          />
        ) : null}
        <ExpandMoreIcon sx={{ fontSize: "0.9375rem", color: "var(--omega-text-muted)", flex: "0 0 auto", ml: "auto" }} />
      </Box>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {workspaces.map((workspace) => {
          const chip = trustChip(workspace);
          return (
            <MenuItem key={workspace.workspaceId} selected={workspace.realRoot === current} disabled={busy} onClick={() => void switchTo(workspace.realRoot)}>
              <Box sx={{ minWidth: 240, display: "flex", alignItems: "center", gap: 1 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Typography sx={{ fontSize: "0.8125rem", fontWeight: workspace.realRoot === current ? 600 : 400 }}>
                      {labelFor(workspace.displayPath)}
                    </Typography>
                    {chip ? <Chip size="small" label={chip} sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
                  </Box>
                  <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", fontFamily: "ui-monospace, Consolas, monospace" }} noWrap>
                    {workspace.displayPath}
                  </Typography>
                </Box>
                {workspace.realRoot !== current ? (
                  <Tooltip title="从列表中移除">
                    <IconButton
                      size="small"
                      aria-label={`从列表中移除 ${labelFor(workspace.displayPath)}`}
                      onClick={(event) => void removeWorkspace(workspace, event)}
                      sx={{ color: "var(--omega-text-dim)", "&:hover": { color: "var(--omega-danger)" } }}
                    >
                      <CloseIcon sx={{ fontSize: "0.875rem" }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Box>
            </MenuItem>
          );
        })}
        <MenuItem disabled={busy} onClick={() => void choose()}>
          <AddIcon sx={{ fontSize: "1.0625rem", mr: 1, color: "var(--omega-accent)" }} /> 添加工作区…
        </MenuItem>
        <MenuItem disabled={busy} onClick={() => { setAnchor(null); useAppStore.getState().setTrustCenterOpen(true); }}>
          <ShieldOutlinedIcon sx={{ fontSize: "1.0625rem", mr: 1, color: "var(--omega-accent)" }} /> 信任中心…
        </MenuItem>
        {currentWorkspace?.requiresTrust ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              void ipc.inspectProjectTrust({ workspace: current }).then((result) => {
                setPendingTrust({ workspace: current, trust: result.ok ? result.data : null });
              });
            }}
          >
            <ShieldOutlinedIcon sx={{ fontSize: "1.0625rem", mr: 1, color: "var(--omega-accent)" }} /> 项目信任…
          </MenuItem>
        ) : null}
        {error ? <Typography sx={{ px: 2, py: 0.75, maxWidth: 280, color: "var(--omega-danger)", fontSize: "0.65625rem" }}>{error}</Typography> : null}
      </Menu>

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
