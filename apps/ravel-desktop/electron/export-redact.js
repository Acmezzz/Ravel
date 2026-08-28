/**
 * Field-level redaction pass for HTML session export (next-cycle B7).
 * Pattern ported from opencode's export.ts "[redacted:<field>]" marker style
 * (MIT).
 *
 * The redactor is conservative and shape-based: it never invents what a
 * secret is, it only replaces values whose shape is credential-like with a
 * stable `[redacted:<kind>]` marker, keeping the surrounding key/label so the
 * export stays readable. Applied to every exported text field (messages,
 * thinking, tool args/results/target) before HTML generation; the original
 * session record is untouched.
 *
 * Pure module — tests run without net or Electron.
 */

export const DEFAULT_REDACTION_RULES = Object.freeze([
  // OpenAI-style / generic "sk-" keys and GitHub / Slack / AWS token shapes.
  { kind: "api_key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "api_key", pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { kind: "api_key", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "api_key", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "api_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "api_key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi },
  // key=value / "key": "value" credential assignments (.env, JSON, flags).
  {
    kind: "secret_value",
    pattern: /((?:api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|pwd|authorization|private[_-]?key)["']?\s*(?::|=>|=)\s*["'])[^"'\n\u0000]{4,}["']/gi,
    keep: 1,
  },
  {
    kind: "secret_value",
    pattern: /((?:api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|pwd|authorization|private[_-]?key)[A-Za-z0-9_-]*\s*[=:]\s*)[^\s"'&\u0000]{4,}/gi,
    keep: 1,
  },
]);

/**
 * Rules write placeholders (NUL-delimited) instead of final markers so a
 * later rule can never re-consume an earlier marker as its "value" — e.g. the
 * key=value rule seeing `Authorization: [redacted:bearer_token]` and
 * re-redacting it as secret_value. Placeholders are restored at the end.
 */
const PLACEHOLDER_PATTERN = /\u0000([\w-]+)\u0000/g;

function markerFor(kind) {
  return `\u0000${kind}\u0000`;
}

/** Apply one pass of the rules to a single text. Order matters; later rules see earlier output. */
export function redactText(text, rules = DEFAULT_REDACTION_RULES) {
  if (typeof text !== "string" || text.length === 0) return text ?? "";
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.pattern, (_match, keepGroup) =>
      typeof rule.keep === "number" && keepGroup !== undefined ? `${keepGroup}${markerFor(rule.kind)}` : markerFor(rule.kind),
    );
  }
  return out.replace(PLACEHOLDER_PATTERN, (_, kind) => `[redacted:${kind}]`);
}

function redactUnknown(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactUnknown(item);
    return out;
  }
  return value;
}

/** Field-level redaction of one JSON payload string (tool args / results). */
export function redactJsonPayload(text) {
  if (typeof text !== "string" || text.length === 0) return text ?? "";
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(redactUnknown(parsed), null, 2);
  } catch {
    // Not JSON: fall back to a flat text pass.
    return redactText(text);
  }
}

/**
 * Return a redacted deep copy of the session record used by buildSessionHtml.
 * The input record is not mutated.
 */
export function redactSessionRecord(record) {
  const out = { ...record };
  out.title = redactText(record.title);
  out.workspace = record.workspace;
  out.updatedAt = record.updatedAt;
  out.messages = (record.messages ?? []).map((message) => ({
    ...message,
    text: redactText(message.text),
    ...(message.thinking !== undefined ? { thinking: redactText(message.thinking) } : {}),
  }));
  out.toolCards = (record.toolCards ?? []).map((card) => ({
    ...card,
    target: typeof card.target === "string" ? redactText(card.target) : card.target,
    ...(card.argsJson !== undefined ? { argsJson: redactJsonPayload(card.argsJson) } : {}),
    ...(card.resultText !== undefined ? { resultText: redactJsonPayload(card.resultText) } : {}),
  }));
  return out;
}
