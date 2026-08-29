/**
 * IDE 表面的本地状态 hook。
 *
 * 打开 / 关闭 / 激活文件、按需加载内容、底部 tab 与搜索抽屉都收敛在这里。编辑器内容
 * 与 CodeMirror 实例不进全局 Zustand（doc / selection / scroll 是高频状态，写入 store
 * 会让无关组件随之重绘），这里只是组件挂载期内的本地 `useState`，随 surface 卸载即释放。
 *
 * 为什么没有「编辑并保存」：本产品的 Renderer 没有文件写入通道（`electron/ipc-registry.js`
 * 不暴露 writeFile），工作区文件的修改一律由 Agent 的 edit/write 工具完成并落进 JSONL
 * 事实。因此编辑器是只读阅读器，选区可以「引用到对话」交给 Agent 修改 —— 提供一个能改
 * 却不能存的编辑面会是误导性的 UI。
 */
import * as React from "react";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";

export type IdeBottomTab = "terminal";

/** 单个打开文件的加载槽位（内容随 tab 缓存在 IDE 表面内，不落全局）。 */
export interface IdeFileSlot {
  content: string;
  loading: boolean;
  error: string | null;
  binary: boolean;
  truncated: boolean;
  /** 每次载入完成时自增，驱动编辑器重放 doc 与高亮。 */
  revision: number;
}

export interface IdeSurfaceView {
  tabs: string[];
  activePath: string | null;
  files: Record<string, IdeFileSlot>;
  bottomTab: IdeBottomTab;
  searchOpen: boolean;
  openFile: (path: string) => void;
  activate: (path: string) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setBottomTab: (tab: IdeBottomTab) => void;
  setSearchOpen: (open: boolean) => void;
}

export function useIdeSurface(): IdeSurfaceView {
  const workspaceEpoch = useAppStore((state) => state.workspaceEpoch);

  const [tabs, setTabs] = React.useState<string[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<Record<string, IdeFileSlot>>({});
  const [bottomTab, setBottomTab] = React.useState<IdeBottomTab>("terminal");
  const [searchOpen, setSearchOpen] = React.useState(false);

  // 供同步更新相邻 tab 用的镜像，避免在多个 setState 里交叉读取过期闭包。
  const tabsRef = React.useRef<string[]>(tabs);
  React.useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const epochRef = React.useRef(workspaceEpoch);
  const loadingRef = React.useRef<Set<string>>(new Set());

  // 工作区切换（containment 变化）时，旧路径可能已不再被授权 —— 清空全部打开内容。
  React.useEffect(() => {
    epochRef.current = workspaceEpoch;
    loadingRef.current = new Set();
    setTabs([]);
    setActivePath(null);
    setFiles({});
  }, [workspaceEpoch]);

  const ensureLoaded = React.useCallback((path: string) => {
    setFiles((previous) =>
      previous[path]
        ? previous
        : {
            ...previous,
            [path]: { content: "", loading: true, error: null, binary: false, truncated: false, revision: 0 },
          },
    );
    if (loadingRef.current.has(path)) return;
    loadingRef.current.add(path);
    void (async () => {
      const res = await ipc.readFile({ path });
      loadingRef.current.delete(path);
      if (epochRef.current !== useAppStore.getState().workspaceEpoch) return;
      setFiles((previous) => {
        const slot = previous[path];
        if (!slot) return previous;
        if (res.ok) {
          return {
            ...previous,
            [path]: {
              content: res.data.content ?? "",
              loading: false,
              error: null,
              binary: Boolean(res.data.binary),
              truncated: Boolean(res.data.truncated),
              revision: slot.revision + 1,
            },
          };
        }
        return {
          ...previous,
          [path]: { content: "", loading: false, error: res.message, binary: false, truncated: false, revision: slot.revision + 1 },
        };
      });
    })();
  }, []);

  const openFile = React.useCallback(
    (path: string) => {
      setTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
      setActivePath(path);
      ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const activate = React.useCallback(
    (path: string) => {
      setActivePath(path);
      ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const closeTab = React.useCallback((path: string) => {
    const remaining = tabsRef.current.filter((p) => p !== path);
    loadingRef.current.delete(path);
    setTabs(remaining);
    setFiles((previous) => {
      const next = { ...previous };
      delete next[path];
      return next;
    });
    setActivePath((current) => (current === path ? remaining[remaining.length - 1] ?? null : current));
  }, []);

  const closeAllTabs = React.useCallback(() => {
    loadingRef.current = new Set();
    setTabs([]);
    setActivePath(null);
    setFiles({});
  }, []);

  return {
    tabs,
    activePath,
    files,
    bottomTab,
    searchOpen,
    openFile,
    activate,
    closeTab,
    closeAllTabs,
    setBottomTab,
    setSearchOpen,
  };
}
