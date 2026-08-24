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
  bgApp: "#0c0d10",
  bgPanel: "#16181e",
  bgElevated: "#20242d",
  bgSoft: "#1b1e26",
  border: "rgba(196, 188, 168, 0.10)",
  borderStrong: "rgba(196, 188, 168, 0.20)",
  text: "#f3f0ea",
  muted: "#a8a295",
  accent: "#e8b44a",
  accentStrong: "#f0c56a",
  success: "#52d495",
  warning: "#e8b85e",
  danger: "#f07584",
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
