import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ResourceBundle } from "../../types/dto";

const MODE_LABEL: Record<"all" | "one-at-a-time", string> = {
  all: "全部合并发送",
  "one-at-a-time": "逐条发送",
};

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function ResourceGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "var(--omega-text-muted)", letterSpacing: "0.05em", mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * Agent behavior settings (pi SettingsManager) + a read-only inventory of the
 * extensions / skills / prompt templates discovered for the active workspace.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.ReactElement {
  const agent = useAppStore((s) => s.agent);
  const setAgent = useAppStore((s) => s.setAgent);
  const desktopSettings = useAppStore((s) => s.desktopSettings);
  const setDesktopSettings = useAppStore((s) => s.setDesktopSettings);
  const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);
  const setResourceCenterOpen = useAppStore((s) => s.setResourceCenterOpen);
  const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);
  const [resources, setResources] = React.useState<ResourceBundle | null>(null);
  const [workerCap, setWorkerCap] = React.useState(String(desktopSettings?.workerCap ?? 3));
  const [idleTtl, setIdleTtl] = React.useState(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
  const [desktopError, setDesktopError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setWorkerCap(String(desktopSettings?.workerCap ?? 3));
    setIdleTtl(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
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
      const res = await ipc.updateSettings(patch);
      if (res.ok) setAgent(res.data);
    },
    [setAgent],
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
    const res = await ipc.updateDesktopSettings({
      workerCap: cap,
      workerIdleTtlMs: minutes * 60_000,
    });
    if (!res.ok) {
      setDesktopError(res.message);
      return;
    }
    setDesktopSettings(res.data);
    setDesktopError(null);
  }, [workerCap, idleTtl, setDesktopSettings]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>设置</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1 }}>
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
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={agent?.autoCompaction ?? true}
                onChange={(e) => void apply({ autoCompaction: e.target.checked })}
              />
            }
            label={<Typography sx={{ fontSize: 13 }}>上下文接近上限时自动压缩</Typography>}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={agent?.autoRetry ?? true}
                onChange={(e) => void apply({ autoRetry: e.target.checked })}
              />
            }
            label={<Typography sx={{ fontSize: 13 }}>请求失败时自动重试</Typography>}
          />
        </Box>

        <Box sx={{ borderTop: "1px solid var(--omega-border)", pt: 1.5, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "var(--omega-text-muted)", letterSpacing: "0.05em" }}>
            桌面运行时
          </Typography>
          <TextField
            size="small"
            label="后台会话上限"
            value={workerCap}
            onChange={(e) => setWorkerCap(e.target.value)}
            onBlur={() => void applyDesktop()}
            helperText="同时保留的 live Worker 数量，超出后需先停止一个会话"
          />
          <TextField
            size="small"
            label="空闲回收（分钟）"
            value={idleTtl}
            onChange={(e) => setIdleTtl(e.target.value)}
            onBlur={() => void applyDesktop()}
            helperText="后台空闲 Worker 超过该时间后回收"
          />
          {desktopError ? (
            <Typography sx={{ fontSize: 12, color: "var(--omega-danger)" }}>{desktopError}</Typography>
          ) : null}
          <Button
            size="small"
            onClick={() => {
              onClose();
              setModelCenterOpen(true);
            }}
            sx={{ textTransform: "none", alignSelf: "flex-start" }}
          >
            打开模型中心
          </Button>
          <Button
            size="small"
            onClick={() => {
              onClose();
              setResourceCenterOpen(true);
            }}
            sx={{ textTransform: "none", alignSelf: "flex-start" }}
          >
            打开资源中心
          </Button>
        </Box>

        <Box sx={{ borderTop: "1px solid var(--omega-border)", pt: 1.5 }}>
          {agent?.projectTrusted === false ? (
            <Typography sx={{ fontSize: 12.5, color: "var(--omega-warning)", mb: 1 }}>
              当前项目未信任，项目扩展、技能和 prompt 处于休眠状态。可在项目切换器中重新设置信任。
            </Typography>
          ) : null}
          {!resources ? (
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>加载扩展资源…</Typography>
          ) : (
            <>
              <ResourceGroup title={`扩展（${resources.extensions.length}）`}>
                {resources.extensions.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>当前工作区未加载扩展。</Typography>
                ) : (
                  resources.extensions.map((extension) => (
                    <Box key={extension.path} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}>
                      <Typography sx={{ fontSize: 12.5, color: "var(--omega-text)", fontWeight: 600 }}>{extension.name}</Typography>
                      {extension.commands > 0 ? <Chip size="small" label={`${extension.commands} 命令`} sx={{ height: 18, fontSize: 10 }} /> : null}
                      {extension.tools > 0 ? <Chip size="small" label={`${extension.tools} 工具`} sx={{ height: 18, fontSize: 10 }} /> : null}
                      <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap title={extension.path}>
                        {extension.path}
                      </Typography>
                    </Box>
                  ))
                )}
              </ResourceGroup>
              <ResourceGroup title={`Skills（${resources.skills.length}）`}>
                {resources.skills.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>无 skills。可用 /skill:name 调用。</Typography>
                ) : (
                  resources.skills.map((skill) => (
                    <Box key={skill.filePath} sx={{ py: 0.4 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography sx={{ fontSize: 12.5, color: "var(--omega-text)", fontWeight: 600 }}>/skill:{skill.name}</Typography>
                        <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                          {skill.description.slice(0, 60)}
                        </Typography>
                      </Box>
                    </Box>
                  ))
                )}
              </ResourceGroup>
              <ResourceGroup title={`Prompt 模板（${resources.prompts.length}）`}>
                {resources.prompts.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>无 prompt 模板。</Typography>
                ) : (
                  resources.prompts.map((promptResource) => (
                    <Box key={promptResource.filePath} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}>
                      <Typography sx={{ fontSize: 12.5, fontFamily: "ui-monospace, Consolas, monospace", color: "var(--omega-accent)" }}>
                        /{promptResource.name}
                      </Typography>
                      {promptResource.argumentHint ? (
                        <Chip size="small" label={promptResource.argumentHint} sx={{ height: 18, fontSize: 10 }} />
                      ) : null}
                      <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", minWidth: 0, ml: "auto" }} noWrap>
                        {promptResource.description.slice(0, 60)}
                      </Typography>
                    </Box>
                  ))
                )}
              </ResourceGroup>
            </>
          )}
        </Box>

        <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }}>
          Agent 行为通过 pi SettingsManager 持久化；窗口、主题和 Worker 上限保存在桌面设置里。
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={onClose} sx={{ textTransform: "none" }}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
}
