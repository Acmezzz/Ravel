export const DEFAULT_KEYBINDINGS = Object.freeze({ commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape", zoomIn: "Ctrl+=", zoomOut: "Ctrl+-", zoomReset: "Ctrl+0" });

export function normalizeKeybinding(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
  if (!text || text.length > 64) return fallback;
  if (!/^(?:(?:Ctrl|Cmd|Alt|Shift)\+)*(?:[A-Za-z0-9]|Escape|Enter|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(text)) return fallback;
  return text;
}

export function sanitizeKeybindings(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {
    commandPalette: normalizeKeybinding(source.commandPalette, DEFAULT_KEYBINDINGS.commandPalette),
    newSession: normalizeKeybinding(source.newSession, DEFAULT_KEYBINDINGS.newSession),
    abort: normalizeKeybinding(source.abort, DEFAULT_KEYBINDINGS.abort),
    zoomIn: normalizeKeybinding(source.zoomIn, DEFAULT_KEYBINDINGS.zoomIn),
    zoomOut: normalizeKeybinding(source.zoomOut, DEFAULT_KEYBINDINGS.zoomOut),
    zoomReset: normalizeKeybinding(source.zoomReset, DEFAULT_KEYBINDINGS.zoomReset),
  };
  const conflicts = Object.entries(result).reduce((map, [key, binding]) => {
    const owners = map.get(binding) ?? [];
    owners.push(key);
    map.set(binding, owners);
    return map;
  }, new Map());
  return { ...result, conflicts: [...conflicts.entries()].filter(([, owners]) => owners.length > 1).map(([binding, owners]) => ({ binding, owners })) };
}

export function matchesKeybinding(binding, event) {
  if (typeof binding !== "string" || !event) return false;
  const parts = binding.split("+").filter(Boolean);
  if (parts.length === 0) return false;
  const keyToken = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((part) => part.toLowerCase());
  const wantCtrl = mods.includes("ctrl") || mods.includes("cmd");
  const wantAlt = mods.includes("alt");
  const wantShift = mods.includes("shift");
  const hasCtrl = Boolean(event.ctrlKey || event.metaKey);
  if (hasCtrl !== wantCtrl) return false;
  if (Boolean(event.altKey) !== wantAlt) return false;
  if (Boolean(event.shiftKey) !== wantShift) return false;
  const eventKey = event.key === " " ? "space" : String(event.key ?? "").toLowerCase();
  const bindingKey = keyToken === "spacebar" ? "space" : keyToken;
  return eventKey === bindingKey;
}
