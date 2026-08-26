import * as React from "react";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DifferenceIcon from "@mui/icons-material/Difference";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import Backdrop from "@mui/material/Backdrop";
import FocusTrap from "@mui/material/Unstable_TrapFocus";
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
      setWidths(widthsRef.current);
    },
    [],
  );

  const effectiveLeftOpen = leftOpen && !focusMode && !compactViewport;
  const compactLeftOpen = leftOpen && !focusMode && compactViewport;
  const compactRightOpen = rightOpen && !focusMode && compactViewport && !compactLeftOpen;
  const effectiveRightOpen = rightOpen && !focusMode && !compactViewport;
  const leftCol = focusMode ? "0px" : effectiveLeftOpen ? `${widths.left}px` : `${RIGHT_COLLAPSED_RAIL_PX}px`;
  const rightCol = focusMode ? "0px" : effectiveRightOpen ? `${widths.right}px` : `${RIGHT_COLLAPSED_RAIL_PX}px`;

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
    <Box
      data-focus-mode={focusMode ? "true" : "false"}
      sx={{
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        gridTemplateColumns: `${leftCol} minmax(0,1fr) ${rightCol}`,
        height: "100vh",
        "@supports (height: 100dvh)": { height: "100dvh" },
        gap: 0,
        p: 0,
        transition: dragging ? "none" : "grid-template-columns 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <TitleBar />
      <Box sx={{ gridColumn: "1 / -1" }}>
        <Header />
      </Box>
      <Box id={effectiveLeftOpen ? "omega-left-drawer" : "omega-left-rail"} sx={{ minHeight: 0, overflow: "hidden", display: "flex", position: "relative" }}>
        {effectiveLeftOpen ? <LeftNav /> : (
          <Box sx={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, pt: 1.5, background: "var(--omega-bg-rail)", height: "100%" }}>
            <Tooltip title="展开左栏" placement="right">
              <IconButton size="small" aria-label="展开左侧导航" aria-expanded={false} aria-controls="omega-left-drawer" onClick={() => useAppStore.getState().toggleLeftPanel()} sx={{ color: "var(--omega-text-dim)", minWidth: 36, minHeight: 36 }}>
                <MenuOpenIcon sx={{ fontSize: "1.25rem" }} />
              </IconButton>
            </Tooltip>
          </Box>
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
              setDragging(isDragging ? "left" : (current) => (current === "left" ? null : current));
              if (!isDragging) persist(widthsRef.current);
            }}
          />
        ) : null}
      </Box>
      <Box ref={centerInertRef} sx={{ minHeight: 0, overflow: "hidden", display: "flex" }}>
        <ChatPanel />
      </Box>
      {compactLeftOpen ? (
        <>
          <Backdrop open sx={{ zIndex: 19 }} onClick={() => useAppStore.getState().toggleLeftPanel()} />
          <FocusTrap open={compactLeftOpen} disableAutoFocus disableEnforceFocus={false} disableRestoreFocus>
          <Box
            ref={drawerRef}
            component="nav"
            id="omega-left-drawer"
            aria-label="会话与文件导航"
            role="dialog"
            aria-modal="true"
            sx={{ position: "fixed", inset: "0 auto 0 0", width: "min(420px, 88vw)", zIndex: 20, background: "var(--omega-bg-rail)", boxShadow: "var(--omega-shadow-lg)", display: "flex", flexDirection: "column" }}
          >
            <Box sx={{ display: "flex", justifyContent: "flex-end", p: 0.5, borderBottom: "1px solid var(--omega-border)" }}>
              <IconButton size="small" aria-label="关闭左侧导航" onClick={() => useAppStore.getState().toggleLeftPanel()} sx={{ color: "var(--omega-text-muted)" }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ minHeight: 0, flex: 1, display: "flex" }}><LeftNav /></Box>
          </Box>
          </FocusTrap>
        </>
      ) : null}
      <Box id={!compactViewport && effectiveRightOpen ? "omega-right-drawer" : undefined} sx={{ minHeight: 0, overflow: "hidden", display: focusMode ? "none" : "flex", position: "relative" }}>
        {effectiveRightOpen ? (
          <RightPanel />
        ) : (
          <Box
            sx={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.5,
              pt: 1.5,
              background: "var(--omega-bg-rail)",
              height: "100%",
            }}
          >
            <Tooltip title="展开右栏" placement="left">
              <IconButton size="small" aria-label="展开右侧面板" aria-expanded={false} aria-controls="omega-right-drawer" onClick={toggleRightPanel} sx={{ color: "var(--omega-text-dim)", minWidth: 36, minHeight: 36 }}>
                <KeyboardArrowLeftIcon sx={{ fontSize: "1.25rem" }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="变更 Diff">
              <IconButton
                size="small"
                aria-label="打开 Diff 变更面板"
                aria-pressed={rightTab === "diff"}
                onClick={() => setRightTab("diff")}
                sx={{ color: rightTab === "diff" ? "var(--omega-accent)" : "var(--omega-text-dim)", background: rightTab === "diff" ? "var(--omega-selected)" : "transparent" }}
              >
                <DifferenceIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Worktree">
              <IconButton
                size="small"
                aria-label="打开 Worktree 面板"
                aria-pressed={rightTab === "worktree"}
                onClick={() => setRightTab("worktree")}
                sx={{ color: rightTab === "worktree" ? "var(--omega-accent)" : "var(--omega-text-dim)", background: rightTab === "worktree" ? "var(--omega-selected)" : "transparent" }}
              >
                <AccountTreeOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
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
              setDragging(isDragging ? "right" : (current) => (current === "right" ? null : current));
              if (!isDragging) persist(widthsRef.current);
            }}
          />
        ) : null}
      </Box>
      {compactRightOpen ? (
        <>
          <Backdrop open sx={{ zIndex: 19 }} onClick={toggleRightPanel} />
          <FocusTrap open={compactRightOpen} disableAutoFocus disableEnforceFocus={false} disableRestoreFocus>
        <Box
          ref={drawerRef}
          id="omega-right-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="工作台辅助面板"
          sx={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: `min(${MAX_RIGHT_PX}px, 88vw)`,
            minWidth: 0,
            maxWidth: "100vw",
            zIndex: 20,
            background: "var(--omega-bg-rail)",
            boxShadow: "var(--omega-shadow-lg)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "flex-start", p: 0.5, borderBottom: "1px solid var(--omega-border)" }}>
            <Tooltip title="关闭面板">
              <IconButton size="small" onClick={toggleRightPanel} aria-label="关闭右侧面板" sx={{ color: "var(--omega-text-muted)" }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ minHeight: 0, flex: 1, display: "flex" }}>
            <RightPanel />
          </Box>
        </Box>
          </FocusTrap>
        </>
      ) : null}
    </Box>
  );
}
