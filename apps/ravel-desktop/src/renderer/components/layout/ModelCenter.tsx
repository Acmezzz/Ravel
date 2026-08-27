import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogContentArea, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { Menu, MenuAnchor, MenuContent, MenuItem } from "../../ui/Menu";
import { TextField } from "../../ui/TextField";
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

function AddIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
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
    <div
      className="omega-provider-card"
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem", border: "1px solid var(--omega-border)", borderRadius: "12px", padding: "0.625rem", minWidth: 0 }}
    >
      <div className="omega-provider-card-header" style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <span
          className="omega-provider-card-name"
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8125rem", fontWeight: 700, color: "var(--omega-text)" }}
        >
          {provider.name}
        </span>
        <span
          className="omega-chip omega-provider-card-status"
          style={{
            flex: "0 0 auto",
            background: provider.configured ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)",
            color: provider.configured ? "var(--omega-accent)" : "var(--omega-text-muted)",
          }}
        >
          {provider.configured ? "已配置" : "配置中"}
        </span>
        {provider.source ? (
          <span
            className="omega-provider-card-source"
            style={{ marginLeft: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}
          >
            {provider.source}
          </span>
        ) : null}
      </div>
      <TextField
        type="password"
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
        <p className="omega-error-text omega-provider-card-error">{error}</p>
      ) : (
        <p className="omega-provider-card-hint" style={{ margin: 0, fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>
          Key 只写入本机凭据库，界面不会读取或显示已保存的明文。
        </p>
      )}
      <div className="omega-provider-card-actions" style={{ display: "flex", gap: "0.5rem" }}>
        <Button size="sm" variant="solid" disabled={busy || !apiKey.trim()} onClick={() => void save()}>
          保存 Key
        </Button>
        <Button size="sm" variant="quiet" disabled={busy || !provider.configured} onClick={() => void onRemove(provider.id)}>
          移除
        </Button>
      </div>
    </div>
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
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [draftProvider, setDraftProvider] = React.useState<AuthProviderStatus | null>(null);
  const [customProvider, setCustomProvider] = React.useState({ id: "local-ai", name: "Local AI", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", modelId: "demo", modelName: "Demo", contextWindow: "128000" });

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setStatus(null);
      setDraftProvider(null);
      setAddMenuOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="omega-dialog-wide omega-model-center">
        <DialogTitle>模型中心</DialogTitle>
        <DialogContentArea
          className="omega-model-center-columns"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.875rem", paddingTop: "0.25rem" }}
        >
          <section className="omega-model-center-providers" style={{ display: "flex", flexDirection: "column", gap: "0.625rem", minWidth: 0 }}>
            <div className="omega-model-center-providers-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
              <h3 className="overline-label">已配置提供商</h3>
              <Menu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                <MenuAnchor asChild>
                  <Button
                    size="sm"
                    variant="solid"
                    leading={<AddIcon />}
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    onClick={() => setAddMenuOpen(true)}
                  >
                    添加
                  </Button>
                </MenuAnchor>
                <MenuContent style={{ minWidth: 220, maxHeight: 360 }}>
                  {available.map((provider) => (
                    <MenuItem
                      key={provider.id}
                      onSelect={() => {
                        setDraftProvider(provider);
                        setAddMenuOpen(false);
                      }}
                    >
                      {provider.name}
                    </MenuItem>
                  ))}
                  <MenuItem
                    onSelect={() => {
                      setAddMenuOpen(false);
                      setCustomProviderOpen(true);
                    }}
                  >
                    添加本地 Provider…
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
            <p className={auth?.ready ? "omega-muted-text" : "omega-warning-text"}>{auth?.label ?? "正在读取认证状态"}</p>
            {visibleProviders.length === 0 ? (
              <div className="omega-model-center-empty" style={{ border: "1px dashed var(--omega-border-strong)", borderRadius: "12px", padding: "0.75rem" }}>
                <p className="omega-muted-text">还没有配置提供商。</p>
                <p className="omega-muted-text" style={{ marginTop: "0.25rem", color: "var(--omega-text-dim)" }}>用右上角「添加」从目录里选择供应商，再粘贴 API key。</p>
              </div>
            ) : (
              visibleProviders.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} busy={busy} onSave={saveKey} onRemove={removeKey} />
              ))
            )}
          </section>
          <section className="omega-model-center-models" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0 }}>
            <h3 className="overline-label">模型</h3>
            <p className="omega-model-center-note" style={{ margin: 0, fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>
              只列出当前可用模型。配置提供商后会刷新目录；本地 Provider 可离线使用。
            </p>
            <TextField placeholder="搜索模型…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="omega-model-center-list" style={{ overflowY: "auto", maxHeight: 420, paddingRight: "0.25rem", minWidth: 0 }}>
              {groups.length === 0 ? (
                <p className="omega-model-center-no-match" style={{ padding: "0.75rem 0", margin: 0, fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>
                  无匹配模型。先添加并配置提供商。
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.provider} className="omega-model-group" style={{ marginBottom: "0.625rem", minWidth: 0 }}>
                    <span className="omega-model-provider">{group.provider.toUpperCase()}</span>
                    {group.models.map((model) => {
                      const key = `${model.provider}/${model.id}`;
                      const isPending = pendingModel === key;
                      return (
                        <div
                          key={key}
                          {...clickableRole}
                          onClick={() => (pendingModel ? undefined : void pick(model))}
                          className={`omega-model-option${pendingModel && !isPending ? " is-dimmed" : ""}`}
                          style={{ cursor: pendingModel ? "wait" : "pointer", opacity: pendingModel && !isPending ? 0.5 : 1 }}
                        >
                          <span className="omega-model-copy">
                            <span>{model.id}</span>
                            <small>
                              {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : ""}
                              {model.reasoning ? " · reasoning" : ""}
                            </small>
                          </span>
                          {isPending ? <span className="omega-spinner omega-model-center-pending" role="status" aria-label="切换中" /> : null}
                          {model.selected && !isPending ? <CheckIcon /> : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </section>
        </DialogContentArea>
        <DialogFooter className="omega-model-center-footer" style={{ justifyContent: "space-between" }}>
          <p className={status ? "omega-status-text" : "omega-muted-text"}>{status ?? "未配置的供应商都收在「添加」菜单里。"}</p>
          <Button variant="solid" onClick={() => setOpen(false)}>
            完成
          </Button>
        </DialogFooter>
        <Dialog open={customProviderOpen} onOpenChange={setCustomProviderOpen}>
          <DialogContent className="omega-model-center-custom">
            <DialogTitle>添加本地 Provider</DialogTitle>
            <DialogContentArea className="omega-form-stack omega-model-center-custom-fields">
              {(["id", "name", "baseUrl", "api", "modelId", "modelName", "contextWindow"] as const).map((key) => (
                <TextField key={key} label={key} value={customProvider[key]} onChange={(event) => setCustomProvider((current) => ({ ...current, [key]: event.target.value }))} />
              ))}
            </DialogContentArea>
            <DialogFooter>
              <Button variant="quiet" onClick={() => setCustomProviderOpen(false)}>
                取消
              </Button>
              <Button
                variant="solid"
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
