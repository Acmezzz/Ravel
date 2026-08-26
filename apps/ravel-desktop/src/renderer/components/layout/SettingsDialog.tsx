import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import type { ResourceBundle } from "../../types/dto";

const MODE_KEY: Record<"all" | "one-at-a-time", "settings.mode.all" | "settings.mode.oneAtATime"> = {
  all: "settings.mode.all",
  "one-at-a-time": "settings.mode.oneAtATime",
};

const PERMISSION_KEY = {
  trusted: "settings.permission.trusted",
  "workspace-only": "settings.permission.workspaceOnly",
  "read-only": "settings.permission.readOnly",
  "ask-before-command": "settings.permission.askBeforeCommand",
} as const;

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function SectionTitle({ title }: { title: string }): React.ReactElement {
  return (
    <Typography
      sx={{
        fontSize: "0.65625rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--omega-text-dim)",
        mb: 1,
      }}
    >
      {title}
    </Typography>
  );
}

function ResourceGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--omega-text-muted)", mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.ReactElement {
  const t = useT();
  const agent = useAppStore((s) => s.agent);
  const setAgent = useAppStore((s) => s.setAgent);
  const desktopSettings = useAppStore((s) => s.desktopSettings);
  const setDesktopSettings = useAppStore((s) => s.setDesktopSettings);
  const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);
  const setResourceCenterOpen = useAppStore((s) => s.setResourceCenterOpen);
  const setTrustCenterOpen = useAppStore((s) => s.setTrustCenterOpen);
  const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);

  const [activeTab, setActiveTab] = React.useState<"agent" | "desktop" | "resources">("agent");
  const [resources, setResources] = React.useState<ResourceBundle | null>(null);
  const [workerCap, setWorkerCap] = React.useState(String(desktopSettings?.workerCap ?? 3));
  const [idleTtl, setIdleTtl] = React.useState(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
  const [keybindings, setKeybindings] = React.useState(desktopSettings?.keybindings ?? { commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape", zoomIn: "Ctrl+=", zoomOut: "Ctrl+-", zoomReset: "Ctrl+0" });
  const [desktopError, setDesktopError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [resourceQuery, setResourceQuery] = React.useState("");

  /** Case-insensitive match against name/description/path for resource lists. */
  const matchesResource = React.useCallback(
    (fields: Array<string | undefined | null>) => {
      const q = resourceQuery.trim().toLowerCase();
      if (!q) return true;
      return fields.some((field) => (field ?? "").toLowerCase().includes(q));
    },
    [resourceQuery],
  );

  React.useEffect(() => {
    if (!open) return;
    setWorkerCap(String(desktopSettings?.workerCap ?? 3));
    setIdleTtl(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
    setKeybindings(desktopSettings?.keybindings ?? { commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape", zoomIn: "Ctrl+=", zoomOut: "Ctrl+-", zoomReset: "Ctrl+0" });
    setDesktopError(null);
  }, [open, desktopSettings]);

  React.useEffect(() => {
    if (!open) {
      setResources(null);
      setResourceQuery("");
      return;
    }
    void ipc.listResources().then((res) => {
      if (res.ok) setResources(res.data);
    });
  }, [open, workspaceEpoch]);

  const apply = React.useCallback(
    async (patch: {
      steeringMode?: "all" | "one-at-a-time";
      followUpMode?: "all" | "one-at-a-time";
      autoCompaction?: boolean;
      autoRetry?: boolean;
    }) => {
      setSaveState("saving");
      try {
        const res = await ipc.updateSettings(patch);
        if (res.ok) {
          setAgent(res.data);
          setSaveState("saved");
        } else {
          setDesktopError(res.message);
          setSaveState("idle");
        }
      } catch (reason) {
        setDesktopError(reason instanceof Error ? reason.message : String(reason));
        setSaveState("idle");
      }
    },
    [setAgent],
  );

  const applyDesktopPatch = React.useCallback(
    async (patch: Parameters<typeof ipc.updateDesktopSettings>[0]) => {
      setSaveState("saving");
      try {
        const res = await ipc.updateDesktopSettings(patch);
        if (res.ok) {
          setDesktopSettings(res.data);
          setDesktopError(null);
          setSaveState("saved");
        } else {
          setDesktopError(res.message);
          setSaveState("idle");
        }
      } catch (reason) {
        setDesktopError(reason instanceof Error ? reason.message : String(reason));
        setSaveState("idle");
      }
    },
    [setDesktopSettings],
  );

  const applyDesktop = React.useCallback(async () => {
    const cap = Number.parseInt(workerCap, 10);
    const minutes = Number.parseInt(idleTtl, 10);
    if (!Number.isInteger(cap) || cap < 1 || cap > 8) {
      setDesktopError(t("settings.error.workerCap"));
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      setDesktopError(t("settings.error.idleTtl"));
      return;
    }
    await applyDesktopPatch({
      workerCap: cap,
      workerIdleTtlMs: minutes * 60_000,
    });
  }, [applyDesktopPatch, workerCap, idleTtl, t]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700, px: 3, pt: 2.5, pb: 1.5 }}>{t("settings.title")}</DialogTitle>

      <Box sx={{ px: 1.5, borderBottom: "1px solid var(--omega-border)" }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          sx={{ minHeight: 38, "& .MuiTab-root": { minHeight: 38, fontSize: "0.8125rem", px: 1.5 } }}
        >
          <Tab label={t("settings.tab.agent")} value="agent" />
          <Tab label={t("settings.tab.desktop")} value="desktop" />
          <Tab label={t("settings.tab.resources")} value="resources" />
        </Tabs>
      </Box>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 2.5, pb: 2.5, minHeight: 340 }}>
        {activeTab === "agent" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <TextField
              select
              fullWidth
              size="small"
              label={t("settings.steeringMode")}
              value={agent?.steeringMode ?? "all"}
              onChange={(e) => void apply({ steeringMode: e.target.value as "all" | "one-at-a-time" })}
            >
              {(Object.keys(MODE_KEY) as Array<"all" | "one-at-a-time">).map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {t(MODE_KEY[mode])}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              size="small"
              label={t("settings.followUpMode")}
              value={agent?.followUpMode ?? "all"}
              onChange={(e) => void apply({ followUpMode: e.target.value as "all" | "one-at-a-time" })}
            >
              {(Object.keys(MODE_KEY) as Array<"all" | "one-at-a-time">).map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {t(MODE_KEY[mode])}
                </MenuItem>
              ))}
            </TextField>

            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--omega-border)",
                borderRadius: "12px",
                overflow: "hidden",
                background: "var(--omega-bg-soft)",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, px: 1.5, py: 1.25, minHeight: 48 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--omega-text)" }}>{t("settings.autoCompaction")}</Typography>
                  <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)", mt: 0.25 }}>{t("settings.autoCompactionHint")}</Typography>
                </Box>
                <Switch
                  checked={agent?.autoCompaction ?? true}
                  onChange={(e) => void apply({ autoCompaction: e.target.checked })}
                  sx={{ flex: "0 0 auto" }}
                />
              </Box>
              <Box sx={{ height: "1px", background: "var(--omega-border)" }} />
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, px: 1.5, py: 1.25, minHeight: 48 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--omega-text)" }}>{t("settings.autoRetry")}</Typography>
                  <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)", mt: 0.25 }}>{t("settings.autoRetryHint")}</Typography>
                </Box>
                <Switch
                  checked={agent?.autoRetry ?? true}
                  onChange={(e) => void apply({ autoRetry: e.target.checked })}
                  sx={{ flex: "0 0 auto" }}
                />
              </Box>
            </Box>
          </Box>
        )}

        {activeTab === "desktop" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <Box>
              <SectionTitle title={t("settings.section.permission")} />
              <TextField
                select
                fullWidth
                size="small"
                label={t("settings.permissionProfile")}
                value={desktopSettings?.permissionProfile ?? "trusted"}
                onChange={(event) => {
                  const profile = event.target.value as NonNullable<NonNullable<ReturnType<typeof useAppStore.getState>["desktopSettings"]>["permissionProfile"]>;
                  setSaveState("saving");
                  void ipc.setPermissionProfile({ profile }).then((res) => {
                    if (res.ok) {
                      setDesktopSettings(res.data);
                      setDesktopError(null);
                      setSaveState("saved");
                    } else {
                      setDesktopError(res.message);
                      setSaveState("idle");
                    }
                  }).catch((reason) => {
                    setDesktopError(reason instanceof Error ? reason.message : String(reason));
                    setSaveState("idle");
                  });
                }}
                helperText={t("settings.permissionHelper")}
              >
                {Object.entries(PERMISSION_KEY).map(([value, key]) => (
                  <MenuItem key={value} value={value}>
                    {t(key)}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <Box>
              <SectionTitle title={t("settings.section.keybindings")} />
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                <TextField
                  size="small"
                  label={t("settings.kb.commandPalette")}
                  value={keybindings.commandPalette}
                  onChange={(e) => setKeybindings((c) => ({ ...c, commandPalette: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label={t("settings.kb.newSession")}
                  value={keybindings.newSession}
                  onChange={(e) => setKeybindings((c) => ({ ...c, newSession: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label={t("settings.kb.abort")}
                  value={keybindings.abort}
                  onChange={(e) => setKeybindings((c) => ({ ...c, abort: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label={t("settings.kb.zoomIn")}
                  value={keybindings.zoomIn}
                  onChange={(e) => setKeybindings((c) => ({ ...c, zoomIn: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label={t("settings.kb.zoomOut")}
                  value={keybindings.zoomOut}
                  onChange={(e) => setKeybindings((c) => ({ ...c, zoomOut: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label={t("settings.kb.zoomReset")}
                  value={keybindings.zoomReset}
                  onChange={(e) => setKeybindings((c) => ({ ...c, zoomReset: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
              </Box>
            </Box>

            <Box>
              <SectionTitle title={t("settings.section.runtime")} />
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                <TextField
                  select
                  size="small"
                  label={t("settings.language")}
                  value={desktopSettings?.language ?? "zh-CN"}
                  onChange={(e) => void applyDesktopPatch({ language: e.target.value as "zh-CN" | "en-US" })}
                >
                  <MenuItem value="zh-CN">简体中文</MenuItem>
                  <MenuItem value="en-US">English</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  label={t("settings.workerCap")}
                  value={workerCap}
                  onChange={(e) => setWorkerCap(e.target.value)}
                  onBlur={() => void applyDesktop()}
                />
                <TextField
                  size="small"
                  label={t("settings.idleTtl")}
                  value={idleTtl}
                  onChange={(e) => setIdleTtl(e.target.value)}
                  onBlur={() => void applyDesktop()}
                />
              </Box>
              {desktopError ? (
                <Typography role="alert" sx={{ fontSize: "0.75rem", color: "var(--omega-danger)", mt: 0.75 }}>{desktopError}</Typography>
              ) : saveState === "saving" ? (
                <Typography role="status" aria-live="polite" sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)", mt: 0.75 }}>{t("settings.saving")}</Typography>
              ) : saveState === "saved" ? (
                <Typography role="status" aria-live="polite" sx={{ fontSize: "0.75rem", color: "var(--omega-success)", mt: 0.75 }}>{t("settings.saved")}</Typography>
              ) : null}
            </Box>

            <Box sx={{ display: "flex", gap: 1, pt: 0.5, borderTop: "1px solid var(--omega-border)" }}>
              <Button
                size="small"
                startIcon={<HubOutlinedIcon sx={{ fontSize: "1rem" }} />}
                onClick={() => {
                  onClose();
                  setModelCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                {t("settings.openModelCenter")}
              </Button>
              <Button
                size="small"
                startIcon={<ExtensionOutlinedIcon sx={{ fontSize: "1rem" }} />}
                onClick={() => {
                  onClose();
                  setResourceCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                {t("settings.openResourceCenter")}
              </Button>
              <Button
                size="small"
                startIcon={<ShieldOutlinedIcon sx={{ fontSize: "1rem" }} />}
                onClick={() => {
                  onClose();
                  setTrustCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                {t("settings.openTrustCenter")}
              </Button>
            </Box>
          </Box>
        )}

        {activeTab === "resources" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {agent?.projectTrusted === false ? (
              <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-warning)" }}>
                {t("settings.untrustedProject")}
              </Typography>
            ) : null}
            {!resources ? (
              <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.loadingResources")}</Typography>
            ) : (
              <>
                <TextField
                  size="small"
                  label={t("settings.resourceSearch")}
                  value={resourceQuery}
                  onChange={(e) => setResourceQuery(e.target.value)}
                  helperText={resourceQuery.trim() ? t("settings.resourceFiltered") : undefined}
                />
                <ResourceGroup
                  title={`扩展（${resources.extensions.filter((extension) => matchesResource([extension.name, extension.path])).length}/${resources.extensions.length}）`}
                >
                  {resources.extensions.length === 0 ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.extensionsEmpty")}</Typography>
                  ) : null}
                  {resources.extensions
                    .filter((extension) => matchesResource([extension.name, extension.path]))
                    .map((extension) => (
                      <Box key={extension.path} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.35 }}>
                        <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)", fontWeight: 600 }}>{extension.name}</Typography>
                        {extension.commands > 0 ? <Chip size="small" label={t("settings.chip.commands", { n: extension.commands })} sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
                        {extension.tools > 0 ? <Chip size="small" label={t("settings.chip.tools", { n: extension.tools })} sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
                        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap title={extension.path}>
                          {extension.path}
                        </Typography>
                      </Box>
                    ))}
                  {resources.extensions.length > 0 && resources.extensions.every((extension) => !matchesResource([extension.name, extension.path])) ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.extensionsNoMatch")}</Typography>
                  ) : null}
                </ResourceGroup>

                <ResourceGroup
                  title={t("settings.group.skills", {
                    matched: resources.skills.filter((skill) => matchesResource([skill.name, skill.description])).length,
                    total: resources.skills.length,
                  })}
                >
                  {resources.skills.length === 0 ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.skillsEmpty")}</Typography>
                  ) : null}
                  {resources.skills
                    .filter((skill) => matchesResource([skill.name, skill.description]))
                    .map((skill) => (
                      <Box key={skill.filePath} sx={{ py: 0.35 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)", fontWeight: 600 }}>/skill:{skill.name}</Typography>
                          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                            {skill.description.slice(0, 60)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  {resources.skills.length > 0 && resources.skills.every((skill) => !matchesResource([skill.name, skill.description])) ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.skillsNoMatch")}</Typography>
                  ) : null}
                </ResourceGroup>

                <ResourceGroup
                  title={t("settings.group.prompts", {
                    matched: resources.prompts.filter((promptResource) => matchesResource([promptResource.name, promptResource.description])).length,
                    total: resources.prompts.length,
                  })}
                >
                  {resources.prompts.length === 0 ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.promptsEmpty")}</Typography>
                  ) : null}
                  {resources.prompts
                    .filter((promptResource) => matchesResource([promptResource.name, promptResource.description]))
                    .map((promptResource) => (
                      <Box key={promptResource.filePath} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.35 }}>
                        <Typography sx={{ fontSize: "0.8125rem", fontFamily: "ui-monospace, Consolas, monospace", color: "var(--omega-accent)" }}>
                          /{promptResource.name}
                        </Typography>
                        {promptResource.argumentHint ? (
                          <Chip size="small" label={promptResource.argumentHint} sx={{ height: 18, fontSize: "0.65625rem" }} />
                        ) : null}
                        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                          {promptResource.description.slice(0, 60)}
                        </Typography>
                      </Box>
                    ))}
                  {resources.prompts.length > 0 && resources.prompts.every((promptResource) => !matchesResource([promptResource.name, promptResource.description])) ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>{t("settings.promptsNoMatch")}</Typography>
                  ) : null}
                </ResourceGroup>
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, borderTop: "1px solid var(--omega-border)" }}>
        <Button variant="contained" onClick={onClose} sx={{ textTransform: "none", px: 2.5 }}>
          {t("settings.done")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
