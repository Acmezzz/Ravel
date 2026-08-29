/**
 * Design tokens. CSS custom properties in `styles/global.css` are the sole
 * color source; TypeScript owns only geometry and motion.
 */

export const motion = {
	easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
	durFastMs: 120,
	durNormalMs: 200,
	durSlowMs: 320,
} as const;

/**
 * Runtime style injection.
 *
 * CodeMirror, xterm and React Flow all mount styles at runtime without a nonce,
 * so `index.html` keeps `style-src ... 'unsafe-inline'` while `script-src` stays
 * strict. See the CSP comment there for the reasoning.
 */

export type ThemeMode = "light" | "dark" | "system";

export interface Palette {
	bgApp: string;
	bgRail: string;
	bgPanel: string;
	bgSoft: string;
	bgElevated: string;
	bgOverlay: string;
	bgCode: string;
	bgUserBubble: string;
	border: string;
	borderStrong: string;
	text: string;
	textSoft: string;
	textMuted: string;
	textDim: string;
	accent: string;
	accentStrong: string;
	accentSoft: string;
	accentLine: string;
	success: string;
	warning: string;
	danger: string;
	successSoft: string;
	warningSoft: string;
	dangerSoft: string;
	errorText: string;
	scrollbar: string;
	scrollbarHover: string;
	shadow: string;
	shadowSm: string;
	shadowMd: string;
	shadowLg: string;
	insetHighlight: string;
	insetRecessed: string;
	glowAccent: string;
	glow1: string;
	glow2: string;
	accentForeground: string;
	accentGradient: string;
	selected: string;
	hoverFill: string;
	panelGlass: string;
	composerBg: string;
	inlineCodeBg: string;
	inlineCodeFg: string;
	selection: string;
}

const cssPalette: Palette = {
	bgApp: "var(--ravel-bg)",
	bgRail: "var(--ravel-bg-rail)",
	bgPanel: "var(--ravel-bg-panel)",
	bgSoft: "var(--ravel-bg-soft)",
	bgElevated: "var(--ravel-bg-elevated)",
	bgOverlay: "var(--ravel-bg-overlay)",
	bgCode: "var(--ravel-bg-code)",
	bgUserBubble: "var(--ravel-accent)",
	border: "var(--ravel-border)",
	borderStrong: "var(--ravel-border-strong)",
	text: "var(--ravel-text)",
	textSoft: "var(--ravel-text-soft)",
	textMuted: "var(--ravel-text-muted)",
	textDim: "var(--ravel-text-dim)",
	accent: "var(--ravel-accent)",
	accentStrong: "var(--ravel-accent-strong)",
	accentSoft: "var(--ravel-accent-soft)",
	accentLine: "var(--ravel-accent-line)",
	success: "var(--ravel-success)",
	warning: "var(--ravel-warning)",
	danger: "var(--ravel-danger)",
	successSoft: "var(--ravel-success-soft)",
	warningSoft: "var(--ravel-warning-soft)",
	dangerSoft: "var(--ravel-danger-soft)",
	errorText: "var(--ravel-error-text)",
	scrollbar: "var(--ravel-scrollbar)",
	scrollbarHover: "var(--ravel-scrollbar-hover)",
	shadow: "var(--ravel-shadow-md)",
	shadowSm: "var(--ravel-shadow-sm)",
	shadowMd: "var(--ravel-shadow-md)",
	shadowLg: "var(--ravel-shadow-lg)",
	insetHighlight: "var(--ravel-inset-highlight)",
	insetRecessed: "var(--ravel-inset-recessed)",
	glowAccent: "var(--ravel-glow-accent)",
	glow1: "var(--ravel-glow-1)",
	glow2: "var(--ravel-glow-2)",
	accentForeground: "var(--ravel-accent-foreground)",
	accentGradient: "var(--ravel-accent-gradient)",
	selected: "var(--ravel-selected)",
	hoverFill: "var(--ravel-hover-fill)",
	panelGlass: "var(--ravel-panel-glass)",
	composerBg: "var(--ravel-composer-bg)",
	inlineCodeBg: "var(--ravel-inline-code-bg)",
	inlineCodeFg: "var(--ravel-inline-code-fg)",
	selection: "var(--ravel-selection)",
};

/** Kept as named mode exports during the MUI migration; CSS class selects mode. */
export const darkPalette: Palette = cssPalette;
export const lightPalette: Palette = cssPalette;
export function paletteForMode(_mode: "light" | "dark"): Palette {
	return cssPalette;
}
