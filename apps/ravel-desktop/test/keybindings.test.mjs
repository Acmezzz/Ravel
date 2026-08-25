import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesktopSettings } from "../electron/desktop-settings.js";
import { readFile } from "node:fs/promises";

test("desktop keybindings are sanitized and renderer reads the settings", async () => {
  const settings = sanitizeDesktopSettings({ keybindings: { commandPalette: "Alt+P", newSession: "Ctrl+Alt+N", abort: "Escape" } });
  assert.equal(settings.keybindings.commandPalette, "Alt+P");
  const app = await readFile(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../src/renderer/components/layout/SettingsDialog.tsx", import.meta.url), "utf8");
  assert.match(app, /desktopSettings\?\.keybindings/);
  assert.match(app, /matchesKeybinding/);
  assert.match(dialog, /keybindings/);
});
