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
import CheckIcon from "@mui/icons-material/Check";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { AuthProviderStatus, ModelInfo } from "../../types/dto";

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
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: "var(--omega-text)" }}>{provider.name}</Typography>
        <Chip
          size="small"
          label={provider.configured ? "已配置" : "未配置"}
          sx={{
            height: 18,
            fontSize: 10,
            background: provider.configured ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)",
            color: provider.configured ? "var(--omega-accent)" : "var(--omega-text-muted)",
          }}
        />
        {provider.source ? (
          <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", ml: "auto" }} noWrap>
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
        <Typography sx={{ fontSize: 11.5, color: "var(--omega-danger)" }}>{error}</Typography>
      ) : (
        <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }}>
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
  const [latencyStatus, setLatencyStatus] = React.useState("离线模式：未执行真实 latency test");
  const [customProvider, setCustomProvider] = React.useState({ id: "local-ai", name: "Local AI", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", modelId: "demo", modelName: "Demo", contextWindow: "128000" });

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setStatus(null);
      return;
    }
    void Promise.all([ipc.authStatus(), ipc.listModels()]).then(([authRes, modelsRes]) => {
      if (authRes.ok) setAuth(authRes.data);
      if (modelsRes.ok) setModels(modelsRes.data);
    });
  }, [open, setAuth, setModels]);

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
        setStatus(`${providerId} 已移除`);
      } finally {
        setBusy(false);
      }
    },
    [setAuth],
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
      <DialogContent sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(280px, 0.9fr) 1.1fr" }, gap: 2.5, pt: 1 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "var(--omega-text-muted)", letterSpacing: "0.05em" }}>
            提供商
          </Typography>
          <Typography sx={{ fontSize: 12, color: auth?.ready ? "var(--omega-text-muted)" : "var(--omega-warning)" }}>
            {auth?.label ?? "正在读取认证状态"}
          </Typography>
          {(auth?.providers ?? []).length === 0 ? (
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>当前没有可用提供商。</Typography>
          ) : (
            (auth?.providers ?? []).map((provider) => (
              <ProviderCard key={provider.id} provider={provider} busy={busy} onSave={saveKey} onRemove={removeKey} />
            ))
          )}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "var(--omega-text-muted)", letterSpacing: "0.05em" }}>模型</Typography><Button size="small" onClick={() => setCustomProviderOpen(true)} sx={{ textTransform: "none" }}>添加本地 Provider</Button></Box>
          <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }}>本地配置不会联网 discovery；真实 OAuth 和在线目录需外部环境。{latencyStatus}（静态 builtin catalog 可离线使用）</Typography>
          <TextField size="small" placeholder="搜索模型…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Box sx={{ overflowY: "auto", maxHeight: 420, pr: 0.5 }}>
            {groups.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)", py: 1.5 }}>无匹配模型。先配置提供商 API key。</Typography>
            ) : (
              groups.map((group) => (
                <Box key={group.provider} sx={{ mb: 1.25 }}>
                  <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "var(--omega-text-dim)", letterSpacing: "0.06em", px: 0.5, py: 0.5 }}>
                    {group.provider.toUpperCase()}
                  </Typography>
                  {group.models.map((model) => {
                    const key = `${model.provider}/${model.id}`;
                    const isPending = pendingModel === key;
                    return (
                      <Box
                        key={key}
                        onClick={() => (pendingModel ? undefined : void pick(model))}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1,
                          py: 0.75,
                          borderRadius: "9px",
                          cursor: pendingModel ? "wait" : "pointer",
                          opacity: pendingModel && !isPending ? 0.5 : 1,
                          "&:hover": { background: "var(--omega-hover-fill)" },
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: 13, color: "var(--omega-text)" }} noWrap>
                            {model.id}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }} noWrap>
                            {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : ""}
                            {model.reasoning ? " · reasoning" : ""}
                          </Typography>
                        </Box>
                        {isPending ? <CircularProgress size={14} sx={{ color: "var(--omega-accent)" }} /> : null}
                        {model.selected && !isPending ? <CheckIcon sx={{ fontSize: 16, color: "var(--omega-accent)" }} /> : null}
                      </Box>
                    );
                  })}
                </Box>
              ))
            )}
          </Box>
        </Box>
      </DialogContent>
      <Dialog open={customProviderOpen} onClose={() => setCustomProviderOpen(false)} fullWidth maxWidth="sm"><DialogTitle>添加本地 Provider</DialogTitle><DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>{(["id", "name", "baseUrl", "api", "modelId", "modelName", "contextWindow"] as const).map((key) => <TextField key={key} size="small" label={key} value={customProvider[key]} onChange={(event) => setCustomProvider((current) => ({ ...current, [key]: event.target.value }))} />)}</DialogContent><DialogActions><Button onClick={() => setCustomProviderOpen(false)}>取消</Button><Button variant="contained" onClick={() => void ipc.configureCustomProvider({ id: customProvider.id, name: customProvider.name, baseUrl: customProvider.baseUrl, api: customProvider.api, models: [{ id: customProvider.modelId, name: customProvider.modelName, contextWindow: Number(customProvider.contextWindow), reasoning: false }] }).then((result) => { if (result.ok) { setModels(result.data.models); setStatus("本地 Provider 已配置"); setCustomProviderOpen(false); } else setStatus(result.message); })}>保存</Button></DialogActions></Dialog>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: 11.5, color: status ? "var(--omega-accent)" : "var(--omega-text-dim)" }}>
          {status ?? "OAuth、自定义提供商和延迟测试仍走后续阶段。"}
        </Typography>
        <Button variant="contained" onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
}
