/**
 * 任务六：IDE 底部面板（Diff / Worktree / 终端）。
 * 直接复用既有 DiffViewer / WorktreePanel / TerminalPanel —— 其各自的
 * rightTab 语义（diff / worktree / terminal）与 IDE 底部标签一一对应，无需改动。
 * 底部标签切换是 IDE 表面的本地状态（bottomTab），与全局 rightTab 解耦。
 */
import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs";
import { DiffViewer } from "../../components/panels/DiffViewer";
import { WorktreePanel } from "../../components/panels/WorktreePanel";
import { TerminalPanel } from "../../components/panels/TerminalPanel";
import type { IdeBottomTab } from "./useIdeSurface";

const BOTTOM_TABS: Array<{ value: IdeBottomTab; label: string }> = [
  { value: "diff", label: "Diff" },
  { value: "worktree", label: "Worktree" },
  { value: "terminal", label: "终端" },
];

export function BottomPanel({ bottomTab, onTabChange }: { bottomTab: IdeBottomTab; onTabChange: (tab: IdeBottomTab) => void }): React.ReactElement {
  return (
    <section className="ravel-ide-bottom" aria-label="IDE 底部面板">
      <div className="ravel-ide-bottom-header">
        <Tabs value={bottomTab} onValueChange={(value) => onTabChange(value as IdeBottomTab)}>
          <TabsList>
            {BOTTOM_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="ravel-ide-bottom-body">
        {bottomTab === "diff" ? <DiffViewer /> : null}
        {bottomTab === "worktree" ? <WorktreePanel /> : null}
        {bottomTab === "terminal" ? <TerminalPanel /> : null}
      </div>
    </section>
  );
}