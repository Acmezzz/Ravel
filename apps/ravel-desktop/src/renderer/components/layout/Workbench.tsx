import * as React from "react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import { TitleBar } from "./TitleBar";
import { Header } from "./Header";
import { LeftNav } from "./LeftNav";
import { ChatPanel } from "../chat/ChatPanel";
import { RightPanel } from "./RightPanel";
import { PanelResizeHandle } from "./PanelResizeHandle";

const RIGHT_COLLAPSED_RAIL_PX = 44;
const MIN_SIDEBAR_PX = 200;
const MAX_SIDEBAR_PX = 420;
const DEFAULT_SIDEBAR_PX = 260;
const MIN_RIGHT_PX = 260;
const MAX_RIGHT_PX = 620;
const DEFAULT_RIGHT_PX = 440;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function loadWidths(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem("ravel-panel-widths") ?? localStorage.getItem("omega-panel-widths");
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: number; right?: number };
      return {
        left: Math.min(MAX_SIDEBAR_PX, Math.max(MIN_SIDEBAR_PX, parsed.left ?? DEFAULT_SIDEBAR_PX)),
        right: Math.min(MAX_RIGHT_PX, Math.max(MIN_RIGHT_PX, parsed.right ?? DEFAULT_RIGHT_PX)),
      };
    }
  } catch {
    /* defaults */
  }
  return { left: DEFAULT_SIDEBAR_PX, right: DEFAULT_RIGHT_PX };
}

/** Imperative inert toggle (React 18 has no inert prop): drawers make the workbench behind them non-interactive. */
function inertRef(active: boolean) {
  return (element: HTMLElement | null) => {
    if (!element) return;
    if (active) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  };
}

/**
 * Three-column workbench (Codex-style) with drag- and keyboard-resizable side
 * panels: grid-template-columns transitions while panels animate, dragging
 * disables the transition, and collapsed panels keep a slim icon rail.
 */
export function Workbench(): React.ReactElement {
  const rightOpen = useAppStore((s) => s.layout.rightPanelOpen);
  const leftOpen = useAppStore((s) => s.layout.leftPanelOpen);
  const focusMode = useAppStore((s) => s.layout.focusMode);
  const rightTab = useAppStore((s) => s.layout.rightTab);
  const compactViewport = useMediaQuery("(max-width: 980px)");
  const setRightTab = useAppStore((s) => s.setRightTab);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const [widths, setWidths] = React.useState(loadWidths);
  const [dragging, setDragging] = React.useState<null | "left" | "right">(null);
  const widthsRef = React.useRef(widths);
  const draggingRef = React.useRef<null | "left" | "right">(null);
  const workbenchRef = React.useRef<HTMLDivElement | null>(null);
  const drawerFocusRef = React.useRef<HTMLElement | null>(null);
  const drawerRef = React.useRef<HTMLDivElement | null>(null);

  const persist = React.useCallback((next: { left: number; right: number }) => {
    try {
      localStorage.setItem("ravel-panel-widths", JSON.stringify(next));
    } catch {
      /* best effort */
    }
  }, []);

  const changeWidth = React.useCallback(
    (side: "left" | "right") => (value: number) => {
      widthsRef.current = { ...widthsRef.current, [side]: value };
      if (draggingRef.current === side) {
        workbenchRef.current?.style.setProperty(`--omega-${side}-panel-width`, `${value}px`);
        return;
      }
      setWidths(widthsRef.current);
    },
    [],
  );

  const effectiveLeftOpen = leftOpen && !focusMode && !compactViewport;
  const compactLeftOpen = leftOpen && !focusMode && compactViewport;
  const compactRightOpen = rightOpen && !focusMode && compactViewport && !compactLeftOpen;
  const effectiveRightOpen = rightOpen && !focusMode && !compactViewport;
  const leftCol = focusMode ? "0px" : effectiveLeftOpen ? "var(--omega-left-panel-width)" : `${RIGHT_COLLAPSED_RAIL_PX}px`;
  const rightCol = focusMode ? "0px" : effectiveRightOpen ? "var(--omega-right-panel-width)" : `${RIGHT_COLLAPSED_RAIL_PX}px`;

  React.useEffect(() => {
    const isOpen = compactLeftOpen || compactRightOpen;
    if (!isOpen) {
      const previous = drawerFocusRef.current;
      drawerFocusRef.current = null;
      if (previous && document.contains(previous)) window.requestAnimationFrame(() => previous.focus());
      return;
    }
    drawerFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => {
      const first = drawerRef.current?.querySelector<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])");
      first?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (compactLeftOpen) useAppStore.getState().toggleLeftPanel();
        else useAppStore.getState().toggleRightPanel();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compactLeftOpen, compactRightOpen]);

  // While a compact drawer overlays the workbench, the chat column behind it
  // must be pointer- and AT-inert (modal-sheet pattern).
  const centerInertRef = React.useMemo(() => inertRef(compactLeftOpen || compactRightOpen), [compactLeftOpen, compactRightOpen]);

  return (
    <div
      ref={workbenchRef}
      className="ravel-workbench"
      data-focus-mode={focusMode ? "true" : "false"}
      style={{
        "--omega-left-panel-width": `${widths.left}px`,
        "--omega-right-panel-width": `${widths.right}px`,
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        gridTemplateColumns: `${leftCol} minmax(0,1fr) ${rightCol}`,
        height: "100vh",
        gap: 0,
        padding: 0,
        transition: dragging ? "none" : "grid-template-columns var(--omega-dur-slow) var(--omega-ease-out)",
      } as React.CSSProperties}
    >
      <TitleBar />
      <div className="ravel-workbench-header" style={{ gridColumn: "1 / -1" }}>
        <Header />
      </div>
      <div
        id={effectiveLeftOpen ? "omega-left-drawer" : "omega-left-rail"}
        className="ravel-workbench-left"
        style={{ minHeight: 0, overflow: "hidden", display: "flex", position: "relative" }}
      >
        {effectiveLeftOpen ? <LeftNav /> : (
          <div className="ravel-workbench-rail ravel-workbench-left-rail" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", paddingTop: "12px", background: "var(--omega-bg-rail)", height: "100%" }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" label="展开左侧导航" aria-expanded={false} aria-controls="omega-left-drawer" onClick={() => useAppStore.getState().toggleLeftPanel()} style={{ color: "var(--omega-text-dim)", minWidth: 36, minHeight: 36 }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 12h10M4 19h16" /><path d="m16 8 4 4-4 4" /></svg>
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="right">展开左栏</TooltipContent>
            </Tooltip>
          </div>
        )}
        {effectiveLeftOpen ? (
          <PanelResizeHandle
            side="left"
            label="调整左栏宽度"
            value={widths.left}
            min={MIN_SIDEBAR_PX}
            max={MAX_SIDEBAR_PX}
            defaultValue={DEFAULT_SIDEBAR_PX}
            onChange={changeWidth("left")}
            onDragStateChange={(isDragging) => {
              draggingRef.current = isDragging ? "left" : null;
              setDragging(isDragging ? "left" : (current) => (current === "left" ? null : current));
              if (!isDragging) {
                setWidths({ ...widthsRef.current });
                persist(widthsRef.current);
              }
            }}
          />
        ) : null}
      </div>
      <div ref={centerInertRef} className="ravel-workbench-center" style={{ minHeight: 0, overflow: "hidden", display: "flex" }}>
        <ChatPanel />
      </div>
      {compactLeftOpen ? (
        <>
          <div className="ravel-workbench-backdrop" aria-hidden="true" onClick={() => useAppStore.getState().toggleLeftPanel()} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
          <div
            ref={drawerRef}
            className="ravel-workbench-drawer ravel-workbench-left-drawer"
            id="omega-left-drawer"
            aria-label="会话与文件导航"
            role="dialog"
            aria-modal="true"
            style={{ position: "fixed", inset: "0 auto 0 0", width: "min(420px, 88vw)", zIndex: 20, background: "var(--omega-bg-rail)", boxShadow: "var(--omega-shadow-lg)", display: "flex", flexDirection: "column" }}
          >
            <div className="ravel-workbench-drawer-header" style={{ display: "flex", justifyContent: "flex-end", padding: "4px", borderBottom: "1px solid var(--omega-border)" }}>
              <IconButton size="sm" label="关闭左侧导航" onClick={() => useAppStore.getState().toggleLeftPanel()} style={{ color: "var(--omega-text-muted)" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </IconButton>
            </div>
            <div className="ravel-workbench-drawer-content" style={{ minHeight: 0, flex: 1, display: "flex" }}><LeftNav /></div>
          </div>
        </>
      ) : null}
      <div
        id={!compactViewport && effectiveRightOpen ? "omega-right-drawer" : undefined}
        className="ravel-workbench-right"
        style={{ minHeight: 0, overflow: "hidden", display: focusMode ? "none" : "flex", position: "relative" }}
      >
        {effectiveRightOpen ? (
          <RightPanel />
        ) : (
          <div className="ravel-workbench-rail ravel-workbench-right-rail" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", paddingTop: "12px", background: "var(--omega-bg-rail)", height: "100%" }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" label="展开右侧面板" aria-expanded={false} aria-controls="omega-right-drawer" onClick={toggleRightPanel} style={{ color: "var(--omega-text-dim)", minWidth: 36, minHeight: 36 }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /><path d="M20 5v14" /></svg>
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="left">展开右栏</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" label="打开 Diff 变更面板" active={rightTab === "diff"} onClick={() => setRightTab("diff")} style={{ color: rightTab === "diff" ? "var(--omega-accent)" : "var(--omega-text-dim)", background: rightTab === "diff" ? "var(--omega-selected)" : "transparent" }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M8 4h11v13H8z" /><path d="M5 7H4v13h11v-3" /><path d="M11 8v5M14 8v5" /></svg>
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>变更 Diff</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" label="打开 Graph 面板" active={rightTab === "graph"} onClick={() => setRightTab("graph")} style={{ color: rightTab === "graph" ? "var(--omega-accent)" : "var(--omega-text-dim)", background: rightTab === "graph" ? "var(--omega-selected)" : "transparent" }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="12" cy="18" r="2" /><path d="m7.8 6.4 8.4 1.2M16.8 9.7l-3.6 6.4M10.2 16.5 7.4 7.8" /></svg>
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Graph</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" label="打开 Worktree 面板" active={rightTab === "worktree"} onClick={() => setRightTab("worktree")} style={{ color: rightTab === "worktree" ? "var(--omega-accent)" : "var(--omega-text-dim)", background: rightTab === "worktree" ? "var(--omega-selected)" : "transparent" }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="6" r="2" /><circle cx="17" cy="18" r="2" /><path d="M7 8v7a3 3 0 0 0 3 3h5M7 12h7a3 3 0 0 0 3-3V8" /></svg>
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Worktree</TooltipContent>
            </Tooltip>
          </div>
        )}
        {effectiveRightOpen ? (
          <PanelResizeHandle
            side="right"
            label="调整右栏宽度"
            value={widths.right}
            min={MIN_RIGHT_PX}
            max={MAX_RIGHT_PX}
            defaultValue={DEFAULT_RIGHT_PX}
            onChange={changeWidth("right")}
            onDragStateChange={(isDragging) => {
              draggingRef.current = isDragging ? "right" : null;
              setDragging(isDragging ? "right" : (current) => (current === "right" ? null : current));
              if (!isDragging) {
                setWidths({ ...widthsRef.current });
                persist(widthsRef.current);
              }
            }}
          />
        ) : null}
      </div>
      {compactRightOpen ? (
        <>
          <div className="ravel-workbench-backdrop" aria-hidden="true" onClick={toggleRightPanel} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
          <div
            ref={drawerRef}
            className="ravel-workbench-drawer ravel-workbench-right-drawer"
            id="omega-right-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="工作台辅助面板"
            style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: `min(${MAX_RIGHT_PX}px, 88vw)`, minWidth: 0, maxWidth: "100vw", zIndex: 20, background: "var(--omega-bg-rail)", boxShadow: "var(--omega-shadow-lg)", display: "flex", flexDirection: "column" }}
          >
            <div className="ravel-workbench-drawer-header" style={{ display: "flex", justifyContent: "flex-start", padding: "4px", borderBottom: "1px solid var(--omega-border)" }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton size="sm" label="关闭右侧面板" onClick={toggleRightPanel} style={{ color: "var(--omega-text-muted)" }}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>关闭面板</TooltipContent>
              </Tooltip>
            </div>
            <div className="ravel-workbench-drawer-content" style={{ minHeight: 0, flex: 1, display: "flex" }}><RightPanel /></div>
          </div>
        </>
      ) : null}
    </div>
  );
}
