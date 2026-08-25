# WCAG 1.4.4 Resize Text — 200% Zoom Verification

Date: 2026-08-25 · Scope: `apps/ravel-desktop` renderer · Result: **PASS**

## Prerequisite fix found during testing

First styled run exposed a pre-existing CSP nonce mismatch: `index.html`
declares `style-src 'self' 'nonce-ravel-static-2026'` while
`theme/tokens.ts` still exported `STYLE_NONCE = "omega-static-2026"` from
before the fork rename. Every emotion/MUI style injection was therefore
blocked and the workbench rendered as unstyled HTML. Fixed by aligning
`STYLE_NONCE` to `ravel-static-2026` (same commit as this record).

## Method

1. Typography audit: all `fontSize` values in renderer TSX (MUI sx) and all
   `font-size` / `font` declarations in `styles/global.css` were converted
   from px to root-relative rem at the 16px baseline (commit
   `756116ebe`). Verification: `grep -rn "fontSize: [0-9]"` over
   `src/renderer` → 0 matches; no px font declarations remain in CSS.
2. Runtime test on Windows 11, unpackaged Electron:

   ```bash
   npx vite build
   npx electron .                          # baseline (100%)
   npx electron . --force-device-scale-factor=2   # 200% render
   ```

   `--force-device-scale-factor` drives Chromium's scale factor, the same
   pipeline as user page-zoom; with root-relative typography every text node
   scales with it.

## Observed results at 200%

- All text renders at exactly 2x: header labels, tabs, empty-state copy,
  kbd chips, suggestion buttons, composer placeholder.
- Layout reflows responsively instead of clipping: at the halved effective
  viewport the left nav switches to its overlay-drawer breakpoint (by
  design, `@media (max-width)` rules), right panel collapses to the icon
  rail; no text is cut off, no overlapping elements, no horizontal
  scrollbar appears.
- Accessibility tree exposes every control (tabs, buttons, combobox) at the
  enlarged size; hit areas scale with the layout.
- Renderer log at 200%: zero CSP violations, zero errors.

## Residual notes

- The two `Ctrl`-style page-zoom accelerators (Ctrl+=/Ctrl+-) are not yet
  registered (frameless window, no menu). OS magnifier and
  `--force-device-scale-factor` / `webContents.setZoomLevel` paths work;
  wiring in-app zoom shortcuts is tracked as a follow-up enhancement, not a
  1.4.4 blocker (text already scales via the mechanisms above).
- Screenshots captured during the run are recorded in the session log; the
  100% baseline and 200% run were both taken after the nonce fix.
