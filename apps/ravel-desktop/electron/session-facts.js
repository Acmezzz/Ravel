/**
 * Durable agent facts — operation and approval records persisted inside the
 * Pi session JSONL as custom entries (append-only, single-writer through the
 * session's own persistence path, never sent to the model as chat content).
 *
 * This module is the ONLY writer of facts. Records use the shared LaneRecord
 * vocabulary from packages/agent so reducer semantics apply verbatim; `seq`
 * is omitted because the Pi v3 JSONL assigns identity/order via its own
 * entry id chain and timestamps.
 */
import { createHash, randomUUID } from "node:crypto";

export const FACT_CUSTOM_TYPE = "ravel_record";

const FACT_TYPES = new Set(["operation_started", "operation_finished", "approval_asked", "approval_decided", "session_reference", "context_attached"]);
const factsAppendedListeners = new WeakMap();

export function setFactsAppendedListener(sessionManager, listener) {
	if (!sessionManager || typeof sessionManager !== "object") throw new TypeError("sessionManager is required");
	if (listener !== undefined && typeof listener !== "function") throw new TypeError("listener must be a function");
	if (listener) factsAppendedListeners.set(sessionManager, listener);
	else factsAppendedListeners.delete(sessionManager);
	return () => factsAppendedListeners.delete(sessionManager);
}

/** Delimiters for the model-visible block that resolves @session mentions. */
export const SESSION_REFERENCE_BEGIN = "===== BEGIN RAVEL SESSION REFERENCES =====";
export const SESSION_REFERENCE_END = "===== END RAVEL SESSION REFERENCES =====";

export const APPROVAL_OUTCOMES = Object.freeze(["allowed-once", "rejected", "cancelled", "unavailable"]);
export const APPROVAL_REASON_CODES = Object.freeze(["user-allowed", "user-denied", "ui-cancelled", "timeout", "no-answerer", "rule-allowed", "rule-denied"]);
const OPERATION_OUTCOMES = new Set(["completed", "aborted", "failed", "declined"]);

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(record, field) {
	const value = record[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid ${record.type} fact: ${field} must be a non-empty string`);
	}
	return value;
}

/** Optional explainability fields: absent on legacy records, validated when present. */
function requireOptionalString(record, field) {
	if (record[field] === undefined) return;
	requireString(record, field);
}

/** Stable JSON with sorted object keys so digests do not depend on key order. */
function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Order-insensitive digest of effective tool arguments; raw args are never copied. */
export function argsDigestOf(args) {
	return `sha256:${createHash("sha256").update(stableStringify(args ?? null)).digest("hex").slice(0, 32)}`;
}

/** Validate the shared record shape, then append durably. Throws before writing. */
export function appendFact(sessionManager, record) {
	if (!record || typeof record !== "object" || !FACT_TYPES.has(record.type)) {
		throw new Error(`Unknown fact type: ${record && record.type}`);
	}
	requireString(record, "id");
	requireString(record, "lane");
	switch (record.type) {
		case "operation_started": {
			if (record.flowSha !== undefined && (typeof record.flowSha !== "string" || !/^[0-9a-f]{64}$/.test(record.flowSha))) {
				throw new Error("Invalid operation_started fact: flowSha must be a lowercase SHA-256 hex string");
			}
			if (record.sourceLeafId !== null && typeof record.sourceLeafId !== "string") {
				throw new Error("Invalid operation_started fact: sourceLeafId must be a string or null");
			}
			const intent = record.intent;
			if (!intent || typeof intent !== "object") throw new Error("Invalid operation_started fact: intent missing");
			if (intent.kind === "run") {
				if (!Array.isArray(intent.originalPrompt) || !Array.isArray(intent.initialMessages)) {
					throw new Error("Invalid operation_started fact: run intent arrays missing");
				}
			} else if (intent.kind === "compaction") {
				requireString(intent, "resultEntryId");
			} else if (intent.kind === "navigation") {
				if (intent.targetId !== null && typeof intent.targetId !== "string") {
					throw new Error("Invalid operation_started fact: navigation targetId must be a string or null");
				}
				if (typeof intent.summarize !== "boolean") {
					throw new Error("Invalid operation_started fact: navigation summarize must be a boolean");
				}
				requireOptionalString(intent, "label");
			} else {
				throw new Error(`Invalid operation_started fact: unsupported intent kind ${intent.kind}`);
			}
			break;
		}
		case "operation_finished": {
			requireString(record, "runId");
			if (!OPERATION_OUTCOMES.has(record.outcome)) {
				throw new Error(`Invalid operation_finished fact: outcome ${JSON.stringify(record.outcome)}`);
			}
			// RefinementEdit hooks: an operation may carry a snapshot of what
			// it produced and what it applied so that the Histos surface can
			// roll back / diff without a second channel. Both fields are
			// optional so existing call sites are unaffected.
			if (record.previousStateRef !== undefined) {
				if (!isObject(record.previousStateRef) || typeof record.previousStateRef.id !== "string") {
					throw new Error("Invalid operation_finished fact: previousStateRef must be an object with an id string");
				}
			}
			if (record.appliedEdits !== undefined) {
				if (!Array.isArray(record.appliedEdits) || record.appliedEdits.length > 256) {
					throw new Error("Invalid operation_finished fact: appliedEdits must be an array of at most 256 entries");
				}
				for (const edit of record.appliedEdits) {
					if (!isObject(edit) || typeof edit.action !== "string" || !["create", "update", "delete"].includes(edit.action)) {
						throw new Error("Invalid operation_finished fact: each appliedEdits entry must be an object with action in {create, update, delete}");
					}
				}
			}
			break;
		}
		case "approval_asked":
			for (const field of ["runId", "toolCallId", "toolName", "argsDigest"]) requireString(record, field);
			requireOptionalString(record, "policyProfile");
			requireOptionalString(record, "ruleSource");
			break;
		case "approval_decided": {
			for (const field of ["runId", "toolCallId", "askedId"]) requireString(record, field);
			requireOptionalString(record, "policyProfile");
			requireOptionalString(record, "uiRequestId");
			requireOptionalString(record, "ruleSource");
			if (!APPROVAL_OUTCOMES.includes(record.outcome)) {
				throw new Error(`Invalid approval_decided fact: outcome ${JSON.stringify(record.outcome)}`);
			}
			if (record.reasonCode !== undefined && !APPROVAL_REASON_CODES.includes(record.reasonCode)) {
				throw new Error(`Invalid approval_decided fact: reasonCode ${JSON.stringify(record.reasonCode)}`);
			}
			break;
		}
		case "session_reference":
			for (const field of ["sourceEntryId", "clientMessageId", "targetSessionId", "targetTitle"]) requireString(record, field);
			break;
		case "context_attached": {
			requireString(record, "targetSessionId");
			const contextSha = requireString(record, "contextSha");
			if (!/^[0-9a-f]{64}$/.test(contextSha)) throw new Error("Invalid context_attached fact: contextSha must be a SHA-256 hex string");
			break;
		}
	}
	const appended = sessionManager.appendCustomEntry(FACT_CUSTOM_TYPE, record);
	try {
		const listener = factsAppendedListeners.get(sessionManager);
		listener?.({ entryId: typeof appended === "string" ? appended : appended?.id ?? appended?.entryId ?? null, fact: { ...record } });
	} catch {
		/* Fact notifications are diagnostic only and never affect persistence. */
	}
	return appended;
}

/** All durable facts of a session, oldest first (file order). */
export function readFacts(sessionManager) {
	const facts = [];
	for (const entry of sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === FACT_CUSTOM_TYPE && entry.data && FACT_TYPES.has(entry.data.type)) {
			facts.push(entry.data);
		}
	}
	return facts;
}

/** Asks that never received a decision: crash, worker death, window close. */
export function pendingApprovalAsks(facts) {
	const decided = new Set(
		facts.filter((fact) => fact.type === "approval_decided").map((fact) => fact.askedId),
	);
	return facts.filter((fact) => fact.type === "approval_asked" && !decided.has(fact.id));
}

export function unavailableDecisionFor(ask) {
	return {
		type: "approval_decided",
		id: randomUUID(),
		lane: ask.lane,
		runId: ask.runId,
		toolCallId: ask.toolCallId,
		askedId: ask.id,
		outcome: "unavailable",
		reasonCode: "no-answerer",
		timestamp: Date.now(),
	};
}

/**
 * Close every undecided approval ask as `unavailable`. Fail-closed already
 * holds while an ask is undecided; this makes the fact explicit and prevents
 * late answers from being trusted after recovery.
 */
export function closeStaleApprovals(sessionManager) {
	let closed = 0;
	for (const ask of pendingApprovalAsks(readFacts(sessionManager))) {
		appendFact(sessionManager, unavailableDecisionFor(ask));
		closed += 1;
	}
	return closed;
}

/** Started operations without a finished record: crash or worker death mid-run. */
export function pendingOperations(facts) {
	const finished = new Set(
		facts.filter((fact) => fact.type === "operation_finished").map((fact) => fact.runId),
	);
	return facts.filter((fact) => fact.type === "operation_started" && !finished.has(fact.id));
}

/**
 * A recovered open operation is never silently resumed; it is terminalized as
 * `failed` so the timeline closes deterministically and cannot dangle forever.
 */
export function unfinishedFinishFor(operation) {
	return {
		type: "operation_finished",
		id: `finish-${operation.id}`,
		lane: operation.lane,
		runId: operation.id,
		outcome: "failed",
		error: { code: "worker_recovered_unfinished", message: "Worker 在运行中中断，恢复时将该操作标记为失败" },
		timestamp: Date.now(),
	};
}

/** Terminalize every open operation left behind by a previous worker's death. Idempotent. */
export function closeStaleOperations(sessionManager) {
	let closed = 0;
	for (const operation of pendingOperations(readFacts(sessionManager))) {
		appendFact(sessionManager, unfinishedFinishFor(operation));
		closed += 1;
	}
	return closed;
}

/**
 * Derive the 动态 view row from durable facts alone — the restart path when no
 * live worker state exists for a session. Same semantics as the live tracker:
 * waiting beats running, an open run is running, the last terminal outcome
 * decides failed/done.
 */
export function deriveActivityFromFacts(facts) {
	if (!Array.isArray(facts) || facts.length === 0) return null;
	const finishedRunIds = new Set(facts.filter((fact) => fact.type === "operation_finished").map((fact) => fact.runId));
	const decidedAskIds = new Set(facts.filter((fact) => fact.type === "approval_decided").map((fact) => fact.askedId));
	const openRun = facts.find((fact) => fact.type === "operation_started" && fact.intent?.kind === "run" && !finishedRunIds.has(fact.id));
	const pendingAsks = facts.filter((fact) => fact.type === "approval_asked" && !decidedAskIds.has(fact.id));
	const finishRecords = facts.filter((fact) => fact.type === "operation_finished" && typeof fact.timestamp === "number");
	const lastFinish = finishRecords.length > 0 ? finishRecords.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
	if (!openRun && pendingAsks.length === 0 && !lastFinish) return null;
	const status = pendingAsks.length > 0 ? "waiting" : openRun ? "running" : lastFinish && lastFinish.outcome !== "completed" ? "failed" : "done";
	return {
		status,
		pendingApprovals: pendingAsks.length,
		lastError: lastFinish?.error?.message ?? null,
		lastOutcome: lastFinish?.outcome ?? null,
		updatedAt: new Date(lastFinish?.timestamp ?? Date.now()).toISOString(),
	};
}

/** Model-visible routing block that resolves @Title mentions to session UUIDs. */
export function buildSessionReferenceBlock(references) {
	if (!Array.isArray(references) || references.length === 0) return "";
	const lines = references.map((ref) => `- "@${ref.targetTitle}": session ${ref.targetSessionId}`);
	return `\n${SESSION_REFERENCE_BEGIN}\n${lines.join("\n")}\n${SESSION_REFERENCE_END}`;
}

/** Split a prompt into the user-visible text and the appended reference block. */
export function stripSessionReferenceBlock(text) {
	if (typeof text !== "string") return { text: "", block: "" };
	const begin = text.indexOf(SESSION_REFERENCE_BEGIN);
	if (begin < 0) return { text, block: "" };
	const end = text.indexOf(SESSION_REFERENCE_END, begin);
	if (end < 0) return { text, block: "" };
	const block = text.slice(begin, end + SESSION_REFERENCE_END.length);
	let visible = text.slice(0, begin) + text.slice(end + SESSION_REFERENCE_END.length);
	visible = visible.replace(/\n+$/, "");
	return { text: visible, block };
}

/**
 * Resolve which persisted user entry carried this prompt. Prefers the entry
 * chained from the captured leaf (exact); falls back to the newest user entry
 * whose text matches the prompt body. Returns null when neither matches.
 */
export function resolveSourceEntryId(entries, { leafBefore, promptText }) {
	if (leafBefore) {
		const chained = entries.find((entry) => entry.type === "message" && entry.message?.role === "user" && entry.parentId === leafBefore);
		if (chained) return chained.id;
	}
	const visible = stripSessionReferenceBlock(promptText).text;
	const normalized = visible.replace(/\s+/g, " ").trim();
	if (normalized) {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry.type !== "message" || entry.message?.role !== "user") continue;
			const parts = Array.isArray(entry.message.content)
				? entry.message.content.map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : "")).join("")
				: typeof entry.message.content === "string"
					? entry.message.content
					: "";
			if (parts.replace(/\s+/g, " ").trim() === normalized) return entry.id;
		}
	}
	return null;
}

/**
 * Append one session_reference fact per mention once the prompt entry exists.
 * Best effort like every fact write; idempotent per clientMessageId.
 */
export function appendSessionReferenceFacts(sessionManager, { clientMessageId, references }) {
	if (!Array.isArray(references) || references.length === 0) return [];
	const existing = new Set(
		readFacts(sessionManager)
			.filter((fact) => fact.type === "session_reference")
			.map((fact) => `${fact.clientMessageId}:${fact.targetSessionId}`),
	);
	const appended = [];
	for (const ref of references) {
		const key = `${clientMessageId}:${ref.targetSessionId}`;
		if (existing.has(key)) continue;
		appendFact(sessionManager, {
			type: "session_reference",
			id: `ref-${randomUUID()}`,
			lane: "main",
			sourceEntryId: ref.sourceEntryId,
			clientMessageId,
			targetSessionId: ref.targetSessionId,
			targetTitle: ref.targetTitle,
			timestamp: Date.now(),
			});
			appended.push(ref);
		}
		return appended;
	}

export function appendContextAttachedFact(sessionManager, { targetSessionId, contextSha, lane = "main" } = {}) {
	const record = {
		type: "context_attached",
		id: `context-${randomUUID()}`,
		lane,
		targetSessionId,
		contextSha,
		timestamp: Date.now(),
	};
	return appendFact(sessionManager, record);
}

/**
 * Address a shadow-git checkpoint from the session log. Git is the authority
 * for the snapshot; this pair only records that it happened, keyed by
 * operationId, with targetId = the 40-char commit SHA. Fact failure must
 * never roll back or block the Git snapshot.
 */
/**
 * One firing of a scheduled Flow (next-cycle B8). Every attempt is recorded —
 * started, skipped (busy) or errored — so the trigger history lives in the
 * session facts, not in the schedule config file.
 */
export function appendFlowTriggerFact(sessionManager, { flowSha, scheduleId, outcome, detail } = {}) {
	if (typeof flowSha !== "string" || !/^[0-9a-f]{64}$/.test(flowSha)) {
		throw new Error("Invalid flow_trigger fact: flowSha must be a 64-char lowercase SHA-256");
	}
	if (typeof scheduleId !== "string" || scheduleId.length === 0 || scheduleId.length > 128) {
		throw new Error("Invalid flow_trigger fact: scheduleId");
	}
	if (!["started", "skipped_busy", "error"].includes(outcome)) {
		throw new Error("Invalid flow_trigger fact: outcome");
	}
	const record = {
		type: "flow_trigger",
		id: `trigger-${randomUUID()}`,
		lane: "main",
		flowSha,
		scheduleId,
		outcome,
		...(detail ? { detail: String(detail).slice(0, 512) } : {}),
		timestamp: Date.now(),
	};
	return appendFact(sessionManager, record);
}

export function appendCheckpointFacts(sessionManager, { checkpointId, label, outcome = "completed", error } = {}) {
	if (typeof checkpointId !== "string" || !/^[0-9a-f]{40}$/.test(checkpointId)) {
		throw new Error("Invalid checkpoint fact: checkpointId must be a 40-char commit SHA");
	}
	const operationId = `op-${randomUUID()}`;
	const sourceLeafId = typeof sessionManager.getLeafId === "function" ? sessionManager.getLeafId() : null;
	appendFact(sessionManager, {
		type: "operation_started",
		id: operationId,
		lane: "main",
		sourceLeafId: sourceLeafId ?? null,
		intent: {
			kind: "navigation",
			targetId: checkpointId,
			summarize: false,
			label: String(label ?? "checkpoint").slice(0, 200),
		},
		timestamp: Date.now(),
	});
	appendFact(sessionManager, {
		type: "operation_finished",
		id: `finish-${operationId}`,
		lane: "main",
		runId: operationId,
		outcome: OPERATION_OUTCOMES.has(outcome) ? outcome : "completed",
		...(outcome === "failed" && error
			? { error: { code: String(error.code ?? error.name ?? "checkpoint"), message: String(error.message ?? error).slice(0, 500) } }
			: {}),
		timestamp: Date.now(),
	});
	return operationId;
}
