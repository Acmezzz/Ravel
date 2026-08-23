export const EXTENSION_UI_METHODS = Object.freeze([
  "select",
  "confirm",
  "input",
  "editor",
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

const MAX_ID_CHARS = 128;
const MAX_TEXT_CHARS = 32_000;
const MAX_OPTIONS = 200;
const MAX_OPTION_CHARS = 2_000;

export function isExtensionUIRequest(value) {
  if (!value || typeof value !== "object") return false;
  if (value.type !== "extension_ui_request") return false;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > MAX_ID_CHARS) return false;
  if (!EXTENSION_UI_METHODS.includes(value.method)) return false;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return false;
  if (!Number.isInteger(value.generation) || value.generation < 0) return false;
  if (value.runId !== null && value.runId !== undefined && typeof value.runId !== "string") return false;

  switch (value.method) {
    case "select":
      return typeof value.title === "string" && value.title.length <= MAX_TEXT_CHARS
        && Array.isArray(value.options) && value.options.length <= MAX_OPTIONS
        && value.options.every((item) => typeof item === "string" && item.length <= MAX_OPTION_CHARS);
    case "confirm":
      return typeof value.title === "string" && value.title.length <= MAX_TEXT_CHARS
        && typeof value.message === "string" && value.message.length <= MAX_TEXT_CHARS;
    case "input":
      return typeof value.title === "string" && value.title.length <= MAX_TEXT_CHARS
        && (value.placeholder === undefined || (typeof value.placeholder === "string" && value.placeholder.length <= MAX_TEXT_CHARS));
    case "editor":
      return typeof value.title === "string" && value.title.length <= MAX_TEXT_CHARS
        && (value.prefill === undefined || (typeof value.prefill === "string" && value.prefill.length <= MAX_TEXT_CHARS));
    case "notify":
      return typeof value.message === "string" && value.message.length <= MAX_TEXT_CHARS
        && (value.notifyType === undefined || ["info", "warning", "error"].includes(value.notifyType));
    case "setStatus":
      return typeof value.statusKey === "string" && value.statusKey.length <= 256
        && (value.statusText === undefined || (typeof value.statusText === "string" && value.statusText.length <= MAX_TEXT_CHARS));
    case "setWidget":
      return typeof value.widgetKey === "string" && value.widgetKey.length <= 256
        && (value.widgetLines === undefined || (Array.isArray(value.widgetLines) && value.widgetLines.length <= 200 && value.widgetLines.every((line) => typeof line === "string" && line.length <= 4_000)))
        && (value.widgetPlacement === undefined || ["aboveEditor", "belowEditor"].includes(value.widgetPlacement));
    case "setTitle":
      return typeof value.title === "string" && value.title.length <= 256;
    case "set_editor_text":
      return typeof value.text === "string" && value.text.length <= MAX_TEXT_CHARS;
    default:
      return false;
  }
}

export function isExtensionUIResponse(value) {
  if (!value || typeof value !== "object") return false;
  if (value.type !== "extension_ui_response") return false;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > MAX_ID_CHARS) return false;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return false;
  if (!Number.isInteger(value.generation) || value.generation < 0) return false;
  if (value.runId !== null && value.runId !== undefined && typeof value.runId !== "string") return false;
  if (value.cancelled === true) return true;
  if (typeof value.value === "string" && value.value.length <= MAX_TEXT_CHARS) return true;
  return typeof value.confirmed === "boolean";
}
