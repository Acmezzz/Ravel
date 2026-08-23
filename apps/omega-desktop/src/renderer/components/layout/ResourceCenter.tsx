import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ConfiguredPackageInfo, ExtensionResource, PromptResource, ResourceBundle, SkillResource } from "../../types/dto";

function scopeLabel(scope?: string): string {
  if (scope === "project") return "项目";
  if (scope === "temporary") return "临时";
  return "用户";
}

function ResourceRow({
  title,
  subtitle,
  chips,
  enabled,
  dormant,
  busy,
  onToggle,
  extra,
}: {
  title: string;
  subtitle?: string;
  chips?: string[];
  enabled: boolean;
  dormant?: boolean;
  busy: boolean;
  onToggle?: (enabled: boolean) => void;
  extra?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      sx={{
        border: "1px solid var(--omega-border)",
        borderRadius: "12px",
        p: 1.1,
        display: "flex",
        flexDirection: "column",
        gap: 0.6,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: "var(--omega-text)", minWidth: 0 }} noWrap>
          {title}
        </Typography>
        {chips?.map((chip) => (
          <Chip key={chip} size="small" label={chip} sx={{ height: 18, fontSize: 10 }} />
        ))}
        {dormant ? <Chip size="small" label="休眠" sx={{ height: 18, fontSize: 10, color: "var(--omega-warning)" }} /> : null}
        {onToggle ? (
          <Switch
            size="small"
            checked={enabled}
            disabled={busy || dormant}
            onChange={(e) => onToggle(e.target.checked)}
            sx={{ ml: "auto" }}
          />
        ) : null}
      </Box>
      {subtitle ? (
        <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }} noWrap title={subtitle}>
          {subtitle}
        </Typography>
      ) : null}
      {extra}
    </Box>
  );
}

export function ResourceCenter(): React.ReactElement {
  const open = useAppStore((s) => s.layout.resourceCenterOpen);
  const setOpen = useAppStore((s) => s.setResourceCenterOpen);
  const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);
  const [bundle, setBundle] = React.useState<ResourceBundle | null>(null);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await ipc.listResources();
    if (res.ok) setBundle(res.data);
    else setError(res.message);
  }, []);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setStatus(null);
      setError(null);
      return;
    }
    void load();
  }, [open, workspaceEpoch, load]);

  const apply = React.useCallback(async (work: () => Promise<{ ok: boolean; data?: ResourceBundle; message?: string }>, okText: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await work();
      if (!res.ok) {
        setError(res.message ?? "操作失败");
        return;
      }
      if (res.data) setBundle(res.data);
      setStatus(okText);
    } finally {
      setBusy(false);
    }
  }, []);

  const hay = query.trim().toLowerCase();
  const match = (value: string) => !hay || value.toLowerCase().includes(hay);
  const extensions = (bundle?.extensions ?? []).filter((item) => match(`${item.name} ${item.path} ${item.source ?? ""}`));
  const skills = (bundle?.skills ?? []).filter((item) => match(`${item.name} ${item.description} ${item.filePath}`));
  const prompts = (bundle?.prompts ?? []).filter((item) => match(`${item.name} ${item.description} ${item.filePath}`));
  const packages = (bundle?.packages ?? []).filter((item) => match(`${item.source} ${item.installedPath ?? ""}`));

  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>资源中心</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
        <Typography sx={{ fontSize: 12.5, color: "var(--omega-text-muted)" }}>
          管理当前会话加载的扩展、Skills 和 Prompt 模板。安装只接受本机路径，不会联网下载 npm/git 包。
        </Typography>
        {bundle?.projectTrusted === false ? (
          <Typography sx={{ fontSize: 12.5, color: "var(--omega-warning)" }}>
            当前项目未信任，项目级资源处于休眠状态。可在项目切换器中重新设置信任。
          </Typography>
        ) : null}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={() => void apply(() => ipc.installLocalResource({ project: false }), "已安装到用户范围")}
            sx={{ textTransform: "none" }}
          >
            安装到用户
          </Button>
          <Button
            size="small"
            disabled={busy || bundle?.projectTrusted === false}
            onClick={() => void apply(() => ipc.installLocalResource({ project: true }), "已安装到项目范围")}
            sx={{ textTransform: "none" }}
          >
            安装到项目
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void apply(() => ipc.reloadResources(), "已重载当前会话资源")}
            sx={{ textTransform: "none" }}
          >
            重载资源
          </Button>
          {busy ? <CircularProgress size={18} sx={{ alignSelf: "center" }} /> : null}
        </Box>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={bundle?.skillCommandsEnabled !== false}
              disabled={busy || !bundle}
              onChange={(e) => void apply(() => ipc.setSkillCommandsEnabled({ enabled: e.target.checked }), "已更新 skill 命令")}
            />
          }
          label={<Typography sx={{ fontSize: 13 }}>允许模型通过 /skill 调用 Skills</Typography>}
        />
        <TextField
          size="small"
          placeholder="搜索扩展、skill、prompt…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error ? <Typography sx={{ fontSize: 12.5, color: "var(--omega-danger)" }}>{error}</Typography> : null}
        {status ? <Typography sx={{ fontSize: 12.5, color: "var(--omega-accent)" }}>{status}</Typography> : null}

        <Typography className="overline-label">
          扩展（{extensions.length}）
        </Typography>
        {extensions.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的扩展。</Typography>
        ) : (
          extensions.map((extension: ExtensionResource) => (
            <ResourceRow
              key={extension.path}
              title={extension.name}
              subtitle={extension.path}
              chips={[
                scopeLabel(extension.scope),
                extension.origin === "package" ? "包" : "本地",
                extension.commands ? `${extension.commands} 命令` : "",
                extension.tools ? `${extension.tools} 工具` : "",
              ].filter(Boolean)}
              enabled={extension.enabled !== false}
              dormant={extension.dormant}
              busy={busy}
              onToggle={(enabled) =>
                void apply(
                  () =>
                    ipc.setResourceEnabled({
                      kind: "extension",
                      path: extension.path,
                      enabled,
                      project: extension.scope === "project",
                      baseDir: extension.baseDir,
                    }),
                  enabled ? "已启用扩展" : "已禁用扩展",
                )
              }
            />
          ))
        )}

        <Typography className="overline-label">
          Skills（{skills.length}）
        </Typography>
        {skills.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的 skills。</Typography>
        ) : (
          skills.map((skill: SkillResource) => (
            <ResourceRow
              key={skill.filePath}
              title={`/skill:${skill.name}`}
              subtitle={skill.description || skill.filePath}
              chips={[scopeLabel(skill.scope), skill.disableModelInvocation ? "模型不可见" : "模型可见"]}
              enabled={skill.enabled !== false}
              dormant={skill.dormant}
              busy={busy}
              onToggle={(enabled) =>
                void apply(
                  () =>
                    ipc.setResourceEnabled({
                      kind: "skill",
                      path: skill.filePath,
                      enabled,
                      project: skill.scope === "project",
                      baseDir: skill.baseDir,
                    }),
                  enabled ? "已启用 skill" : "已禁用 skill",
                )
              }
              extra={
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    void apply(
                      () => ipc.setSkillModelInvocation({ filePath: skill.filePath, disable: !skill.disableModelInvocation }),
                      skill.disableModelInvocation ? "已允许模型调用" : "已对模型隐藏",
                    )
                  }
                  sx={{ textTransform: "none", alignSelf: "flex-start" }}
                >
                  {skill.disableModelInvocation ? "允许模型调用" : "对模型隐藏"}
                </Button>
              }
            />
          ))
        )}

        <Typography className="overline-label">
          Prompt 模板（{prompts.length}）
        </Typography>
        {prompts.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>没有匹配的 prompt 模板。</Typography>
        ) : (
          prompts.map((prompt: PromptResource) => (
            <ResourceRow
              key={prompt.filePath}
              title={`/${prompt.name}`}
              subtitle={prompt.description || prompt.filePath}
              chips={[scopeLabel(prompt.scope), prompt.argumentHint ?? ""].filter(Boolean)}
              enabled={prompt.enabled !== false}
              dormant={prompt.dormant}
              busy={busy}
              onToggle={(enabled) =>
                void apply(
                  () =>
                    ipc.setResourceEnabled({
                      kind: "prompt",
                      path: prompt.filePath,
                      enabled,
                      project: prompt.scope === "project",
                      baseDir: prompt.baseDir,
                    }),
                  enabled ? "已启用 prompt" : "已禁用 prompt",
                )
              }
            />
          ))
        )}

        <Typography className="overline-label">
          已配置包（{packages.length}）
        </Typography>
        {packages.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>还没有本地安装的包。</Typography>
        ) : (
          packages.map((pkg: ConfiguredPackageInfo) => (
            <Box
              key={`${pkg.scope}:${pkg.source}`}
              sx={{ border: "1px solid var(--omega-border)", borderRadius: "12px", p: 1.1, display: "flex", gap: 1, alignItems: "center" }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                  {pkg.source}
                </Typography>
                <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }} noWrap>
                  {scopeLabel(pkg.scope)} {pkg.installedPath}
                </Typography>
              </Box>
              <Button
                size="small"
                disabled={busy}
                onClick={() => void apply(() => ipc.removeLocalResource({ source: pkg.source, project: pkg.scope === "project" }), "已移除")}
                sx={{ textTransform: "none" }}
              >
                移除
              </Button>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
}
