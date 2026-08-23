import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeKeybindings } from "../electron/keybindings.js";

test("keybinding validation rejects malformed and conflicting shortcuts", () => {
  const invalid = sanitizeKeybindings({ commandPalette: "not a shortcut", newSession: "Ctrl+K", abort: "Ctrl+K" });
  assert.equal(invalid.conflicts.length, 1);
  assert.equal(invalid.conflicts[0].binding, "Ctrl+K");
  assert.match(sanitizeKeybindings({ commandPalette: "Alt+P" }).commandPalette, /Alt\+P/);
});
