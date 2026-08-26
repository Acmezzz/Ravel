import * as React from "react";
import Box from "@mui/material/Box";

export interface PanelResizeHandleProps {
  /** Which edge the panel sits on: dragging left grows it, right shrinks it. */
  side: "left" | "right";
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

const KEYBOARD_STEP_PX = 12;

/**
 * Draggable + keyboard-operable separator between workbench columns.
 * Pointer drag writes live width via onChange; arrow keys step by 12px
 * (48px with Shift), Home/End jump to min/max, and double-click restores
 * the default. Exposed to assistive tech as a vertical separator with
 * aria-valuenow so panel size is legible without a pointer.
 */
export function PanelResizeHandle({ side, label, value, min, max, defaultValue, onChange, onDragStateChange }: PanelResizeHandleProps): React.ReactElement {
  const [dragging, setDragging] = React.useState(false);
  const startRef = React.useRef({ x: 0, value: 0 });
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  const startDrag = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* older Electron */
    }
    startRef.current = { x: e.clientX, value: valueRef.current };
    setDragging(true);
    onDragStateChange?.(true);

    const onMove = (move: PointerEvent) => {
      const delta = side === "left" ? move.clientX - startRef.current.x : startRef.current.x - move.clientX;
      onChangeRef.current(clamp(startRef.current.value + delta));
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("lostpointercapture", cleanup);
      try {
        if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
      onDragStateChange?.(false);
    };
    const onUp = () => cleanup();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("lostpointercapture", cleanup);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const big = e.shiftKey ? KEYBOARD_STEP_PX * 4 : KEYBOARD_STEP_PX;
    let handled = true;
    // Left grows a left-docked panel; Right grows a right-docked one.
    if (e.key === (side === "left" ? "ArrowLeft" : "ArrowRight")) onChangeRef.current(clamp(valueRef.current - big));
    else if (e.key === (side === "left" ? "ArrowRight" : "ArrowLeft")) onChangeRef.current(clamp(valueRef.current + big));
    else if (e.key === "Home") onChangeRef.current(min);
    else if (e.key === "End") onChangeRef.current(max);
    else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <Box
      component="div"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(defaultValue)}
      sx={{
        position: "absolute",
        ...(side === "left" ? { right: -1 } : { left: -1 }),
        top: 0,
        bottom: 0,
        width: 5,
        cursor: "col-resize",
        zIndex: 5,
        touchAction: "none",
        transition: "background 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
        "&::after": {
          content: '""',
          position: "absolute",
          inset: "0 -3px",
        },
        "&:hover": { background: "var(--omega-accent-line)" },
        "&:active": { background: "var(--omega-accent)" },
        "&:focus-visible": { outline: "none", background: "var(--omega-accent)", boxShadow: `0 0 0 2px var(--omega-accent-soft)` },
      }}
      data-dragging={dragging ? "true" : undefined}
    />
  );
}
