/**
 * Match a sanitized shortcut such as `Ctrl+K` or `Ctrl+Shift+N` against a
 * keyboard event. Ctrl and Cmd are treated as the same modifier so Mac and
 * Windows settings stay interchangeable.
 */
export function matchesKeybinding(
  binding: string,
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
): boolean {
  if (!binding) return false;
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
  const eventKey = event.key === " " ? "space" : event.key.toLowerCase();
  const bindingKey = keyToken === "spacebar" ? "space" : keyToken;
  return eventKey === bindingKey;
}
