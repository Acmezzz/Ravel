/**
 * MUI theme provider wiring:
 *   CacheProvider (our emotion cache with the CSP nonce AND prepend ordering)
 *   ThemeProvider (MUI theme rebuilt from the active palette)
 *   CssBaseline (normalize + apply the mode background)
 *
 * The component overrides below are the "de-MUI-ification" layer: they strip
 * the stock Material look (filled tonal buttons, dense hairline tabs, flat
 * dialogs) and replace it with the Omega visual language — hairline borders,
 * pill/soft geometry, layered shadows, and the shared motion tokens.
 *
 * NOTE: do NOT wrap this tree in <StyledEngineProvider injectFirst>. It creates
 * its own NON-nonced emotion cache (`createCache({ key: 'css' })`) and overrides
 * ours via an inner CacheProvider, so every MUI <style> injection violates the
 * index.html CSP (`style-src 'self' 'nonce-...'`). Our cache already sets both
 * `prepend: true` and the shared nonce.
 */
import * as React from "react";
import { createTheme, ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { CacheProvider } from "@emotion/react";
import { emotionCache } from "./emotion-cache";
import { paletteForMode } from "./palettes";
import { fontFamily, monoFamily } from "./tokens";
import { useAppStore } from "../store/useAppStore";

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const resolvedMode = useAppStore((s) => s.resolvedMode);
  const palette = React.useMemo(() => paletteForMode(resolvedMode), [resolvedMode]);

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: resolvedMode,
          background: { default: palette.bgApp, paper: palette.bgPanel },
          primary: { main: palette.accentStrong, contrastText: palette.accentForeground },
          secondary: { main: palette.accent },
          error: { main: palette.danger },
          success: { main: palette.success },
          warning: { main: palette.warning },
          text: { primary: palette.text, secondary: palette.textMuted },
          divider: palette.border,
        },
        shape: { borderRadius: 10 },
        typography: {
          fontFamily,
          fontSize: "0.875rem",
          button: { fontWeight: 550, letterSpacing: "0.005em" },
        },
        transitions: {
          easing: { easeOut: EASE_OUT, sharp: EASE_OUT },
          duration: { shortest: 120, shorter: 160, short: 200, standard: 200 },
        },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: "none",
                backgroundColor: palette.bgPanel,
              },
            },
          },
          MuiButton: {
            defaultProps: { disableElevation: true, disableRipple: true },
            styleOverrides: {
              root: {
                textTransform: "none",
                fontWeight: 550,
                borderRadius: 9,
                letterSpacing: "0.005em",
                transition: `background 140ms ${EASE_OUT}, border-color 140ms ${EASE_OUT}, box-shadow 140ms ${EASE_OUT}, color 140ms ${EASE_OUT}, filter 140ms ${EASE_OUT}, transform 140ms ${EASE_OUT}`,
                "&:active": { transform: "scale(0.97)" },
              },
              contained: {
                background: palette.accentGradient,
                color: palette.accentForeground,
                boxShadow: `${palette.shadowSm}, ${palette.insetHighlight}, ${palette.glowAccent}`,
                "&:hover": {
                  background: palette.accentGradient,
                  filter: "brightness(1.07)",
                  transform: "translateY(-0.5px)",
                  boxShadow: `${palette.shadowMd}, ${palette.insetHighlight}, ${palette.glowAccent}`,
                },
                "&:active": { transform: "translateY(0.5px)" },
              },
              outlined: {
                borderColor: palette.borderStrong,
                boxShadow: palette.insetHighlight,
                "&:hover": {
                  borderColor: palette.accent,
                  background: palette.accentSoft,
                  transform: "translateY(-0.5px)",
                  boxShadow: `${palette.shadowSm}, ${palette.insetHighlight}`,
                },
              },
              text: {
                "&:hover": { background: "var(--omega-hover-fill)" },
              },
            },
          },
          MuiIconButton: {
            defaultProps: { disableRipple: true },
            styleOverrides: {
              root: {
                borderRadius: 8,
                transition: `background-color 140ms ${EASE_OUT}, color 140ms ${EASE_OUT}, transform 140ms ${EASE_OUT}`,
                "&:hover": { background: "var(--omega-hover-fill)" },
                "&:active": { transform: "scale(0.92)" },
              },
            },
          },
          MuiChip: {
            defaultProps: { size: "small" },
            styleOverrides: {
              root: {
                fontWeight: 550,
                letterSpacing: "0.01em",
                borderRadius: 8,
                transition: `background-color 140ms ${EASE_OUT}, border-color 140ms ${EASE_OUT}, box-shadow 140ms ${EASE_OUT}, color 140ms ${EASE_OUT}, transform 140ms ${EASE_OUT}`,
              },
              sizeSmall: { height: 22, fontSize: "0.75rem" },
              outlined: {
                borderColor: palette.borderStrong,
                background: "transparent",
              },
              filled: {
                background: palette.accentSoft,
                color: palette.accent,
              },
            },
          },
          MuiTabs: {
            styleOverrides: {
              root: { minHeight: 36 },
              indicator: {
                height: 2,
                borderRadius: 2,
                background: palette.accent,
              },
            },
          },
          MuiTab: {
            defaultProps: { disableRipple: true },
            styleOverrides: {
              root: {
                textTransform: "none",
                fontWeight: 550,
                fontSize: "0.8125rem",
                letterSpacing: "0.005em",
                color: palette.textMuted,
                minHeight: 36,
                padding: "6px 12px",
                transition: `color 140ms ${EASE_OUT}`,
                "&.Mui-selected": { color: palette.text, fontWeight: 600 },
                "&:hover": { color: palette.text },
              },
            },
          },
          MuiTooltip: {
            styleOverrides: {
              tooltip: {
                backgroundColor: palette.bgOverlay,
                border: `1px solid ${palette.borderStrong}`,
                boxShadow: palette.shadowMd,
                color: palette.text,
                fontSize: "0.75rem",
                fontWeight: 500,
                letterSpacing: "0.005em",
                padding: "5px 9px",
                borderRadius: 8,
                backdropFilter: "blur(12px)",
              },
              arrow: { color: palette.bgOverlay },            },
          },
          MuiMenu: {
            styleOverrides: {
              paper: {
                backgroundColor: palette.bgOverlay,
                border: `1px solid ${palette.borderStrong}`,
                borderRadius: 12,
                boxShadow: `${palette.shadowLg}, ${palette.insetHighlight}`,
                backgroundImage: "none",
                backdropFilter: "blur(18px) saturate(1.4)",
                maxHeight: 380,
              },
              list: { padding: "5px" },
            },
          },
          MuiMenuItem: {
            defaultProps: { disableRipple: true },
            styleOverrides: {
              root: {
                fontSize: "0.8125rem",
                fontWeight: 500,
                borderRadius: 7,
                margin: "1px 0",
                padding: "6px 10px",
                transition: `background 120ms ${EASE_OUT}`,
                "&.Mui-selected": {
                  background: palette.accentSoft,
                  color: palette.accent,
                  boxShadow: palette.insetHighlight,
                  "&:hover": { background: palette.accentSoft },
                },
              },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: {
                backgroundColor: palette.bgOverlay,
                border: `1px solid ${palette.borderStrong}`,
                borderRadius: 16,
                boxShadow: `${palette.shadowLg}, ${palette.insetHighlight}`,
                backgroundImage: "none",
              },
            },
          },
          MuiDialogTitle: {
            styleOverrides: {
              root: {
                fontSize: "0.9375rem",
                fontWeight: 650,
                letterSpacing: "-0.01em",
                padding: "18px 20px 8px",
              },
            },
          },
          MuiDialogContent: {
            styleOverrides: {
              root: { padding: "8px 20px 16px" },
            },
          },
          MuiDialogActions: {
            styleOverrides: {
              root: { padding: "12px 20px 16px" },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                borderRadius: 10,
                backgroundColor: palette.bgSoft,
                transition: `box-shadow 140ms ${EASE_OUT}`,
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: palette.border,
                  transition: `border-color 140ms ${EASE_OUT}`,
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: palette.borderStrong,
                },
                "&.Mui-focused": {
                  backgroundColor: palette.bgPanel,
                  boxShadow: `0 0 0 3px ${palette.accentSoft}`,
                },
                "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                  borderColor: palette.accent,
                  borderWidth: 1,
                },
              },
              input: { padding: "7px 12px", fontSize: "0.8125rem" },
            },
          },
          MuiLinearProgress: {
            styleOverrides: {
              root: { borderRadius: 999, backgroundColor: palette.bgSoft },
              bar: { borderRadius: 999 },
            },
          },
          MuiCircularProgress: {
            styleOverrides: {
              circle: { strokeLinecap: "round" },
            },
          },
          MuiAccordion: {
            defaultProps: { disableGutters: true, elevation: 0 },
            styleOverrides: {
              root: {
                fontFamily,
                backgroundImage: "none",
                "&:before": { display: "none" },
              },
            },
          },
          MuiAccordionSummary: {
            styleOverrides: {
              root: {
                minHeight: 40,
                "&.Mui-expanded": { minHeight: 40 },
              },
              content: {
                margin: "8px 0",
                "&.Mui-expanded": { margin: "8px 0" },
              },
            },
          },
          MuiListItemButton: {
            defaultProps: { disableRipple: true },
            styleOverrides: {
              root: {
                transition: `background 120ms ${EASE_OUT}`,
              },
            },
          },
          MuiDivider: {
            styleOverrides: {
              root: { borderColor: palette.border },
            },
          },
          MuiInputBase: {
            styleOverrides: { input: { fontFamily } },
          },
          MuiSwitch: {
            styleOverrides: {
              root: { width: 36, height: 22, padding: 0 },
              switchBase: {
                padding: 2,
                "&.Mui-checked": {
                  transform: "translateX(14px)",
                  color: palette.accentForeground,
                  "& + .MuiSwitch-track": {
                    background: palette.accentGradient,
                    opacity: 1,
                  },
                },
              },
              thumb: { width: 18, height: 18, boxShadow: palette.shadowSm },
              track: {
                borderRadius: 999,
                backgroundColor: palette.borderStrong,
                opacity: 1,
                transition: `background 160ms ${EASE_OUT}`,
              },
            },
          },
        },
      }),
    [palette, resolvedMode],
  );

  return (
    <CacheProvider value={emotionCache}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </CacheProvider>
  );
}

export { monoFamily };
