/**
 * 任务六：IDE 表面的本地状态 hook。
 *
 * 打开 / 关闭 / 激活文件、按需加载内容、脏标记与底部 tab / 搜索抽屉切换全部收敛在
 * 这里 —— 与 ChatSurface 不同，IDE 的编辑器与高频内容不写入全局 Zustand（EditorView
 * 与 PTY 输出都留在各自组件 / hook）。这里仅是一个组件挂载期内的本地 `useState` 包装，
 * 随 surface 卸载即释放。
 */
import * as React from "react";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";

export type IdeBottomTab = "diff" | "worktree" | "terminal";

/** 单个打开文件的加载槽位（内容会随 tab 缓存在 IDE 表面内，不落全局）。 */
export interface IdeFileSlot {
  content: string;
  loading: boolean;
  error: string | null;
  binary: boolean;
  truncated: boolean;
}

export interface IdeSurfaceView {
  tabs: string[];
  activePath: string | null;
  files: Record<string, IdeFileSlot>;
  dirty: ReadonlySet<string>;
  bottomTab: IdeBottomTab;
  searchOpen: boolean;
  openFile: (path: string) => void;
  activate: (path: string) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  markDirty: (path: string, dirty: boolean) => void;
  setBottomTab: (tab: IdeBottomTab) => void;
  setSearchOpen: (open: boolean) => void;
}

export function useIdeSurface(): IdeSurfaceView {
  const workspaceEpoch = useAppStore((state) => state.workspaceEpoch);

  const [tabs, setTabs] = React.useState<string[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<Record<string, IdeFileSlot>>({});
  const [dirty, setDirty] = React.useState<Set<string>>(() => new Set());
  const [bottomTab, setBottomTab] = React.useState<IdeBottomTab>("diff");
  const [searchOpen, setSearchOpen] = React.useState(false);

  // 供同步更新相邻 tab 用的镜像，避免在多个 setState 里交叉读取过期闭包。
  const tabsRef = React.useRef<string[]>(tabs);
  React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const epochRef = React.useRef(workspaceEpoch);
  const loadingRef = React.useRef<Set<string>>(new Set());

  // 工作区切换（containment 变化）时，旧路径可能已不再被授权 —— 清空全部打开内容。
  React.useEffect(() => {
    epochRef.current = workspaceEpoch;
    loadingRef.current = new Set();
    setTabs([]);
    setActivePath(null);
    setFiles({});
    setDirty(new Set());
  }, [workspaceEpoch]);

  const ensureLoaded = React.useCallback((path: string) => {
    setFiles((previous) => (previous[path]?.loading
      ? previous
      : { ...previous, [path]: previous[path] ?? { content: "", loading: true, error: null, binary: false, truncated: false } }));
    if (loadingRef.current.has(path)) return;
    loadingRef.current.add(path);
    void (async () => {
      const res = await ipc.readFile({ path });
      loadingRef.current.delete(path);
      if (epochRef.current !== useAppStore.getState().workspaceEpoch) return;
      setFiles((previous) => {
        if (!(path in previous)) return previous;
        if (res.ok) {
          return { ...previous, [path]: { content: res.data.content ?? "", loading: false, error: null, binary: Boolean(res.data.binary), truncated: Boolean(res.data.truncated) } };
        }
        return { ...previous, [path]: { content: "", loading: false, error: res.message, binary: false, truncated: false } };
      });
    })();
  }, []);

  const openFile = React.useCallback((path: string) => {
    setTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
    setActivePath(path);
    ensureLoaded(path);
  }, [ensureLoaded]);

  const activate = React.useCallback((path: string) => {
    setActivePath(path);
    ensureLoaded(path);
  }, [ensureLoaded]);

  const closeTab = React.useCallback((path: string) => {
    const remaining = tabsRef.current.filter((p) => p !== path);
    loadingRef.current.delete(path);
    setTabs(remaining);
    setFiles((previous) => { const next = { ...previous }; delete next[path]; return next; });
    setDirty((previous) => { const next = new Set(previous); next.delete(path); return next; });
    setActivePath((current) => (current === path ? remaining[remaining.length - 1] ?? null : current));
  }, []);

  const closeAllTabs = React.useCallback(() => {
    loadingRef.current = new Set();
    setTabs([]);
    setActivePath(null);
    setFiles({});
    setDirty(new Set());
  }, []);

  const markDirty = React.useCallback((path: string, isDirty: boolean) => {
    setDirty((previous) => {
      if (isDirty === previous.has(path)) return previous;
      const next = new Set(previous);
      if (isDirty) next.add(path); else next.delete(path);
      return next;
    });
  }, []);

  return {
    tabs,
    activePath,
    files,
    dirty,
    bottomTab,
    searchOpen,
    openFile,
    activate,
    closeTab,
    closeAllTabs,
    markDirty,
    setBottomTab,
    setSearchOpen,
  };
}