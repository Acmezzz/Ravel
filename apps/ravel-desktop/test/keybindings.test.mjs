import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesktopSettings } from "../electron/desktop-settings.js";
import { readFile } from "node:fs/promises";

test("desktop keybindings are sanitized and renderer reads the settings", async () => {
  const settings = sanitizeDesktopSettings({ keybindings: { commandPalette: "Alt+P", newSession: "Ctrl+Alt+N", abort: "Escape" } });
  assert.equal(settings.keybindings.commandPalette, "Alt+P");
  // Keybinding handling lives in its own coordinator since the App split.
  const shortcuts = await readFile(new URL("../src/renderer/app/AppKeyboardShortcuts.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../src/renderer/components/layout/SettingsDialog.tsx", import.meta.url), "utf8");
  assert.match(shortcuts, /desktopSettings\?\.keybindings/);
  assert.match(shortcuts, /matchesKeybinding/);
  assert.match(dialog, /keybindings/);
});
