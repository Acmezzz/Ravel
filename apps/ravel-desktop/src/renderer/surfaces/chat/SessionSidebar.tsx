/**
 * 任务五：Chat Surface 的会话侧栏。
 *
 * 复用 components/sessions/SessionList / ActivityList 作为会话/活动两类视图，提供
 * 表面内的窄侧栏外壳（独立于全局左栏 LeftNav）。本地 tab 状态仅属表层 UI，不进
 * 全局 store。
 */
import * as React from "react";
import { useAppStore } from "../../store/useAppStore";
import { SessionList } from "../../components/sessions/SessionList";
import { ActivityList } from "../../components/sessions/ActivityList";

type SidebarTab = "sessions" | "activity";

const ACTIVE_COLOR = "var(--ravel-accent)";
const MUTED_COLOR = "var(--ravel-text-muted)";
const BORDER_COLOR = "var(--ravel-border)";
const BG_COLOR = "var(--ravel-bg-panel)";

export function SessionSidebar(): React.ReactElement {
  const [tab, setTab] = React.useState<SidebarTab>("sessions");
  // 活动徽标：有需要关注的 row / 未读即点亮。
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const hasAttention = React.useMemo(
    () => Object.values(sessionActivity).some((activity) => activity?.unread || activity?.failed),
    [sessionActivity],
  );

  return (
    <aside
      className="ravel-chat-sidebar"
      aria-label="会话侧栏"
      style={{
        width: 236,
        minWidth: 236,
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: BG_COLOR,
        borderRight: `1px solid ${BORDER_COLOR}`,
      }}
    >
      <div
        className="ravel-chat-sidebar-header"
        role="tablist"
        aria-label="会话侧栏切换"
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px",
          borderBottom: `1px solid ${BORDER_COLOR}`,
          flex: "0 0 auto",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sessions"}
          data-nav-key="sessions"
          onClick={() => setTab("sessions")}
          style={{
            flex: 1,
            fontSize: "0.6875rem",
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            color: tab === "sessions" ? ACTIVE_COLOR : MUTED_COLOR,
            background: tab === "sessions" ? "var(--ravel-selected)" : "transparent",
          }}
        >
          会话
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "activity"}
          data-nav-key="activity"
          onClick={() => setTab("activity")}
          style={{
            flex: 1,
            fontSize: "0.6875rem",
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            color: tab === "activity" ? ACTIVE_COLOR : MUTED_COLOR,
            background: tab === "activity" ? "var(--ravel-selected)" : "transparent",
          }}
        >
          活动{hasAttention ? " •" : ""}
        </button>
      </div>
      <div className="ravel-chat-sidebar-body" style={{ minHeight: 0, flex: 1, overflow: "auto" }}>
        {tab === "sessions" ? <SessionList /> : <ActivityList />}
      </div>
    </aside>
  );
}