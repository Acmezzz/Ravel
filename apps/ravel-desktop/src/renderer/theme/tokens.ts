/**
 * Design tokens — single source of truth for geometry, type and motion.
 * Color values live in `palettes.ts` (dual-mode) and `styles/global.css`
 * (CSS custom properties); keep all three in sync when tuning.
 * See docs/system_design.md §5.
 */

/** Static style nonce shared by the index.html CSP and emotion's cache. */
export const STYLE_NONCE = "omega-static-2026";

export const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const monoFamily =
  'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace';
