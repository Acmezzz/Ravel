import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import CheckIcon from "@mui/icons-material/Check";
import AddIcon from "@mui/icons-material/Add";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { AuthProviderStatus, ModelInfo } from "../../types/dto";
import { clickableRole } from "../../lib/a11y";

function groupByProvider(models: ModelInfo[]): Array<{ provider: string; models: ModelInfo[] }> {
  const groups: Array<{ provider: string; models: ModelInfo[] }> = [];
  for (const model of models) {
    const group = groups.find((entry) => entry.provider === model.provider);
    if (group) group.models.push(model);
    else groups.push({ provider: model.provider, models: [model] });
  }
  return groups;
}

function ProviderCard({
  provider,
  busy,
  onSave,
  onRemove,
}: {
  provider: AuthProviderStatus;
  busy: boolean;
  onSave: (providerId: string, apiKey: string) => Promise<void>;
  onRemove: (providerId: string) => Promise<void>;
}): React.ReactElement {
  const [apiKey, setApiKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const save = React.useCallback(async () => {
    const next = apiKey.trim();
    if (!next) {
      setError("请输入 API key");
      return;
    }
    setError(null);
    try {
      await onSave(provider.id, next);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiKey, onSave, provider.id]);

  return (
    <Box
      sx={{
        border: "1px solid var(--omega-border)",
        borderRadius: "12px",
        p: 1.25,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--omega-text)", minWidth: 0, flex: 1 }} noWrap>
          {provider.name}
        </Typography>
        <Chip
          size="small"
          label={provider.configured ? "已配置" : "配置中"}
          sx={{
            height: 18,
            fontSize: "0.65625rem",
            flex: "0 0 auto",
            background: provider.configured ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)",
            color: provider.configured ? "var(--omega-accent)" : "var(--omega-text-muted)",
          }}
        />
        {provider.source ? (
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", ml: "auto", minWidth: 0 }} noWrap>
            {provider.source}
          </Typography>
        ) : null}
      </Box>
      <TextField
        type="password"
        size="small"
        autoComplete="off"
        placeholder={provider.configured ? "输入新 key 以替换（不会回显已保存的 key）" : "粘贴 API key"}
        value={apiKey}
        disabled={busy}
        onChange={(e) => setApiKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      {error ? (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-danger)" }}>{error}</Typography>
      ) : (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>
          Key 只写入本机凭据库，界面不会读取或显示已保存的明文。
        </Typography>
      )}
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button size="small" variant="contained" disabled={busy || !apiKey.trim()} onClick={() => void save()} sx={{ textTransform: "none" }}>
          保存 Key
        </Button>
        <Button size="small" disabled={busy || !provider.configured} onClick={() => void onRemove(provider.id)} sx={{ textTransform: "none" }}>
          移除
        </Button>
      </Box>
    </Box>
  );
}

export function ModelCenter(): React.ReactElement {
  const open = useAppStore((s) => s.layout.modelCenterOpen);
  const setOpen = useAppStore((s) => s.setModelCenterOpen);
  const auth = useAppStore((s) => s.auth);
  const models = useAppStore((s) => s.models);
  const setAuth = useAppStore((s) => s.setAuth);
  const setAgent = useAppStore((s) => s.setAgent);
  const setModels = useAppStore((s) => s.setModels);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pendingModel, setPendingModel] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [customProviderOpen, setCustomProviderOpen] = React.useState(false);
  const [addAnchor, setAddAnchor] = React.useState<HTMLElement | null>(null);
  const [draftProvider, setDraftProvider] = React.useState<AuthProviderStatus | null>(null);
  const [customProvider, setCustomProvider] = React.useState({ id: "local-ai", name: "Local AI", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", modelId: "demo", modelName: "Demo", contextWindow: "128000" });

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setStatus(null);
      setDraftProvider(null);
      setAddAnchor(null);
      return;
    }
    void Promise.all([ipc.authStatus(), ipc.listModels()]).then(([authRes, modelsRes]) => {
      if (authRes.ok) setAuth(authRes.data);
      if (modelsRes.ok) setModels(modelsRes.data);
    });
  }, [open, setAuth, setModels]);

  const providers = auth?.providers ?? [];
  const configured = providers.filter((provider) => provider.configured);
  const available = providers.filter((provider) => !provider.configured && provider.id !== draftProvider?.id);
  const visibleProviders = React.useMemo(() => {
    const list = [...configured];
    if (draftProvider && !list.some((provider) => provider.id === draftProvider.id)) list.push(draftProvider);
    return list;
  }, [configured, draftProvider]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(q));
  }, [models, query]);
  const groups = React.useMemo(() => groupByProvider(filtered), [filtered]);

  const saveKey = React.useCallback(
    async (providerId: string, apiKey: string) => {
      setBusy(true);
      setStatus(null);
      try {
        const res = await ipc.setProviderApiKey({ providerId, apiKey });
        if (!res.ok) throw new Error(res.message);
        setAuth(res.data);
        setDraftProvider(null);
        const modelsRes = await ipc.listModels();
        if (modelsRes.ok) setModels(modelsRes.data);
        setStatus(`${providerId} 已保存`);
      } finally {
        setBusy(false);
      }
    },
    [setAuth, setModels],
  );

  const removeKey = React.useCallback(
    async (providerId: string) => {
      setBusy(true);
      setStatus(null);
      try {
        const res = await ipc.removeProviderApiKey({ providerId });
        if (!res.ok) {
          setStatus(res.message);
          return;
        }
        setAuth(res.data);
        if (draftProvider?.id === providerId) setDraftProvider(null);
        setStatus(`${providerId} 已移除`);
      } finally {
        setBusy(false);
      }
    },
    [draftProvider, setAuth],
  );

  const pick = React.useCallback(
    async (model: ModelInfo) => {
      const key = `${model.provider}/${model.id}`;
      setPendingModel(key);
      try {
        const res = await ipc.setModel({ provider: model.provider, modelId: model.id });
        if (res.ok) setAgent(res.data);
      } finally {
        setPendingModel(null);
      }
    },
    [setAgent],
  );

  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>模型中心</DialogTitle>
      <DialogContent sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(260px, 0.9fr) 1.1fr" }, gap: 2.5, pt: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Typography className="overline-label">已配置提供商</Typography>
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: "1rem" }} />}
              onClick={(event) => setAddAnchor(event.currentTarget)}
              sx={{ textTransform: "none", minWidth: 0 }}
            >
              添加
            </Button>
            <Menu
              anchorEl={addAnchor}
              open={Boolean(addAnchor)}
              onClose={() => setAddAnchor(null)}
              PaperProps={{ sx: { minWidth: 220, maxHeight: 360 } }}
            >
              {available.map((provider) => (
                <MenuItem
                  key={provider.id}
                  onClick={() => {
                    setDraftProvider(provider);
                    setAddAnchor(null);
                  }}
                >
                  {provider.name}
                </MenuItem>
              ))}
              <MenuItem
                onClick={() => {
                  setAddAnchor(null);
                  setCustomProviderOpen(true);
                }}
              >
                添加本地 Provider…
              </MenuItem>
            </Menu>
          </Box>
          <Typography sx={{ fontSize: "0.75rem", color: auth?.ready ? "var(--omega-text-muted)" : "var(--omega-warning)" }}>
            {auth?.label ?? "正在读取认证状态"}
          </Typography>
          {visibleProviders.length === 0 ? (
            <Box sx={{ border: "1px dashed var(--omega-border-strong)", borderRadius: "12px", p: 1.5 }}>
              <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text-muted)" }}>还没有配置提供商。</Typography>
              <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)", mt: 0.5 }}>用右上角「添加」从目录里选择供应商，再粘贴 API key。</Typography>
            </Box>
          ) : (
            visibleProviders.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} busy={busy} onSave={saveKey} onRemove={removeKey} />
            ))
          )}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <Typography className="overline-label">模型</Typography>
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>
            只列出当前可用模型。配置提供商后会刷新目录；本地 Provider 可离线使用。
          </Typography>
          <TextField size="small" placeholder="搜索模型…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Box sx={{ overflowY: "auto", maxHeight: 420, pr: 0.5, minWidth: 0 }}>
            {groups.length === 0 ? (
              <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)", py: 1.5 }}>无匹配模型。先添加并配置提供商。</Typography>
            ) : (
              groups.map((group) => (
                <Box key={group.provider} sx={{ mb: 1.25, minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.65625rem", fontWeight: 700, color: "var(--omega-text-dim)", letterSpacing: "0.06em", px: 0.5, py: 0.5 }}>
                    {group.provider.toUpperCase()}
                  </Typography>
                  {group.models.map((model) => {
                    const key = `${model.provider}/${model.id}`;
                    const isPending = pendingModel === key;
                    return (
                      <Box
                        key={key}
                        {...clickableRole}
                        onClick={() => (pendingModel ? undefined : void pick(model))}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1,
                          py: 0.75,
                          borderRadius: "9px",
                          minWidth: 0,
                          cursor: pendingModel ? "wait" : "pointer",
                          opacity: pendingModel && !isPending ? 0.5 : 1,
                          "&:hover": { background: "var(--omega-hover-fill)" },
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)" }} noWrap>
                            {model.id}
                          </Typography>
                          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} noWrap>
                            {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : ""}
                            {model.reasoning ? " · reasoning" : ""}
                          </Typography>
                        </Box>
                        {isPending ? <CircularProgress size={14} sx={{ color: "var(--omega-accent)" }} /> : null}
                        {model.selected && !isPending ? <CheckIcon sx={{ fontSize: "1rem", color: "var(--omega-accent)" }} /> : null}
                      </Box>
                    );
                  })}
                </Box>
              ))
            )}
          </Box>
        </Box>
      </DialogContent>
      <Dialog open={customProviderOpen} onClose={() => setCustomProviderOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加本地 Provider</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {(["id", "name", "baseUrl", "api", "modelId", "modelName", "contextWindow"] as const).map((key) => (
            <TextField key={key} size="small" label={key} value={customProvider[key]} onChange={(event) => setCustomProvider((current) => ({ ...current, [key]: event.target.value }))} />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomProviderOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={() =>
              void ipc
                .configureCustomProvider({
                  id: customProvider.id,
                  name: customProvider.name,
                  baseUrl: customProvider.baseUrl,
                  api: customProvider.api,
                  models: [{ id: customProvider.modelId, name: customProvider.modelName, contextWindow: Number(customProvider.contextWindow), reasoning: false }],
                })
                .then((result) => {
                  if (result.ok) {
                    setModels(result.data.models);
                    setStatus("本地 Provider 已配置");
                    setCustomProviderOpen(false);
                    void ipc.authStatus().then((authRes) => {
                      if (authRes.ok) setAuth(authRes.data);
                    });
                  } else setStatus(result.message);
                })
            }
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: "0.75rem", color: status ? "var(--omega-accent)" : "var(--omega-text-dim)" }}>
          {status ?? "未配置的供应商都收在「添加」菜单里。"}
        </Typography>
        <Button variant="contained" onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
}
