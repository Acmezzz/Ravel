/**
 * Tailwind configuration. Colors are mirrored from `theme/tokens.ts` (which is
 * the single source of truth for design tokens) so Tailwind utility classes and
 * MUI's palette never drift apart. See docs/system_design.md §5.
 */
import type { Config } from "tailwindcss";

const tokens = {
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
