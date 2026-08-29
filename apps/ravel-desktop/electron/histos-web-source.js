import { createHash } from "node:crypto";

/**
 * Web resource adapter — turns fetched pages into a deterministic Histos graph.
 *
 * The JSONL session log is the authority for agent activity; fetched pages are
 * the authority for what the web said. Both become nodes whose evidence points
 * at a FactAddress, so a condensation can always be traced back to the exact
 * URL and byte range it came from (spatial traceability) and to the fetch that
 * produced it (temporal traceability).
 *
 * Following the convention in mcp-service.js and resource-center.js, every pure
 * transform is exported separately from the network call so tests can exercise
 * validation and projection without touching the network.
 */

export const WEB_SOURCE_KINDS = Object.freeze(["web_resource", "web_chunk", "web_link"]);

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_TIMEOUT_MS = 120_000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_CHUNK_LENGTH = 4_096;
export const MAX_CHUNKS_PER_RESOURCE = 512;
export const MAX_TEXT_LENGTH = MAX_RESPONSE_BYTES;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const TEXTUAL_CONTENT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
  "text/csv",
]);
const MAX_URL_LENGTH = 2_048;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function invalid(message, code = "invalid_args") {
  return Object.assign(new TypeError(message), { code });
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Normalize a user-supplied URL into the stable identity used as a FactAddress
 * objectId. The fragment is dropped (it never identifies a resource) and query
 * parameters are sorted so `?b=1&a=2` and `?a=2&b=1` address the same page.
 * Returns null for anything that is not a safe, absolute http(s) URL.
 */
export function normalizeWebUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  const params = [...parsed.searchParams].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey === rightKey ? (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) : leftKey < rightKey ? -1 : 1,
  );
  const query = params.length ? `?${params.map(([key, value]) => `${key}=${value}`).join("&")}` : "";
  const path = parsed.pathname === "/" && !query ? "/" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.host.toLowerCase()}${path}${query}`;
}

export function assertWebUrl(input) {
  const normalized = normalizeWebUrl(input);
  if (normalized === null) throw invalid("url must be an absolute http(s) URL without credentials");
  return normalized;
}

/** True when the content type is something we can turn into readable text. */
export function isTextualContentType(contentType) {
  const base = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (base.length === 0) return true;
  return HTML_CONTENT_TYPES.has(base) || TEXTUAL_CONTENT_TYPES.has(base) || base.startsWith("text/");
}

/**
 * Strip markup down to readable text. This deliberately does not execute or
 * resolve anything: scripts, styles, and comments are removed wholesale and
 * links are kept only as their anchor text so no remote content is inlined.
 */
export function extractReadableText(content, contentType) {
  if (typeof content !== "string") return "";
  if (!HTML_CONTENT_TYPES.has(String(contentType ?? "").split(";")[0].trim().toLowerCase())) {
    return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  }
  let text = content;
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  text = text.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
  text = text.replace(/[ \t\f\v]+/g, " ");
  text = text.replace(/ ?\n ?/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** First `<title>` or `<h1>`, used as the node title. Never throws. */
export function extractTitle(html, fallback) {
  const patterns = [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i];
  for (const pattern of patterns) {
    const match = pattern.exec(typeof html === "string" ? html : "");
    if (match) {
      const title = extractReadableText(match[1], "text/plain").slice(0, 512);
      if (title) return title;
    }
  }
  return fallback;
}

/**
 * Split text into fixed-size chunks. Chunk boundaries are byte offsets into the
 * normalized text, which is what makes a `quotes` evidence selector able to
 * point at an exact range instead of a whole page.
 */
export function chunkText(text, chunkLength = DEFAULT_CHUNK_LENGTH) {
  const length = Number.isSafeInteger(chunkLength) && chunkLength >= 256 ? Math.min(chunkLength, MAX_RESPONSE_BYTES) : DEFAULT_CHUNK_LENGTH;
  const source = typeof text === "string" ? text : "";
  if (source.length === 0) return [];
  const chunks = [];
  for (let start = 0; start < source.length && chunks.length < MAX_CHUNKS_PER_RESOURCE; start += length) {
    chunks.push({ start, length: Math.min(length, source.length - start) });
  }
  return chunks;
}

/**
 * Node identity vs node revision.
 *
 * `nodeId` is the stable identity of a page — it never changes when the page
 * changes. `nodeRevisionId` is content addressed, so every fetch that sees
 * different bytes produces a new revision of the same node. That split is what
 * lets the index answer both "what do we know about this URL" (by nodeId) and
 * "what did it say at the time we looked" (by nodeRevisionId).
 *
 * The generic structural adapter derives the revision from the id alone, which
 * would silently overwrite a changed page; web sources must not do that.
 */
export function webNodeIds(objectId, contentSha256) {
  if (typeof objectId !== "string" || objectId.length === 0) throw invalid("objectId must be a non-empty string");
  if (typeof contentSha256 !== "string" || contentSha256.length === 0) throw invalid("contentSha256 must be a non-empty string");
  return { nodeId: `web:${objectId}`, nodeRevisionId: sha256Hex(`web-node:${objectId}:${contentSha256}`) };
}

/**
 * The FactAddress for a fetched page. objectId is the normalized URL and
 * revisionId is the SHA-256 of the exact bytes we stored, so re-fetching an
 * unchanged page is a no-op while an edited page becomes a new revision of the
 * same address.
 */
export function webResourceAddress(resource) {
  if (!resource || typeof resource !== "object") throw invalid("resource must be an object");
  const objectId = resource.objectId ?? normalizeWebUrl(resource.url);
  if (typeof objectId !== "string" || objectId.length === 0) throw invalid("resource objectId must be a normalized URL");
  const revisionId = typeof resource.contentSha256 === "string" ? resource.contentSha256 : sha256Hex(resource.text ?? "");
  return { sourceType: "web_resource", objectId, revisionId };
}

function chunkAddress(resource, chunk) {
  const base = webResourceAddress(resource);
  return { ...base, selector: { kind: "span", start: chunk.start, length: chunk.length } };
}

/**
 * Project fetched resources into a deterministic structural graph.
 *
 * Nodes: one per page (`web_resource`) plus one per content chunk
 * (`web_chunk`), chunked at the `span` granularity only — `entry` granularity
 * keeps a single node per page and is the cheaper default for large fetches.
 * Edges: `contains` from page to chunk, `links_to` between pages whose text
 * references another fetched page.
 */
export function projectWebGraph(resources, options = {}) {
  const list = Array.isArray(resources) ? resources : [resources];
  const granularity = options.granularity === "span" ? "span" : "entry";
  const chunkLength = Number.isSafeInteger(options.chunkLength) ? options.chunkLength : DEFAULT_CHUNK_LENGTH;
  const workspaceId = typeof options.workspaceId === "string" ? options.workspaceId : "workspace";
  const diagnostics = [];
  const nodes = [];
  const edges = [];
  const seen = new Map();

  const prepared = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const objectId = raw.objectId ?? normalizeWebUrl(raw.url);
    if (typeof objectId !== "string" || objectId.length === 0) {
      diagnostics.push({ code: "invalid_url", message: `skipped an unaddressable web resource: ${String(raw.url ?? "(no url)")}` });
      continue;
    }
    const text = typeof raw.text === "string" ? raw.text : "";
    const contentSha256 = typeof raw.contentSha256 === "string" ? raw.contentSha256 : sha256Hex(text);
    const resource = { ...raw, objectId, text, contentSha256 };
    if (seen.has(objectId)) {
      const previous = seen.get(objectId);
      if (previous.contentSha256 === contentSha256) continue;
      // Same URL, different bytes: keep the newer fetch as a fresh revision.
      diagnostics.push({ code: "content_changed", message: `${objectId} changed since the previous fetch` });
    }
    seen.set(objectId, resource);
    prepared.push(resource);
  }
  prepared.sort((left, right) => (left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0));

  const nodeIdByUrl = new Map();
  for (const resource of prepared) {
    const address = webResourceAddress(resource);
    const { nodeId, nodeRevisionId } = webNodeIds(resource.objectId, resource.contentSha256);
    nodeIdByUrl.set(resource.objectId, nodeId);
    nodes.push({
      id: nodeId,
      nodeId,
      nodeRevisionId,
      ...(Number.isSafeInteger(resource.fetchedAt) && resource.fetchedAt > 0 ? { createdAt: resource.fetchedAt } : {}),
      kind: "web_resource",
      title: extractTitle(resource.html ?? resource.text, resource.objectId).slice(0, 512),
      evidence: [{ address, role: "produces" }],
      metadata: {
        url: typeof resource.url === "string" ? resource.url : `https://${resource.objectId}`,
        contentType: typeof resource.contentType === "string" ? resource.contentType : "text/plain",
        status: Number.isSafeInteger(resource.status) ? resource.status : null,
        fetchedAt: Number.isSafeInteger(resource.fetchedAt) ? resource.fetchedAt : 0,
        byteLength: resource.text.length,
        contentSha256: resource.contentSha256,
      },
    });

    if (granularity !== "span" || resource.text.length === 0) continue;
    for (const chunk of chunkText(resource.text, chunkLength)) {
      const chunkNodeId = `${nodeId}/chunk:${chunk.start}`;
      const chunkNodeRevisionId = sha256Hex(`web-chunk:${resource.objectId}:${resource.contentSha256}:${chunk.start}`);
      const excerpt = resource.text.slice(chunk.start, chunk.start + chunk.length);
      nodes.push({
        id: chunkNodeId,
        nodeId: chunkNodeId,
        nodeRevisionId: chunkNodeRevisionId,
        kind: "web_chunk",
        title: excerpt.slice(0, 512),
        parentId: nodeId,
        evidence: [{ address: chunkAddress(resource, chunk), role: "quotes" }],
      });
      edges.push({
        id: `contains:${nodeId}->${chunkNodeId}`,
        edgeId: `contains:${nodeId}->${chunkNodeId}`,
        edgeRevisionId: sha256Hex(`web-contains:${resource.objectId}:${resource.contentSha256}:${chunk.start}`),
        srcNodeId: nodeId,
        dstNodeId: chunkNodeId,
        kind: "contains",
        evidence: [{ address: chunkAddress(resource, chunk), role: "supports" }],
      });
    }
  }

  // Link edges are derived only from the text we actually stored, never from a
  // second fetch, so the graph stays reproducible from its own artifacts.
  for (const resource of prepared) {
    const sourceNodeId = nodeIdByUrl.get(resource.objectId);
    const targets = new Set();
    for (const candidate of prepared) {
      if (candidate.objectId === resource.objectId) continue;
      if (resource.text.includes(candidate.objectId)) targets.add(candidate.objectId);
    }
    for (const target of [...targets].sort()) {
      const targetNodeId = nodeIdByUrl.get(target);
      edges.push({
        id: `links_to:${sourceNodeId}->${targetNodeId}`,
        edgeId: `links_to:${sourceNodeId}->${targetNodeId}`,
        edgeRevisionId: sha256Hex(`web-links:${resource.objectId}:${resource.contentSha256}:${target}`),
        kind: "links_to",
        srcNodeId: sourceNodeId,
        dstNodeId: targetNodeId,
        evidence: [{ address: webResourceAddress(resource), role: "navigates" }],
      });
    }
  }

  return {
    schemaVersion: 1,
    lens: "structural",
    granularity,
    sourceSet: { sourceTypes: ["web_resource"], urls: prepared.map((item) => item.objectId) },
    nodes,
    edges,
    diagnostics,
  };
}

/**
 * Fetch one URL. Redirects are followed manually so each hop is re-validated
 * against the http(s)-only rule instead of trusting the client's policy.
 */
export async function fetchWebResource(input) {
  if (!input || typeof input !== "object") throw invalid("fetch input must be an object");
  const objectId = assertWebUrl(input.url);
  const timeoutMs = Math.min(Number.isSafeInteger(input.timeoutMs) ? input.timeoutMs : DEFAULT_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS);
  const maxBytes = Math.min(Number.isSafeInteger(input.maxBytes) ? input.maxBytes : MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") throw invalid("no fetch implementation is available");

  let target = input.url;
  let redirectCount = 0;
  for (;;) {
    const controller = new AbortController();
    // The timeout is raced against the fetch rather than delegated to it: a
    // transport that ignores the signal would otherwise hang the caller.
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error(`fetch timed out after ${timeoutMs}ms`), { code: "fetch_timeout" }));
      }, timeoutMs);
      timer.unref?.();
    });
    let response;
    try {
      response = await Promise.race([
        fetchImpl(target, {
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "text/markdown;q=1.0, text/plain;q=0.9, text/html;q=0.8, */*;q=0.1" },
        }),
        timeout,
      ]);
    } catch (error) {
      // Our own timeout rejection already carries the right code; re-wrapping
      // it here would relabel a timeout as a transport failure.
      if (error instanceof Error && typeof error.code === "string") throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw Object.assign(new Error(`fetch timed out after ${timeoutMs}ms`), { code: "fetch_timeout" });
      }
      throw Object.assign(new Error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`), { code: "fetch_failed" });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = typeof response.headers?.get === "function" ? response.headers.get("location") : null;
      if (typeof location !== "string" || redirectCount >= MAX_REDIRECTS) {
        throw Object.assign(new Error("fetch exceeded the redirect limit"), { code: "fetch_redirect_limit" });
      }
      redirectCount += 1;
      target = new URL(location, target).href;
      if (!normalizeWebUrl(target)) throw Object.assign(new Error("fetch redirected to a non-http(s) URL"), { code: "fetch_unsafe_redirect" });
      continue;
    }

    if (!response.ok) {
      throw Object.assign(new Error(`fetch failed with status ${response.status}`), { code: "fetch_status", status: response.status });
    }
    const contentType = typeof response.headers?.get === "function" ? response.headers.get("content-type") ?? "" : "";
    if (!isTextualContentType(contentType)) {
      throw Object.assign(new Error(`unsupported content type ${contentType.split(";")[0] || "(unknown)"}`), { code: "unsupported_content_type" });
    }
    const raw = await response.text();
    if (raw.length > maxBytes) throw Object.assign(new Error(`response exceeds ${maxBytes} bytes`), { code: "fetch_too_large" });
    const html = HTML_CONTENT_TYPES.has(contentType.split(";")[0].trim().toLowerCase()) ? raw : "";
    const text = extractReadableText(raw, contentType).slice(0, MAX_TEXT_LENGTH);
    return {
      url: input.url,
      finalUrl: target,
      objectId: normalizeWebUrl(target) ?? objectId,
      status: response.status,
      contentType: contentType.split(";")[0].trim().toLowerCase() || "text/plain",
      fetchedAt: Number.isSafeInteger(input.fetchedAt) ? input.fetchedAt : Date.now(),
      html,
      text,
      byteLength: raw.length,
      contentSha256: sha256Hex(text),
    };
  }
}
