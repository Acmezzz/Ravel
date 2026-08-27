/**
 * Theme mode helpers. Color values live in `tokens.ts` (the single TypeScript
 * source). CSS custom properties in `styles/global.css` must match; a contract
 * test fails if they drift.
 */
import { darkPalette, lightPalette, motion, paletteForMode, type Palette, type ThemeMode } from "./tokens";

export type { Palette, ThemeMode };
export { darkPalette, lightPalette, paletteForMode };

/** Resolve the persisted preference before React renders (CSP-safe, no inline script). */
export function initialResolvedMode(): "light" | "dark" {
	try {
		const raw = localStorage.getItem("ravel-theme") ?? localStorage.getItem("omega-theme");
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
				{ duration: motion.durSlowMs, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
			);
		})
		.catch(() => {
			/* transition cancelled — theme already applied */
		});
}
