import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ipc } from "../ipc/client";
import { DEFAULT_KEYBINDINGS, matchesKeybinding } from "../lib/keybindings";
import { startNewSession } from "./AppBootstrap";

export interface AppKeyboardShortcutsProps {
  textZoom: number;
  onZoomChange: (zoom: number) => void;
}

/**
 * Global workbench keyboard shortcuts, extracted from `App.tsx`. Bindings come
 * from typed desktop settings (`DEFAULT_KEYBINDINGS` fallback) — never
 * hardcoded. Includes command-palette toggle, new session, text zoom, and
 * abort with the Esc-in-non-empty-input guard.
 */
export function AppKeyboardShortcuts({ textZoom, onZoomChange }: AppKeyboardShortcutsProps): React.ReactNode | null {
  const keybindings = useAppStore((s) => s.desktopSettings?.keybindings ?? DEFAULT_KEYBINDINGS);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (matchesKeybinding(keybindings.commandPalette, e)) {
        e.preventDefault();
        const layout = useAppStore.getState().layout;
        useAppStore.getState().setCommandPaletteOpen(!layout.commandPaletteOpen);
        return;
      }
      if (matchesKeybinding(keybindings.newSession, e)) {
        e.preventDefault();
        void startNewSession();
        return;
      }

      if (matchesKeybinding(keybindings.zoomIn, e)) {
        e.preventDefault();
        onZoomChange(Math.min(2, Math.round((textZoom + 0.25) * 100) / 100));
        return;
      }
      if (matchesKeybinding(keybindings.zoomOut, e)) {
        e.preventDefault();
        onZoomChange(Math.max(0.75, Math.round((textZoom - 0.25) * 100) / 100));
        return;
      }
      if (matchesKeybinding(keybindings.zoomReset, e)) {
        e.preventDefault();
        onZoomChange(1);
        return;
      }
      if (matchesKeybinding(keybindings.abort, e) && useAppStore.getState().connection === "running") {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
          (target as HTMLInputElement).value.length > 0
        ) {
          return; // Esc in a non-empty input belongs to the editor.
        }
        void ipc.abort().then(() => useAppStore.getState().setConnection("ready"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, textZoom, onZoomChange]);

  return null;
}