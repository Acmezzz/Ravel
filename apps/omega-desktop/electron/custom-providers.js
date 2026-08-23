const API_TYPES = new Set(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);
const ID_RE = /^[a-z][a-z0-9_-]{1,63}$/;

export function validateCustomProvider(input) {
  const value = input && typeof input === "object" ? input : {};
  const id = String(value.id ?? "").trim().toLowerCase();
  const name = String(value.name ?? id).trim().slice(0, 128);
  const baseUrl = String(value.baseUrl ?? "").trim();
  if (!ID_RE.test(id)) throw Object.assign(new Error("provider id must be lowercase a-z/0-9/_/-"), { code: "invalid_args" });
  if (!name) throw Object.assign(new Error("provider name is required"), { code: "invalid_args" });
  let url;
  try { url = new URL(baseUrl); } catch { throw Object.assign(new Error("baseUrl must be a valid URL"), { code: "invalid_args" }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error("baseUrl must use http or https"), { code: "invalid_args" });
  const api = String(value.api ?? "").trim();
  if (!API_TYPES.has(api)) throw Object.assign(new Error("unsupported provider API type"), { code: "invalid_args" });
  const models = Array.isArray(value.models) ? value.models.slice(0, 200).map((model) => {
    const modelId = String(model?.id ?? "").trim().slice(0, 128);
    if (!modelId) throw Object.assign(new Error("model id is required"), { code: "invalid_args" });
    return { id: modelId, name: String(model?.name ?? modelId).slice(0, 256), reasoning: Boolean(model?.reasoning), contextWindow: Number.isInteger(model?.contextWindow) ? Math.min(2_000_000, Math.max(1_000, model.contextWindow)) : 128_000, maxTokens: Number.isInteger(model?.maxTokens) ? Math.min(200_000, Math.max(256, model.maxTokens)) : 16_384, input: Array.isArray(model?.input) && model.input.includes("image") ? ["text", "image"] : ["text"] };
  }) : [];
  const headers = value.headers && typeof value.headers === "object" ? Object.fromEntries(Object.entries(value.headers).slice(0, 32).map(([key, val]) => [String(key).slice(0, 128), String(val).slice(0, 512)])) : {};
  return { id, name, baseUrl: url.toString().replace(/\/$/, ""), api, headers, authHeader: value.authHeader !== false, models };
}
