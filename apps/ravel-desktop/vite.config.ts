/**
 * Vite configuration for the Ravel Desktop renderer (Vite 8 / Rolldown).
 *
 * Hard constraints (see docs/ravel-histos-refactor-plan.md §T2):
 *  - Output a SINGLE classic (IIFE) script with code splitting disabled, so
 *    it can be loaded via `<script src="./dist/assets/index.js">` without
 *    violating the `script-src 'self' app:` CSP (no ES modules, no eval, no
 *    inline scripts).
 *  - Base is relative (`./`) so the built files work behind the contained
 *    app:// protocol.
 *  - CSS is emitted as one external file (`dist/assets/style.css`) to satisfy
 *    `style-src 'self' app:`.
 *  - No HMR dev server is used; `dev`/`watch` are build --watch only.
 */
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: ".",
  base: "./",
  resolve: {
    alias: {
      react: resolvePath(desktopRoot, "node_modules/react"),
      "react-dom": resolvePath(desktopRoot, "node_modules/react-dom"),
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
  ],
  // The layout worker is referenced by a stable URL at runtime: `import.meta`
  // is erased in the IIFE bundle, so `new URL(..., import.meta.url)` cannot be
  // used. Classic (non-module) output keeps the CSP constraint intact.
  worker: {
    format: "iife",
    rollupOptions: {
      output: {
        entryFileNames: "assets/graph-layout.worker.js",
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: "src/renderer/main.tsx",
      codeSplitting: false,
      output: {
        format: "iife",
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
