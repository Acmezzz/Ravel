import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import {
  addressIdForFactAddress,
  normalizeFactAddress,
} from "./histos-address.js";

/**
 * Read-only adapters for the Pi v3 session log.
 *
 * The JSONL file is the authority. This module deliberately has no session
 * writer or Electron dependency: its result is an in-memory input to
 * the Histos indexer and can always be recreated from the source files.
 */

const FACT_CUSTOM_TYPE = "ravel_record";
const FACT_TYPES = new Set([
  "operation_started",
  "operation_finished",
  "approval_asked",
  "approval_decided",
  "session_reference",
  "context_attached",
]);
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_DIAGNOSTICS = 1_000;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "invalid_args";
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw invalid(`${label} must be a non-empty string`);
  return value;
}

function boundedOption(value, label, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw invalid(`${label} must be a safe integer between 1 and ${maximum}`);
  return value;
}

function diagnostic(diagnostics, line, code, message) {
  if (diagnostics.length >= DEFAULT_MAX_DIAGNOSTICS) return;
  diagnostics.push({ line, code, message });
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sessionEntryAddress(sessionId, entryId) {
  return normalizeFactAddress({
    sourceType: "session_entry",
    objectId: `${sessionId}/${entryId}`,
    revisionId: entryId,
  });
}

function addressRef(address) {
  const normalized = normalizeFactAddress(address);
  return { address: normalized, addressId: addressIdForFactAddress(normalized) };
}

function specializedFactAddress(sessionId, factType, fact, outerEntryId, workspaceId) {
  if (factType === "operation_started") {
    return addressRef({ sourceType: "operation", objectId: `${sessionId}/${fact.id}`, revisionId: outerEntryId });
  }
  if (factType === "operation_finished") {
    return addressRef({ sourceType: "operation", objectId: `${sessionId}/${fact.runId}`, revisionId: outerEntryId });
  }
  if (factType === "approval_asked") {
    return addressRef({ sourceType: "approval", objectId: `${sessionId}/${fact.id}`, revisionId: outerEntryId });
  }
  if (factType === "approval_decided") {
    return addressRef({ sourceType: "approval", objectId: `${sessionId}/${fact.askedId}`, revisionId: outerEntryId });
  }
  if (factType === "context_attached") {
    const contextSha = fact.contextSha;
    if (!/^[0-9a-f]{64}$/.test(contextSha)) return null;
    return addressRef({
      sourceType: "context_set",
      objectId: workspaceId ?? sessionId,
      revisionId: contextSha,
    });
  }
  return null;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("");
}

function toolCallsFromMessage(message) {
  if (!isPlainObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.filter((part) => part && typeof part === "object" && part.type === "toolCall");
}

function normalizeFact(entry, sessionId, workspaceId, line, diagnostics) {
  if (entry.type !== "custom" || entry.customType !== FACT_CUSTOM_TYPE || !isPlainObject(entry.data)) return null;
  const fact = entry.data;
  if (!FACT_TYPES.has(fact.type)) return null;
  const outerEntryId = typeof entry.id === "string" ? entry.id : `line-${line}`;
  let entryAddress = null;
  let address = null;
  try {
    if (typeof entry.id === "string") entryAddress = addressRef(sessionEntryAddress(sessionId, entry.id));
    address = specializedFactAddress(sessionId, fact.type, fact, outerEntryId, workspaceId);
  } catch {
    diagnostic(diagnostics, line, "invalid_fact_address", `Unable to address ${fact.type}`);
  }
  if (fact.type === "context_attached" && !address) {
    diagnostic(diagnostics, line, "invalid_context_sha", "context_attached requires a lowercase SHA-256 contextSha");
  }
  return {
    line,
    entryId: typeof entry.id === "string" ? entry.id : null,
    fact: clone(fact),
    record: clone(fact),
    entryAddress,
    entryAddressId: entryAddress?.addressId ?? null,
    address: address?.address ?? null,
    addressId: address?.addressId ?? null,
  };
}

function addTool(toolsById, toolCall, sessionId, entry, line, diagnostics) {
  const toolCallId = typeof toolCall.id === "string" && toolCall.id.length > 0 ? toolCall.id : null;
  if (!toolCallId) {
    diagnostic(diagnostics, line, "invalid_tool_call", "assistant toolCall is missing id");
    return null;
  }
  const existing = toolsById.get(toolCallId);
  if (existing) return existing;
  let address = null;
  try {
    address = addressRef({
      sourceType: "tool",
      objectId: `${sessionId}/${toolCallId}`,
      revisionId: entry.id,
    });
  } catch {
    diagnostic(diagnostics, line, "invalid_tool_address", "Unable to address toolCall");
  }
  const tool = {
    toolCallId,
    toolName: typeof toolCall.name === "string" ? toolCall.name : "unknown",
    assistantEntryId: entry.id,
    line,
    arguments: clone(toolCall.arguments ?? {}),
    resultEntryId: null,
    result: null,
    entryAddress: addressRef(sessionEntryAddress(sessionId, entry.id)).address,
    entryAddressId: addressRef(sessionEntryAddress(sessionId, entry.id)).addressId,
    address: address?.address ?? null,
    addressId: address?.addressId ?? null,
  };
  toolsById.set(toolCallId, tool);
  return tool;
}

function finishTool(tool, entry, line) {
  if (!tool || tool.resultEntryId) return;
  const message = entry.message;
  tool.resultEntryId = entry.id;
  tool.result = {
    text: textFromContent(message.content),
    isError: message.isError === true,
    line,
  };
}

function parseSessionText(text, filePath, options) {
  const diagnostics = [];
  const entries = [];
  const messages = [];
  const facts = [];
  const toolsById = new Map();
  let header = null;
  let line = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    line += 1;
    if (!rawLine.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      diagnostic(diagnostics, line, "invalid_json", "Line is not valid JSON");
      continue;
    }
    if (!isPlainObject(parsed)) {
      diagnostic(diagnostics, line, "invalid_entry", "Line must contain a JSON object");
      continue;
    }
    if (!header) {
      if (parsed.type !== "session" || typeof parsed.id !== "string" || typeof parsed.cwd !== "string") {
        diagnostic(diagnostics, line, "missing_session_header", "The first entry must be a Pi session header");
        continue;
      }
      header = clone(parsed);
      if (parsed.version !== undefined && parsed.version !== 3) {
        diagnostic(diagnostics, line, "unsupported_session_version", "Expected Pi session format version 3");
      }
      continue;
    }
    if (typeof parsed.type !== "string") {
      diagnostic(diagnostics, line, "invalid_entry", "Session entry type is missing");
      continue;
    }
    if (parsed.type === "session") {
      diagnostic(diagnostics, line, "duplicate_session_header", "Only the first line may be a session header");
      continue;
    }
    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
      diagnostic(diagnostics, line, "invalid_entry_id", "Session entry id is missing");
      continue;
    }
    const entry = { line, value: clone(parsed), ...clone(parsed) };
    entries.push(entry);
    if (parsed.type === "message" && isPlainObject(parsed.message)) {
      const message = {
        entryId: parsed.id,
        line,
        role: typeof parsed.message.role === "string" ? parsed.message.role : "unknown",
        text: textFromContent(parsed.message.content),
        entryAddress: addressRef(sessionEntryAddress(header.id, parsed.id)).address,
        entryAddressId: addressRef(sessionEntryAddress(header.id, parsed.id)).addressId,
      };
      messages.push(message);
      for (const toolCall of toolCallsFromMessage(parsed.message)) addTool(toolsById, toolCall, header.id, parsed, line, diagnostics);
      if (parsed.message.role === "toolResult" && typeof parsed.message.toolCallId === "string") {
        finishTool(toolsById.get(parsed.message.toolCallId), parsed, line);
      }
    }
    const fact = normalizeFact(parsed, header.id, options.workspaceId, line, diagnostics);
    if (fact) facts.push(fact);
  }
  if (!header) {
    diagnostic(diagnostics, 1, "missing_session_header", "Session file has no valid Pi session header");
  }
  const sessionId = header?.id ?? null;
  const tools = [...toolsById.values()].sort((left, right) => left.toolCallId.localeCompare(right.toolCallId));
  const session = {
    filePath,
    sessionId,
    workspaceId: options.workspaceId ?? header?.cwd ?? null,
    header,
    entries,
    messages,
    facts,
    tools,
    operations: facts.filter((item) => item.fact.type === "operation_started" || item.fact.type === "operation_finished"),
    approvals: facts.filter((item) => item.fact.type === "approval_asked" || item.fact.type === "approval_decided"),
    references: facts.filter((item) => item.fact.type === "session_reference"),
    contexts: facts.filter((item) => item.fact.type === "context_attached"),
    diagnostics,
  };
  return session;
}

function scanOptions(options) {
  if (options === undefined) return {};
  if (!isPlainObject(options)) throw invalid("scan options must be an object");
  return options;
}

/** Scan one Pi v3 JSONL file without opening a writer or changing the file. */
export async function scanSessionFile(filePath, options) {
  const normalizedOptions = scanOptions(options);
  const resolved = resolve(requireString(filePath, "filePath"));
  const text = await readFile(resolved, "utf8");
  return parseSessionText(text, resolved, normalizedOptions);
}

async function sessionFiles(root, maxFiles) {
  const files = [];
  const queue = [resolve(root)];
  while (queue.length > 0 && files.length < maxFiles) {
    const directory = queue.shift();
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    items.sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const path = join(directory, item.name);
      if (item.isDirectory()) queue.push(path);
      else if (item.isFile() && extname(item.name).toLowerCase() === ".jsonl") files.push(path);
      if (files.length >= maxFiles) break;
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** Scan all JSONL sessions below a Pi session/workspace root in path order. */
export async function scanWorkspaceSessions(root, options) {
  const normalizedOptions = scanOptions(options);
  const resolvedRoot = resolve(requireString(root, "root"));
  const maxFiles = boundedOption(normalizedOptions.maxFiles, "maxFiles", DEFAULT_MAX_FILES, 100_000);
  const files = await sessionFiles(resolvedRoot, maxFiles);
  const sessions = [];
  for (const file of files) {
    try {
      const session = await scanSessionFile(file, normalizedOptions);
      if (session.sessionId) sessions.push(session);
    } catch (error) {
      sessions.push({
        filePath: file,
        sessionId: null,
        workspaceId: normalizedOptions.workspaceId ?? null,
        header: null,
        entries: [],
        messages: [],
        facts: [],
        tools: [],
        operations: [],
        approvals: [],
        references: [],
        contexts: [],
        diagnostics: [{ line: 0, code: error?.code ?? "read_error", message: error?.message ?? "Unable to read session file" }],
      });
    }
  }
  return sessions;
}

function graphInput(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray(value.sessions)) return value.sessions;
  if (isPlainObject(value) && typeof value.sessionId === "string") return [value];
  throw invalid("graph input must be a session scan or an array of scans");
}

function nodeAddress(node) {
  if (!node.address) return null;
  return { address: node.address, addressId: node.addressId };
}

function addEvidence(target, address, role) {
  if (!address) return;
  const key = `${address.addressId}:${role}`;
  if (target.some((item) => `${item.addressId}:${item.role}` === key)) return;
  target.push({ address: address.address, addressId: address.addressId, role });
}

function makeNode(id, kind, title, address, data, parentId) {
  const evidence = [];
  addEvidence(evidence, address, "supports");
  return {
    id,
    kind,
    title,
    ...(nodeAddress({ address: address?.address ?? null, addressId: address?.addressId ?? null }) ?? {}),
    evidence,
    ...(data === undefined ? {} : { data }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function edgeId(kind, source, target, discriminator = "") {
  return `${kind}:${source}->${target}${discriminator ? `:${discriminator}` : ""}`;
}

function addEdge(edges, kind, source, target, address, data) {
  const id = edgeId(kind, source, target, address?.addressId ?? "");
  if (edges.some((edge) => edge.id === id)) return;
  const evidence = [];
  addEvidence(evidence, address, "supports");
  edges.push({
    id,
    kind,
    srcNodeId: source,
    dstNodeId: target,
    ...(nodeAddress({ address: address?.address ?? null, addressId: address?.addressId ?? null }) ?? {}),
    evidence,
    ...(data === undefined ? {} : { data }),
  });
}

function projectOneSession(scan, nodes, edges, evidence) {
  if (!scan || typeof scan.sessionId !== "string") return;
  const sessionNodeId = `session:${scan.sessionId}`;
  let headerAddress = null;
  try {
    headerAddress = addressRef(sessionEntryAddress(scan.sessionId, "header"));
  } catch {
    /* A malformed scan is still represented by its identity node. */
  }
  if (!nodes.has(sessionNodeId)) nodes.set(sessionNodeId, makeNode(sessionNodeId, "entry", scan.header?.cwd ?? scan.sessionId, headerAddress, { sessionId: scan.sessionId }));
  for (const entry of scan.entries ?? []) {
    const entryNodeId = `entry:${scan.sessionId}/${entry.id}`;
    let address = null;
    try {
      address = addressRef(sessionEntryAddress(scan.sessionId, entry.id));
    } catch {
      continue;
    }
    if (!nodes.has(entryNodeId)) {
      const title = entry.type === "message" ? entry.message?.role ?? "message" : entry.customType ?? entry.type;
      nodes.set(entryNodeId, makeNode(entryNodeId, "entry", title, address, { sessionId: scan.sessionId, entryId: entry.id, type: entry.type }, typeof entry.parentId === "string" ? `entry:${scan.sessionId}/${entry.parentId}` : undefined));
    }
    if (typeof entry.parentId === "string") {
      const parentNodeId = `entry:${scan.sessionId}/${entry.parentId}`;
      addEdge(edges, "contains", parentNodeId, entryNodeId, address);
    } else {
      addEdge(edges, "contains", sessionNodeId, entryNodeId, address);
    }
  }

  const operationNodes = new Map();
  const approvalNodes = new Map();
  const toolNodes = new Map();
  const activeOperations = [];
  const factEntries = [...(scan.facts ?? [])].sort((left, right) => left.line - right.line);
  for (const factItem of factEntries) {
    const fact = factItem.fact;
    const specialized = factItem.address ? { address: factItem.address, addressId: factItem.addressId } : null;
    const entryAddress = factItem.entryAddress ? { address: factItem.entryAddress, addressId: factItem.entryAddressId } : null;
    if (fact.type === "operation_started") {
      const id = fact.id;
      const nodeId = `operation:${scan.sessionId}/${id}`;
      let node = operationNodes.get(id);
      if (!node) {
        node = makeNode(nodeId, "operation", fact.intent?.kind ?? "run", specialized, { operationId: id, status: "open", intent: clone(fact.intent) });
        operationNodes.set(id, node);
        nodes.set(nodeId, node);
        addEdge(edges, "contains", sessionNodeId, nodeId, entryAddress);
      }
      addEvidence(node.evidence, specialized, "supports");
      activeOperations.push(id);
    } else if (fact.type === "operation_finished") {
      const id = fact.runId;
      const nodeId = `operation:${scan.sessionId}/${id}`;
      let node = operationNodes.get(id);
      if (!node) {
        node = makeNode(nodeId, "operation", "run", specialized, { operationId: id, status: fact.outcome });
        operationNodes.set(id, node);
        nodes.set(nodeId, node);
        addEdge(edges, "contains", sessionNodeId, nodeId, entryAddress);
      }
      node.data.status = fact.outcome;
      addEvidence(node.evidence, specialized, "supports");
      const index = activeOperations.lastIndexOf(id);
      if (index >= 0) activeOperations.splice(index, 1);
    } else if (fact.type === "approval_asked" || fact.type === "approval_decided") {
      const id = fact.type === "approval_asked" ? fact.id : fact.askedId;
      const nodeId = `approval:${scan.sessionId}/${id}`;
      let node = approvalNodes.get(id);
      if (!node) {
        node = makeNode(nodeId, "approval", fact.type === "approval_asked" ? "pending" : fact.outcome ?? "approval", specialized, { askedId: id, outcome: fact.type === "approval_asked" ? null : fact.outcome, toolCallId: fact.toolCallId });
        approvalNodes.set(id, node);
        nodes.set(nodeId, node);
      }
      if (fact.type === "approval_asked") {
        node.data.toolCallId = fact.toolCallId;
        node.data.toolName = fact.toolName;
      } else {
        node.data.outcome = fact.outcome;
        node.title = fact.outcome;
      }
      addEvidence(node.evidence, specialized, "supports");
      const toolNodeId = `tool:${scan.sessionId}/${fact.toolCallId}`;
      addEdge(edges, "approved", nodeId, toolNodeId, entryAddress);
    } else if (fact.type === "session_reference") {
      const sourceNodeId = `entry:${scan.sessionId}/${fact.sourceEntryId}`;
      const targetNodeId = `session:${fact.targetSessionId}`;
      if (!nodes.has(targetNodeId)) nodes.set(targetNodeId, makeNode(targetNodeId, "entry", fact.targetTitle, null, { sessionId: fact.targetSessionId }));
      addEdge(edges, "session_ref", sourceNodeId, targetNodeId, entryAddress, { targetSessionId: fact.targetSessionId, targetTitle: fact.targetTitle });
    } else if (fact.type === "context_attached") {
      const contextNodeId = `context:${fact.contextSha}`;
      if (!nodes.has(contextNodeId)) nodes.set(contextNodeId, makeNode(contextNodeId, "cluster", fact.contextSha, specialized, { contextSha: fact.contextSha }));
      addEvidence(nodes.get(contextNodeId).evidence, specialized, "supports");
      const targetNodeId = `session:${fact.targetSessionId}`;
      if (!nodes.has(targetNodeId)) nodes.set(targetNodeId, makeNode(targetNodeId, "entry", fact.targetSessionId, null, { sessionId: fact.targetSessionId }));
      addEdge(edges, "context", sessionNodeId, contextNodeId, entryAddress, { contextSha: fact.contextSha });
      addEdge(edges, "context", contextNodeId, targetNodeId, specialized, { targetSessionId: fact.targetSessionId });
    }
  }

  for (const tool of scan.tools ?? []) {
    const toolNodeId = `tool:${scan.sessionId}/${tool.toolCallId}`;
    let node = toolNodes.get(tool.toolCallId);
    if (!node) {
      const address = tool.address ? { address: tool.address, addressId: tool.addressId } : null;
      node = makeNode(toolNodeId, "tool", tool.toolName, address, {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        assistantEntryId: tool.assistantEntryId,
        resultEntryId: tool.resultEntryId,
        isError: tool.result?.isError ?? null,
      });
      toolNodes.set(tool.toolCallId, node);
      nodes.set(toolNodeId, node);
    }
    const assistantNodeId = `entry:${scan.sessionId}/${tool.assistantEntryId}`;
    addEdge(edges, "contains", assistantNodeId, toolNodeId, { address: tool.entryAddress, addressId: tool.entryAddressId });
    if (tool.resultEntryId) addEdge(edges, "produced", toolNodeId, `entry:${scan.sessionId}/${tool.resultEntryId}`, null);
    const operationId = activeOperationForTool(factEntries, tool);
    if (operationId) addEdge(edges, "contains", `operation:${scan.sessionId}/${operationId}`, toolNodeId, null);
  }

  for (const node of nodes.values()) {
    for (const item of node.evidence ?? []) evidence.push({ revisionId: node.id, addressId: item.addressId, address: item.address, role: item.role });
  }
  for (const edge of edges) {
    for (const item of edge.evidence ?? []) evidence.push({ revisionId: edge.id, addressId: item.addressId, address: item.address, role: item.role });
  }

  function activeOperationForTool(factsForSession, tool) {
    let current = null;
    for (const item of factsForSession) {
      if (item.line > tool.line) break;
      if (item.fact.type === "operation_started") current = item.fact.id;
      else if (item.fact.type === "operation_finished" && item.fact.runId === current) current = null;
    }
    return current;
  }
}

/**
 * Project one or more scans into a deterministic structural graph. No semantic
 * inference is performed: every edge is backed by a JSONL entry address.
 */
export function projectStructuralGraph(input, options) {
  const normalizedOptions = scanOptions(options);
  const scans = graphInput(input).filter((scan) => scan && typeof scan.sessionId === "string").slice().sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const nodes = new Map();
  const edges = [];
  const evidence = [];
  for (const scan of scans) projectOneSession(scan, nodes, edges, evidence);
  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  for (const node of sortedNodes) {
    node.evidence.sort((left, right) => `${left.addressId}:${left.role}`.localeCompare(`${right.addressId}:${right.role}`));
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));
  for (const edge of edges) edge.evidence.sort((left, right) => `${left.addressId}:${left.role}`.localeCompare(`${right.addressId}:${right.role}`));
  const sourceSet = { sessionIds: scans.map((scan) => scan.sessionId) };
  const graph = {
    schemaVersion: 1,
    lens: "structural",
    granularity: normalizedOptions.granularity ?? "entry",
    sourceSet,
    nodes: sortedNodes,
    edges,
    evidence: evidence.sort((left, right) => `${left.revisionId}:${left.addressId}:${left.role}`.localeCompare(`${right.revisionId}:${right.addressId}:${right.role}`)),
    diagnostics: scans.flatMap((scan) => (scan.diagnostics ?? []).map((item) => ({ ...item, filePath: scan.filePath }))),
  };
  return graph;
}

// Kept as a named export for callers that need to construct addresses while
// interpreting a scan, without depending on the internal helper names.
export { sessionEntryAddress };

/**
 * Project MCP server configurations into mcp_config nodes (P1).
 *
 * The canvas already knows the `mcp_config` node kind; this adapter is what
 * actually produces those nodes. Each server becomes one node addressed to
 * the configuration file (`sourceType: "mcp_config"`), with a content
 * addressed revision id so changing the config (command/url/args/enabled)
 * appends a revision instead of overwriting history - the same
 * contentSha256 + revision-chain contract the web source uses.
 */
export function projectMcpConfigGraph(configs) {
  const nodes = [];
  const edges = [];
  if (!Array.isArray(configs)) return { nodes, edges, diagnostics: [] };
  for (const config of configs) {
    if (!isPlainObject(config) || typeof config.name !== "string" || config.name.length === 0 || config.name.length > 256) continue;
    const content = JSON.stringify({
      name: config.name,
      command: typeof config.command === "string" ? config.command : null,
      url: typeof config.url === "string" ? config.url : null,
      args: Array.isArray(config.args) ? config.args.slice(0, 64) : [],
      enabled: config.enabled !== false,
      project: config.project === true,
    });
    const contentSha256 = createHash("sha256").update(content, "utf8").digest("hex");
    const nodeId = `mcp:${config.name}`;
    const nodeRevisionId = createHash("sha256").update(`mcp-node:${config.name}:${contentSha256}`, "utf8").digest("hex");
    nodes.push({
      id: nodeId,
      nodeId,
      nodeRevisionId,
      kind: "mcp_config",
      title: config.name,
      createdAt: Date.now(),
      evidence: [{ role: "source", address: { sourceType: "mcp_config", objectId: nodeId, revisionId: contentSha256 } }],
      metadata: { transport: typeof config.url === "string" ? "http" : "stdio", enabled: config.enabled !== false },
    });
  }
  return { nodes, edges, diagnostics: [] };
}

