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
import type { ResourceBundle } from "../../types/dto";

const MODE_LABEL: Record<"all" | "one-at-a-time", string> = {
  all: "全部合并发送",
  "one-at-a-time": "逐条发送",
};

const PERMISSION_LABEL: Record<NonNullable<NonNullable<ReturnType<typeof useAppStore.getState>["desktopSettings"]>["permissionProfile"]>, string> = {
  trusted: "Trusted（当前用户权限）",
  "workspace-only": "Workspace-only（仅限工作区）",
  "read-only": "Read-only（只读）",
  "ask-before-command": "Ask before command（执行前确认）",
};

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function SectionTitle({ title }: { title: string }): React.ReactElement {
  return (
    <Typography
      sx={{
        fontSize: 10.5,
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
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--omega-text-muted)", mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.ReactElement {
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
  const [keybindings, setKeybindings] = React.useState(desktopSettings?.keybindings ?? { commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape" });
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
    if (!open) {
      setResourceQuery("");
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setWorkerCap(String(desktopSettings?.workerCap ?? 3));
    setIdleTtl(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
    setKeybindings(desktopSettings?.keybindings ?? { commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape" });
    setDesktopError(null);
  }, [open, desktopSettings]);

  React.useEffect(() => {
    if (!open) {
      setResources(null);
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
      setDesktopError("后台会话上限必须是 1–8 的整数");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      setDesktopError("空闲回收时间必须是 1–60 分钟");
      return;
    }
    await applyDesktopPatch({
      workerCap: cap,
      workerIdleTtlMs: minutes * 60_000,
    });
  }, [applyDesktopPatch, workerCap, idleTtl]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>设置</DialogTitle>

      <Box sx={{ px: 3, borderBottom: "1px solid var(--omega-border)" }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          sx={{ minHeight: 38, "& .MuiTab-root": { minHeight: 38, fontSize: 13, px: 1.5 } }}
        >
          <Tab label="Agent 行为" value="agent" />
          <Tab label="桌面与快捷键" value="desktop" />
          <Tab label="工作区资源" value="resources" />
        </Tabs>
      </Box>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2, pb: 2, minHeight: 340 }}>
        {activeTab === "agent" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              select
              fullWidth
              size="small"
              label="转向模式（生成中插入消息）"
              value={agent?.steeringMode ?? "all"}
              onChange={(e) => void apply({ steeringMode: e.target.value as "all" | "one-at-a-time" })}
            >
              {(Object.keys(MODE_LABEL) as Array<"all" | "one-at-a-time">).map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {MODE_LABEL[mode]}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              size="small"
              label="后续消息模式（排队消息）"
              value={agent?.followUpMode ?? "all"}
              onChange={(e) => void apply({ followUpMode: e.target.value as "all" | "one-at-a-time" })}
            >
              {(Object.keys(MODE_LABEL) as Array<"all" | "one-at-a-time">).map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {MODE_LABEL[mode]}
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
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: "var(--omega-text)" }}>自动压缩上下文</Typography>
                  <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)", mt: 0.25 }}>接近窗口上限时自动压缩历史</Typography>
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
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: "var(--omega-text)" }}>失败自动重试</Typography>
                  <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)", mt: 0.25 }}>请求失败时按策略自动重试</Typography>
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
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box>
              <SectionTitle title="权限配置" />
              <TextField
                select
                fullWidth
                size="small"
                label="工具权限 profile"
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
                helperText="Read-only 和 Workspace-only 会在工具执行前阻止越界或写入。"
              >
                {Object.entries(PERMISSION_LABEL).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <Box>
              <SectionTitle title="快捷键" />
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.25 }}>
                <TextField
                  size="small"
                  label="打开命令面板"
                  value={keybindings.commandPalette}
                  onChange={(e) => setKeybindings((c) => ({ ...c, commandPalette: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label="新建会话"
                  value={keybindings.newSession}
                  onChange={(e) => setKeybindings((c) => ({ ...c, newSession: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
                <TextField
                  size="small"
                  label="停止 Agent"
                  value={keybindings.abort}
                  onChange={(e) => setKeybindings((c) => ({ ...c, abort: e.target.value }))}
                  onBlur={() => void applyDesktopPatch({ keybindings })}
                />
              </Box>
            </Box>

            <Box>
              <SectionTitle title="运行时管理" />
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.25 }}>
                <TextField
                  select
                  size="small"
                  label="界面语言"
                  value={desktopSettings?.language ?? "zh-CN"}
                  onChange={(e) => void applyDesktopPatch({ language: e.target.value as "zh-CN" | "en-US" })}
                >
                  <MenuItem value="zh-CN">简体中文</MenuItem>
                  <MenuItem value="en-US">English</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  label="后台 Worker 上限"
                  value={workerCap}
                  onChange={(e) => setWorkerCap(e.target.value)}
                  onBlur={() => void applyDesktop()}
                />
                <TextField
                  size="small"
                  label="空闲回收（分钟）"
                  value={idleTtl}
                  onChange={(e) => setIdleTtl(e.target.value)}
                  onBlur={() => void applyDesktop()}
                />
              </Box>
              {desktopError ? (
                <Typography role="alert" sx={{ fontSize: 12, color: "var(--omega-danger)", mt: 0.75 }}>{desktopError}</Typography>
              ) : saveState === "saving" ? (
                <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: "var(--omega-text-muted)", mt: 0.75 }}>正在保存设置…</Typography>
              ) : saveState === "saved" ? (
                <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: "var(--omega-success)", mt: 0.75 }}>设置已保存</Typography>
              ) : null}
            </Box>

            <Box sx={{ display: "flex", gap: 1, pt: 0.5, borderTop: "1px solid var(--omega-border)" }}>
              <Button
                size="small"
                startIcon={<HubOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={() => {
                  onClose();
                  setModelCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                模型中心
              </Button>
              <Button
                size="small"
                startIcon={<ExtensionOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={() => {
                  onClose();
                  setResourceCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                资源中心
              </Button>
              <Button
                size="small"
                startIcon={<ShieldOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={() => {
                  onClose();
                  setTrustCenterOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                信任中心
              </Button>
            </Box>
          </Box>
        )}

        {activeTab === "resources" && (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {agent?.projectTrusted === false ? (
              <Typography sx={{ fontSize: 13, color: "var(--omega-warning)", mb: 1.5 }}>
                当前项目未信任，项目扩展、技能和 prompt 处于休眠状态。
              </Typography>
            ) : null}
            {!resources ? (
              <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>加载扩展资源…</Typography>
            ) : (
              <>
                <TextField
                  size="small"
                  label="搜索扩展、技能与 Prompt 模板"
                  value={resourceQuery}
                  onChange={(e) => setResourceQuery(e.target.value)}
                  helperText={resourceQuery.trim() ? "仅显示匹配项" : undefined}
                />
                <ResourceGroup title={`已加载扩展（${resources.extensions.filter((extension) => matchesResource([extension.name, extension.path])).length}/${resources.extensions.length}）`}>
                  {resources.extensions.length === 0 ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>当前工作区未加载扩展。</Typography>
                  ) : null}
                  {resources.extensions
                    .filter((extension) => matchesResource([extension.name, extension.path]))
                    .map((extension) => (
                      <Box key={extension.path} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.35 }}>
                        <Typography sx={{ fontSize: 13, color: "var(--omega-text)", fontWeight: 600 }}>{extension.name}</Typography>
                        {extension.commands > 0 ? <Chip size="small" label={`${extension.commands} 命令`} sx={{ height: 18, fontSize: 10.5 }} /> : null}
                        {extension.tools > 0 ? <Chip size="small" label={`${extension.tools} 工具`} sx={{ height: 18, fontSize: 10.5 }} /> : null}
                        <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap title={extension.path}>
                          {extension.path}
                        </Typography>
                      </Box>
                    ))}
                  {resources.extensions.length > 0 && resources.extensions.every((extension) => !matchesResource([extension.name, extension.path])) ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的扩展。</Typography>
                  ) : null}
                </ResourceGroup>

                <ResourceGroup title={`可用 Skills（${resources.skills.filter((skill) => matchesResource([skill.name, skill.description])).length}/${resources.skills.length}）`}>
                  {resources.skills.length === 0 ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>无 skills。可用 /skill:name 调用。</Typography>
                  ) : null}
                  {resources.skills
                    .filter((skill) => matchesResource([skill.name, skill.description]))
                    .map((skill) => (
                      <Box key={skill.filePath} sx={{ py: 0.35 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography sx={{ fontSize: 13, color: "var(--omega-text)", fontWeight: 600 }}>/skill:{skill.name}</Typography>
                          <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                            {skill.description.slice(0, 60)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  {resources.skills.length > 0 && resources.skills.every((skill) => !matchesResource([skill.name, skill.description])) ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的 skills。</Typography>
                  ) : null}
                </ResourceGroup>

                <ResourceGroup title={`Prompt 模板（${resources.prompts.filter((promptResource) => matchesResource([promptResource.name, promptResource.description])).length}/${resources.prompts.length}）`}>
                  {resources.prompts.length === 0 ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>无 prompt 模板。</Typography>
                  ) : null}
                  {resources.prompts
                    .filter((promptResource) => matchesResource([promptResource.name, promptResource.description]))
                    .map((promptResource) => (
                      <Box key={promptResource.filePath} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.35 }}>
                        <Typography sx={{ fontSize: 13, fontFamily: "ui-monospace, Consolas, monospace", color: "var(--omega-accent)" }}>
                          /{promptResource.name}
                        </Typography>
                        {promptResource.argumentHint ? (
                          <Chip size="small" label={promptResource.argumentHint} sx={{ height: 18, fontSize: 10.5 }} />
                        ) : null}
                        <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                          {promptResource.description.slice(0, 60)}
                        </Typography>
                      </Box>
                    ))}
                  {resources.prompts.length > 0 && resources.prompts.every((promptResource) => !matchesResource([promptResource.name, promptResource.description])) ? (
                    <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的 prompt 模板。</Typography>
                  ) : null}
                </ResourceGroup>
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, borderTop: "1px solid var(--omega-border)" }}>
        <Button variant="contained" onClick={onClose} sx={{ textTransform: "none", px: 2.5 }}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
}
