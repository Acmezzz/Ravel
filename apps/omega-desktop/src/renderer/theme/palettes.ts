/**
 * Dual-mode design tokens (light + dark), keyed identically so CSS custom
 * properties and MUI palettes stay in lockstep.
 *
 * Visual language: "Iris Workshop" — cool-neutral layered surfaces
 * separated by translucent hairlines, with a restrained blue-violet accent.
 * Surfaces stay crisp and slightly cool; color is reserved for focus,
 * running state, user bubbles, and semantic actions.
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
  bgApp: "#0c0d10",
  bgRail: "#111318",
  bgPanel: "#16181e",
  bgSoft: "#1b1e26",
  bgElevated: "#20242d",
  bgOverlay: "#262a35",
  bgCode: "#0d0e12",
  bgUserBubble: "#6657d9",
  border: "rgba(196, 188, 168, 0.10)",
  borderStrong: "rgba(196, 188, 168, 0.20)",
  text: "#f3f0ea",
  textMuted: "#a8a295",
  textDim: "#6f6a60",
  accent: "#9b91ff",
  accentStrong: "#b2aaff",
  accentSoft: "rgba(155, 145, 255, 0.14)",
  accentLine: "rgba(155, 145, 255, 0.40)",
  success: "#52d495",
  warning: "#e8b85e",
  danger: "#f07584",
  successSoft: "rgba(82, 212, 149, 0.12)",
  warningSoft: "rgba(232, 184, 94, 0.12)",
  dangerSoft: "rgba(240, 117, 132, 0.12)",
  scrollbar: "rgba(196, 188, 168, 0.22)",
  scrollbarHover: "rgba(196, 188, 168, 0.36)",
  shadow: "rgba(0, 0, 0, 0.50)",
  shadowSm: "0 1px 2px rgba(0, 0, 0, 0.40)",
  shadowMd: "0 6px 20px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.30)",
  shadowLg: "0 20px 56px rgba(0, 0, 0, 0.60), 0 4px 16px rgba(0, 0, 0, 0.38)",
  insetHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  accentGradient: "linear-gradient(135deg, #6657d9 0%, #9b91ff 100%)",
};

export const lightPalette: Palette = {
  bgApp: "#f4f5f6",
  bgRail: "#eceeef",
  bgPanel: "#ffffff",
  bgSoft: "#f7f8f8",
  bgElevated: "#ffffff",
  bgOverlay: "#ffffff",
  bgCode: "#f1f2f3",
  bgUserBubble: "#6657d9",
  border: "rgba(28, 26, 22, 0.08)",
  borderStrong: "rgba(28, 26, 22, 0.15)",
  text: "#1a1916",
  textMuted: "#5e5b54",
  textDim: "#8e8a81",
  accent: "#6657d9",
  accentStrong: "#5142bd",
  accentSoft: "rgba(102, 87, 217, 0.10)",
  accentLine: "rgba(102, 87, 217, 0.34)",
  success: "#13995b",
  warning: "#b07f10",
  danger: "#d84558",
  successSoft: "rgba(19, 153, 91, 0.10)",
  warningSoft: "rgba(176, 127, 16, 0.10)",
  dangerSoft: "rgba(216, 69, 88, 0.10)",
  scrollbar: "rgba(28, 26, 22, 0.18)",
  scrollbarHover: "rgba(28, 26, 22, 0.30)",
  shadow: "rgba(26, 25, 22, 0.12)",
  shadowSm: "0 1px 2px rgba(26, 25, 22, 0.05)",
  shadowMd: "0 4px 16px rgba(26, 25, 22, 0.08), 0 1px 3px rgba(26, 25, 22, 0.05)",
  shadowLg: "0 16px 48px rgba(26, 25, 22, 0.14), 0 4px 12px rgba(26, 25, 22, 0.06)",
  insetHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.70)",
  accentGradient: "linear-gradient(135deg, #5142bd 0%, #7b6ff0 100%)",
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
