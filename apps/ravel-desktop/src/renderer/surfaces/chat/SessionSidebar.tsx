/**
 * Chat Surface 的会话侧栏（280px，单一实例）。
 *
 * 复用 components/sessions/SessionList / ActivityList 作为会话/活动两个视图。
 * 之前它把宽度、颜色、圆角全写成内联 style，这里改为只挂语义 class，视觉全部
 * 由 `--ravel-*` token 驱动的 `.ravel-chat-sidebar*` 规则负责；tab 的激活态用
 * `data-active` 属性选择器表达，与 shell 的分段控件保持一致。
 */
import * as React from "react";
import { useAppStore } from "../../store/useAppStore";
import { SessionList } from "../../components/sessions/SessionList";
import { ActivityList } from "../../components/sessions/ActivityList";

type SidebarTab = "sessions" | "activity";

const TABS: ReadonlyArray<{ value: SidebarTab; label: string }> = [
  { value: "sessions", label: "会话" },
  { value: "activity", label: "活动" },
];

export function SessionSidebar(): React.ReactElement {
  const [tab, setTab] = React.useState<SidebarTab>("sessions");
  // 活动徽标：有需要关注的 row / 未读即点亮。
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const hasAttention = Object.values(sessionActivity).some(
    (activity) => Boolean(activity?.unread) || Boolean(activity?.failed),
  );

  return (
    <aside className="ravel-chat-sidebar" aria-label="会话侧栏">
      <div className="ravel-chat-sidebar-header" role="tablist" aria-label="会话侧栏切换">
        {TABS.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-nav-key={item.value}
              data-active={active ? "true" : "false"}
              className="ravel-chat-sidebar-tab"
              aria-label={item.value === "activity" && hasAttention ? "活动（有未读）" : item.label}
              onClick={() => setTab(item.value)}
            >
              {item.label}
              {item.value === "activity" && hasAttention ? (
                <span className="ravel-chat-sidebar-dot" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="ravel-chat-sidebar-body">
        {tab === "sessions" ? <SessionList /> : <ActivityList />}
      </div>
    </aside>
  );
}
