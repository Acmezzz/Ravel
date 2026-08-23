export const DEFAULT_KEYBINDINGS = Object.freeze({ commandPalette: "Ctrl+K", newSession: "Ctrl+Shift+N", abort: "Escape" });

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
  };
  const conflicts = Object.entries(result).reduce((map, [key, binding]) => {
    const owners = map.get(binding) ?? [];
    owners.push(key);
    map.set(binding, owners);
    return map;
  }, new Map());
  return { ...result, conflicts: [...conflicts.entries()].filter(([, owners]) => owners.length > 1).map(([binding, owners]) => ({ binding, owners })) };
}
