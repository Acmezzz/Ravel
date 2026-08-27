import * as React from "react";

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

/** Draggable and keyboard-operable separator between workbench columns. */
export function PanelResizeHandle({ side, label, value, min, max, defaultValue, onChange, onDragStateChange }: PanelResizeHandleProps): React.ReactElement {
  const [dragging, setDragging] = React.useState(false);
  const startRef = React.useRef({ x: 0, value: 0 });
  const valueRef = React.useRef(value); valueRef.current = value;
  const onChangeRef = React.useRef(onChange); onChangeRef.current = onChange;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault(); const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* older Electron */ }
    startRef.current = { x: event.clientX, value: valueRef.current }; setDragging(true); onDragStateChange?.(true);
    const onMove = (move: PointerEvent) => { const delta = side === "left" ? move.clientX - startRef.current.x : startRef.current.x - move.clientX; onChangeRef.current(clamp(startRef.current.value + delta)); };
    const cleanup = () => { target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); target.removeEventListener("lostpointercapture", cleanup); try { if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId); } catch { /* already released */ } document.body.style.cursor = ""; document.body.style.userSelect = ""; setDragging(false); onDragStateChange?.(false); };
    const onUp = () => cleanup(); document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; target.addEventListener("pointermove", onMove); target.addEventListener("pointerup", onUp); target.addEventListener("lostpointercapture", cleanup);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => { const big = event.shiftKey ? KEYBOARD_STEP_PX * 4 : KEYBOARD_STEP_PX; let handled = true; if (event.key === (side === "left" ? "ArrowLeft" : "ArrowRight")) onChangeRef.current(clamp(valueRef.current - big)); else if (event.key === (side === "left" ? "ArrowRight" : "ArrowLeft")) onChangeRef.current(clamp(valueRef.current + big)); else if (event.key === "Home") onChangeRef.current(min); else if (event.key === "End") onChangeRef.current(max); else handled = false; if (handled) event.preventDefault(); };
  return <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} tabIndex={0} className="omega-panel-resize-handle" data-side={side} data-dragging={dragging ? "true" : undefined} onPointerDown={startDrag} onKeyDown={onKeyDown} onDoubleClick={() => onChange(defaultValue)} />;
}
