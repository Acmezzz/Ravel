/**
 * Tailwind configuration. Color utilities point at CSS custom properties so
 * they stay on the same token source as `theme/tokens.ts` / `global.css`.
 * See docs/system_design.md §5.
 */
import type { Config } from "tailwindcss";

/** Legacy component config retained during the Tailwind 4 CSS-first migration. */
export default {
	content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				bgApp: "var(--ravel-bg)",
				bgPanel: "var(--ravel-bg-panel)",
				bgElevated: "var(--ravel-bg-elevated)",
				bgSoft: "var(--ravel-bg-soft)",
				border: "var(--ravel-border)",
				borderStrong: "var(--ravel-border-strong)",
				text: "var(--ravel-text)",
				muted: "var(--ravel-text-muted)",
				accent: "var(--ravel-accent)",
				accentStrong: "var(--ravel-accent-strong)",
				success: "var(--ravel-success)",
				warning: "var(--ravel-warning)",
				danger: "var(--ravel-danger)",
			},
			borderRadius: {
				sm: "var(--ravel-radius-sm)",
				md: "var(--ravel-radius-md)",
				lg: "var(--ravel-radius-lg)",
				xl: "20px",
				pill: "var(--ravel-radius-pill)",
			},
			spacing: {
				1: "4px",
				2: "8px",
				3: "12px",
				4: "16px",
				5: "20px",
				6: "24px",
			},
			boxShadow: {
				panel: "var(--ravel-shadow-md)",
				overlay: "var(--ravel-shadow-lg)",
			},
			transitionTimingFunction: {
				ravel: "var(--ravel-ease-out)",
			},
			transitionDuration: {
				fast: "var(--ravel-dur-fast)",
				normal: "var(--ravel-dur-normal)",
				slow: "var(--ravel-dur-slow)",
			},
		},
	},
	plugins: [],
} satisfies Config;
