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

## In-app zoom shortcuts (follow-up, implemented)

Configurable `zoomIn` / `zoomOut` / `zoomReset` shortcuts (defaults
`Ctrl+=` / `Ctrl+-` / `Ctrl+0`) now live in the desktop keybindings schema
(`electron/keybindings.js`, editable in Settings → 桌面与快捷键). The
renderer applies them by scaling the root font size, which every rem-based
text size follows (0.75x–2x, 0.25 steps).

Verified over CDP (`Input.dispatchKeyEvent`, no OS focus needed) on the
built bundle:

```
before:          root (unset)   body 14px
after 3x Ctrl+=: root 28px      body 24.5px   (175%)
after Ctrl+0:    root (unset)   body 14px     (reset)
after Ctrl+-:    root 12px      body 10.5px   (75%)
```

A 175% screenshot was captured during the same run: text scales, layout
reflows (left nav switches to its drawer breakpoint), nothing clips.
