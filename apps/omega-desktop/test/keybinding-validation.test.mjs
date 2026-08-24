import test from "node:test";
import assert from "node:assert/strict";
import { matchesKeybinding, sanitizeKeybindings } from "../electron/keybindings.js";

test("keybinding validation rejects malformed and conflicting shortcuts", () => {
  const invalid = sanitizeKeybindings({ commandPalette: "not a shortcut", newSession: "Ctrl+K", abort: "Ctrl+K" });
  assert.equal(invalid.conflicts.length, 1);
  assert.equal(invalid.conflicts[0].binding, "Ctrl+K");
  assert.match(sanitizeKeybindings({ commandPalette: "Alt+P" }).commandPalette, /Alt\+P/);
  assert.equal(matchesKeybinding("Ctrl+K", { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), true);
  assert.equal(matchesKeybinding("Ctrl+Shift+N", { key: "n", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }), true);
  assert.equal(matchesKeybinding("Alt+P", { key: "p", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), false);
});
