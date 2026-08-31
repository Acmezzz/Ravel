/**
 * 任务七：Histos 图谱查询 hook。
 *
 * 收敛 GraphPanel 的查询生命周期（lens 切换、session/workspace 变化、Refresh），
 * 供 HistosSurface 组合。核心保证是 STALE GRAPH RESPONSE 防护：每次 refresh 以
 * 递增的 request epoch 标记，只有“仍是当前 epoch 且请求时的活跃会话仍为当前会话”
 * 的响应才被写入状态，旧响应不会覆盖新响应。
 *
 * `requestKey` 反映查询身份（session + lens），用于给工作区作渲染 key —— 查询
 * 身份变化即重挂 GraphCanvas（新查询 → 新 viewstate / 重新 ELK 布局）。
 */
import * as React from "react";
import { ipc } from "../../ipc/client";
import { histosClient } from "../../ipc/histos-client";
import { useAppStore } from "../../store/useAppStore";
import type { HistosGraphDTO, HistosLens } from "../../types/dto";

export type HistosGraphGranularity = "entry";

export interface HistosGraphQuery {
  /** 最近一次被接受的图谱 DTO；null 表示无会话或查询失败。 */
  graph: HistosGraphDTO | null;
  loading: boolean;
  error: string | null;
  lens: HistosLens;
  query: { sourceSet: { sessionIds: string[] }; lens: HistosLens; granularity: "entry" } | null;
  /** 查询身份 key：session + lens；留在 GraphCanvas 的渲染 key 用。 */
  requestKey: string | null;
  setLens: (lens: HistosLens) => void;
  refresh: () => void;
}

export function useHistosGraphQuery(): HistosGraphQuery {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const workspaceEpoch = useAppStore((state) => state.workspaceEpoch);

  const [lens, setLens] = React.useState<HistosLens>("structural");
  const [graph, setGraph] = React.useState<HistosGraphDTO | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 单调递增的请求 epoch：只有“当前请求”的响应才允许写状态。
  const requestEpoch = React.useRef(0);

  const query = activeSessionId
    ? { sourceSet: { sessionIds: [activeSessionId] }, lens, granularity: "entry" as const }
    : null;

  const requestKey = activeSessionId ? `${activeSessionId}\u0000${lens}` : null;

  const refresh = React.useCallback(() => {
    const sessionId = useAppStore.getState().activeSessionId;
    if (!sessionId) {
      requestEpoch.current += 1;
      setGraph(null);
      setError(null);
      setLoading(false);
      return;
    }
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await ipc.histosGetGraph({ sourceSet: { sessionIds: [sessionId] }, lens, granularity: "entry" });
      // stale graph response 防护：epoch 已过期或会话已切换则丢弃。
      if (epoch !== requestEpoch.current || useAppStore.getState().activeSessionId !== sessionId) return;
      setLoading(false);
      if (result.ok) {
        setGraph(result.data);
      } else {
        setGraph(null);
        setError(result.message);
      }
    })();
  }, [lens]);

  React.useEffect(() => { void refresh(); }, [refresh, workspaceEpoch]);

  // P0 visibility contract: archiving/purging/restoring entries changes what
  // the graph projection should show, so the canvas must refresh the moment
  // the event bus reports it - not on the next manual refresh.
  React.useEffect(() => {
    return histosClient.onHistosEvent(({ eventType }) => {
      if (eventType === "on_entries_archived" || eventType === "on_entries_restored" || eventType === "on_entries_purged") {
        refresh();
      }
    });
  }, [refresh]);

  return { graph, loading, error, lens, query, requestKey, setLens, refresh };
}