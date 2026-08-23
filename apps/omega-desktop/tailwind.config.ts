/**
 * Tailwind configuration. Colors are mirrored from `theme/tokens.ts` (which is
 * the single source of truth for design tokens) so Tailwind utility classes and
 * MUI's palette never drift apart. See docs/system_design.md §5.
 */
import type { Config } from "tailwindcss";

const tokens = {
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
};

export default {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tokens,
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
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
        panel: "0 6px 20px rgba(0,0,0,.42), 0 1px 4px rgba(0,0,0,.30)",
        overlay: "0 20px 56px rgba(0,0,0,.55), 0 4px 16px rgba(0,0,0,.35)",
      },
      transitionTimingFunction: {
        omega: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
