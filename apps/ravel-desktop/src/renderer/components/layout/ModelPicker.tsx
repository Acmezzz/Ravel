import * as React from "react";
import { Popover } from "../../ui/Popover";
import { TextField } from "../../ui/TextField";
import { Button } from "../../ui/Button";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";
import type { ModelInfo } from "../../types/dto";

/** Module-level switch token prevents stale model results after picker closure. */
let modelSwitchToken = 0;
export interface ModelPickerProps { anchor: HTMLElement | null; onClose: () => void; }
function groupByProvider(models: ModelInfo[]): Array<{ provider: string; models: ModelInfo[] }> { const groups: Array<{ provider: string; models: ModelInfo[] }> = []; for (const model of models) { const group = groups.find((entry) => entry.provider === model.provider); if (group) group.models.push(model); else groups.push({ provider: model.provider, models: [model] }); } return groups; }

export function ModelPicker({ anchor, onClose }: ModelPickerProps): React.ReactElement {
  const models = useAppStore((state) => state.models); const setAgent = useAppStore((state) => state.setAgent); const setModelCenterOpen = useAppStore((state) => state.setModelCenterOpen);
  const [query, setQuery] = React.useState(""); const [activeIndex, setActiveIndex] = React.useState(0); const [pending, setPending] = React.useState<string | null>(null); const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (anchor) { setQuery(""); setActiveIndex(0); } }, [anchor]);
  const filtered = React.useMemo(() => { const q = query.trim().toLowerCase(); return q ? models.filter((model) => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(q)) : models; }, [models, query]);
  const groups = React.useMemo(() => groupByProvider(filtered), [filtered]); const flatModels = React.useMemo(() => groups.flatMap((group) => group.models), [groups]);
  const pick = React.useCallback(async (model: ModelInfo) => { const token = ++modelSwitchToken; const key = `${model.provider}/${model.id}`; setPending(key); setError(null); try { const res = await ipc.setModel({ provider: model.provider, modelId: model.id }); if (token !== modelSwitchToken) return; if (res.ok) { setAgent(res.data); onClose(); } else setError(res.message); } catch (reason) { if (token === modelSwitchToken) setError(reason instanceof Error ? reason.message : String(reason)); } finally { if (token === modelSwitchToken) setPending(null); } }, [setAgent, onClose]);
  return <Popover open={Boolean(anchor)} anchor={anchor} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} ariaLabel="选择模型" className="omega-model-picker">
    <div className="omega-model-picker-search"><TextField autoFocus label="搜索模型" placeholder="搜索模型…" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(Math.max(flatModels.length - 1, 0), index + 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); } else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); } else if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(flatModels.length - 1, 0)); } else if (event.key === "Enter" && flatModels[activeIndex]) { event.preventDefault(); void pick(flatModels[activeIndex]); } }} aria-controls="omega-model-list" aria-activedescendant={flatModels[activeIndex] ? `omega-model-${flatModels[activeIndex].provider}-${flatModels[activeIndex].id}` : undefined} />{error ? <p role="alert" className="omega-error-text">{error}</p> : null}</div>
    <div id="omega-model-list" role="listbox" aria-label="模型列表" className="omega-model-list">{groups.length === 0 ? <p className="omega-muted-text">无匹配模型</p> : groups.map((group) => <div key={group.provider} className="omega-model-group"><span className="omega-model-provider">{group.provider.toUpperCase()}</span>{group.models.map((model) => { const key = `${model.provider}/${model.id}`; const isPending = pending === key; return <div key={key} id={`omega-model-${model.provider}-${model.id}`} {...clickableRole} role="option" tabIndex={0} aria-selected={Boolean(model.selected)} aria-busy={isPending} className={`omega-model-option${pending && !isPending ? " is-dimmed" : ""}`} onClick={() => (pending ? undefined : void pick(model))}><span className="omega-model-copy"><span>{model.id}</span><small>{model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K ctx` : ""}{model.reasoning ? " · reasoning" : ""}</small></span>{isPending ? <span className="omega-spinner" /> : model.selected ? <span className="omega-model-check" aria-hidden="true">✓</span> : null}</div>; })}</div>)}</div>
    <div className="omega-model-divider" /><Button size="sm" variant="quiet" leading={<span aria-hidden="true">⌘</span>} onClick={() => { onClose(); setModelCenterOpen(true); }}>前往模型中心</Button>
  </Popover>;
}
