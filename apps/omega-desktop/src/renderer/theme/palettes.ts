/**
 * Dual-mode design tokens (light + dark), keyed identically so every
 * component can consume them through `usePalette()` without knowing the mode.
 *
 * Visual language: "modern dev-tool premium" — flat surfaces separated by
 * translucent hairline borders, layered luminance steps (~4-6% apart), a
 * three-level shadow scale, and one restrained blue-violet accent.
 *
 * These values MUST stay in sync with the CSS custom properties in
 * `styles/global.css` (the runtime source consumed via var(--omega-*)).
 */

export type ThemeMode = "light" | "dark" | "system";

export interface Palette {
  /** L0 — application canvas */
  bgApp: string;
  /** L1 — rails / sidebars (slightly offset from the canvas) */
  bgRail: string;
  /** L2 — primary panels (chat column, cards on the canvas) */
  bgPanel: string;
  /** L2.5 — soft inset surfaces (chips, tool cards, code-adjacent fills) */
  bgSoft: string;
  /** L3 — elevated surfaces (hover cards, composer) */
  bgElevated: string;
  /** L4 — overlays (menus, dialogs, popovers) */
  bgOverlay: string;
  bgCode: string;
  bgUserBubble: string;
  bgHover: string;
  /** Translucent hairline — the default border (never a solid swatch). */
  border: string;
  /** Stronger hairline for emphasis / focus-adjacent states. */
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  /** Translucent accent used for glows, rings and gradient stops. */
  accentLine: string;
  success: string;
  warning: string;
  danger: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
  scrollbar: string;
  scrollbarHover: string;
  shadow: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  /** Subtle top highlight inset on dark elevated surfaces (premium depth cue). */
  insetHighlight: string;
  /** Accent gradient for signature moments (send button, user bubble). */
  accentGradient: string;
}

export const darkPalette: Palette = {
  bgApp: "#0a0c12",
  bgRail: "#0e1118",
  bgPanel: "#12151e",
  bgSoft: "#161a26",
  bgElevated: "#1a1f2d",
  bgOverlay: "#1f2433",
  bgCode: "#0c0f16",
  bgUserBubble: "#5c7ef0",
  bgHover: "rgba(146,166,255,0.07)",
  border: "rgba(148,163,197,0.10)",
  borderStrong: "rgba(148,163,197,0.20)",
  text: "#eceff7",
  textMuted: "#98a1b6",
  textDim: "#626c85",
  accent: "#8fa8ff",
  accentStrong: "#6d8dff",
  accentSoft: "rgba(125,151,255,0.12)",
  accentLine: "rgba(125,151,255,0.38)",
  success: "#63d69c",
  warning: "#e5b96e",
  danger: "#ee7d8a",
  successSoft: "rgba(99,214,156,0.12)",
  warningSoft: "rgba(229,185,110,0.12)",
  dangerSoft: "rgba(238,125,138,0.12)",
  scrollbar: "rgba(148,163,197,0.22)",
  scrollbarHover: "rgba(148,163,197,0.36)",
  shadow: "rgba(0,0,0,0.45)",
  shadowSm: "0 1px 2px rgba(0,0,0,0.40)",
  shadowMd: "0 6px 20px rgba(0,0,0,0.42), 0 1px 4px rgba(0,0,0,0.30)",
  shadowLg: "0 20px 56px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.35)",
  insetHighlight: "inset 0 1px 0 rgba(255,255,255,0.05)",
  accentGradient: "linear-gradient(135deg, #6d8dff 0%, #8a7df2 100%)",
};

export const lightPalette: Palette = {
  bgApp: "#f3f4f7",
  bgRail: "#ebecf1",
  bgPanel: "#ffffff",
  bgSoft: "#f6f7fa",
  bgElevated: "#ffffff",
  bgOverlay: "#ffffff",
  bgCode: "#f0f1f6",
  bgUserBubble: "#3a55dd",
  bgHover: "rgba(58,85,221,0.06)",
  border: "rgba(28,38,66,0.08)",
  borderStrong: "rgba(28,38,66,0.16)",
  text: "#171b28",
  textMuted: "#5a6178",
  textDim: "#8c93a9",
  accent: "#4763e8",
  accentStrong: "#3a55dd",
  accentSoft: "rgba(71,99,232,0.09)",
  accentLine: "rgba(71,99,232,0.32)",
  success: "#15945c",
  warning: "#a97c14",
  danger: "#d34a5c",
  successSoft: "rgba(21,148,92,0.10)",
  warningSoft: "rgba(169,124,20,0.10)",
  dangerSoft: "rgba(211,74,92,0.10)",
  scrollbar: "rgba(28,38,66,0.18)",
  scrollbarHover: "rgba(28,38,66,0.30)",
  shadow: "rgba(23,27,40,0.14)",
  shadowSm: "0 1px 2px rgba(23,27,40,0.05)",
  shadowMd: "0 4px 16px rgba(23,27,40,0.08), 0 1px 3px rgba(23,27,40,0.05)",
  shadowLg: "0 16px 48px rgba(23,27,40,0.14), 0 4px 12px rgba(23,27,40,0.06)",
  insetHighlight: "inset 0 1px 0 rgba(255,255,255,0.65)",
  accentGradient: "linear-gradient(135deg, #3a55dd 0%, #6f5ee8 100%)",
};

export function paletteForMode(mode: "light" | "dark"): Palette {
  return mode === "dark" ? darkPalette : lightPalette;
}

/** Resolve the persisted preference before React renders (CSP-safe, no inline script). */
export function initialResolvedMode(): "light" | "dark" {
  try {
    const raw = localStorage.getItem("omega-theme");
    const mode = raw ? (JSON.parse(raw) as ThemeMode) : "system";
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
  } catch {
    /* fall through to system */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Circular-reveal theme switch via View Transitions (port of pi-web useTheme, MIT). */
export function applyModeWithTransition(nextMode: "light" | "dark", origin?: { x: number; y: number }): void {
  const root = document.documentElement;
  const apply = () => {
    root.classList.toggle("dark", nextMode === "dark");
    root.style.colorScheme = nextMode;
  };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const supportsVT = typeof document.startViewTransition === "function";
  if (!supportsVT || reduceMotion) {
    apply();
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = document.startViewTransition(apply);
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 420, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      /* transition cancelled — theme already applied */
    });
}
