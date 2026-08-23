/**
 * Design tokens — single source of truth for geometry, type and motion.
 * Color values live in `palettes.ts` (dual-mode) and `styles/global.css`
 * (CSS custom properties); keep all three in sync when tuning.
 * See docs/system_design.md §5.
 */

/** Static style nonce shared by the index.html CSP and emotion's cache. */
export const STYLE_NONCE = "omega-static-2026";

/** Legacy static color map (dark mode) — kept for tailwind.config.ts parity.
 *  Prefer `palettes.ts` for anything mode-aware. */
export const colors = {
  bgApp: "#0a0c12",
  bgPanel: "#12151e",
  bgElevated: "#1a1f2d",
  bgSoft: "#161a26",
  border: "rgba(148,163,197,0.10)",
  borderStrong: "rgba(148,163,197,0.20)",
  text: "#eceff7",
  muted: "#98a1b6",
  accent: "#8fa8ff",
  accentStrong: "#6d8dff",
  success: "#63d69c",
  warning: "#e5b96e",
  danger: "#ee7d8a",
} as const;

/** 4pt spacing grid */
export const spacing = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
} as const;

/** Corner radius scale — restrained, geometry-first */
export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  xl: "20px",
  pill: "999px",
} as const;

/** Type scale — seven steps, tight display tracking */
export const fontSize = {
  xs: "11px",
  sm: "12px",
  md: "13px",
  base: "14px",
  lg: "16px",
  xl: "18px",
  display: "22px",
} as const;

export const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const monoFamily =
  'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';

/** Motion — one shared easing family, three durations */
export const motion = {
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeSpring: "cubic-bezier(0.34, 1.4, 0.44, 1)",
  durFast: "120ms",
  durNormal: "200ms",
  durSlow: "320ms",
} as const;
