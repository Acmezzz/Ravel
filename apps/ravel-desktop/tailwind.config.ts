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
				bgApp: "var(--omega-bg)",
				bgPanel: "var(--omega-bg-panel)",
				bgElevated: "var(--omega-bg-elevated)",
				bgSoft: "var(--omega-bg-soft)",
				border: "var(--omega-border)",
				borderStrong: "var(--omega-border-strong)",
				text: "var(--omega-text)",
				muted: "var(--omega-text-muted)",
				accent: "var(--omega-accent)",
				accentStrong: "var(--omega-accent-strong)",
				success: "var(--omega-success)",
				warning: "var(--omega-warning)",
				danger: "var(--omega-danger)",
			},
			borderRadius: {
				sm: "var(--omega-radius-sm)",
				md: "var(--omega-radius-md)",
				lg: "var(--omega-radius-lg)",
				xl: "20px",
				pill: "var(--omega-radius-pill)",
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
				panel: "var(--omega-shadow-md)",
				overlay: "var(--omega-shadow-lg)",
			},
			transitionTimingFunction: {
				omega: "var(--omega-ease-out)",
			},
			transitionDuration: {
				fast: "var(--omega-dur-fast)",
				normal: "var(--omega-dur-normal)",
				slow: "var(--omega-dur-slow)",
			},
		},
	},
	plugins: [],
} satisfies Config;
