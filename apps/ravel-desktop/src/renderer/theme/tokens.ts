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
	bgApp: "var(--omega-bg)",
	bgRail: "var(--omega-bg-rail)",
	bgPanel: "var(--omega-bg-panel)",
	bgSoft: "var(--omega-bg-soft)",
	bgElevated: "var(--omega-bg-elevated)",
	bgOverlay: "var(--omega-bg-overlay)",
	bgCode: "var(--omega-bg-code)",
	bgUserBubble: "var(--omega-accent)",
	border: "var(--omega-border)",
	borderStrong: "var(--omega-border-strong)",
	text: "var(--omega-text)",
	textSoft: "var(--omega-text-soft)",
	textMuted: "var(--omega-text-muted)",
	textDim: "var(--omega-text-dim)",
	accent: "var(--omega-accent)",
	accentStrong: "var(--omega-accent-strong)",
	accentSoft: "var(--omega-accent-soft)",
	accentLine: "var(--omega-accent-line)",
	success: "var(--omega-success)",
	warning: "var(--omega-warning)",
	danger: "var(--omega-danger)",
	successSoft: "var(--omega-success-soft)",
	warningSoft: "var(--omega-warning-soft)",
	dangerSoft: "var(--omega-danger-soft)",
	errorText: "var(--omega-error-text)",
	scrollbar: "var(--omega-scrollbar)",
	scrollbarHover: "var(--omega-scrollbar-hover)",
	shadow: "var(--omega-shadow-md)",
	shadowSm: "var(--omega-shadow-sm)",
	shadowMd: "var(--omega-shadow-md)",
	shadowLg: "var(--omega-shadow-lg)",
	insetHighlight: "var(--omega-inset-highlight)",
	insetRecessed: "var(--omega-inset-recessed)",
	glowAccent: "var(--omega-glow-accent)",
	glow1: "var(--omega-glow-1)",
	glow2: "var(--omega-glow-2)",
	accentForeground: "var(--omega-accent-foreground)",
	accentGradient: "var(--omega-accent-gradient)",
	selected: "var(--omega-selected)",
	hoverFill: "var(--omega-hover-fill)",
	panelGlass: "var(--omega-panel-glass)",
	composerBg: "var(--omega-composer-bg)",
	inlineCodeBg: "var(--omega-inline-code-bg)",
	inlineCodeFg: "var(--omega-inline-code-fg)",
	selection: "var(--omega-selection)",
};

/** Kept as named mode exports during the MUI migration; CSS class selects mode. */
export const darkPalette: Palette = cssPalette;
export const lightPalette: Palette = cssPalette;
export function paletteForMode(_mode: "light" | "dark"): Palette {
	return cssPalette;
}
