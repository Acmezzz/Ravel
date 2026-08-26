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

const FACT_TYPES = new Set(["operation_started", "operation_finished", "approval_asked", "approval_decided"]);

export const APPROVAL_OUTCOMES = Object.freeze(["allowed-once", "rejected", "cancelled", "unavailable"]);
export const APPROVAL_REASON_CODES = Object.freeze(["user-allowed", "user-denied", "ui-cancelled", "timeout", "no-answerer"]);
const OPERATION_OUTCOMES = new Set(["completed", "aborted", "failed", "declined"]);

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
			break;
		}
		case "approval_asked":
			for (const field of ["runId", "toolCallId", "toolName", "argsDigest"]) requireString(record, field);
			requireOptionalString(record, "policyProfile");
			break;
		case "approval_decided": {
			for (const field of ["runId", "toolCallId", "askedId"]) requireString(record, field);
			requireOptionalString(record, "policyProfile");
			requireOptionalString(record, "uiRequestId");
			if (!APPROVAL_OUTCOMES.includes(record.outcome)) {
				throw new Error(`Invalid approval_decided fact: outcome ${JSON.stringify(record.outcome)}`);
			}
			if (record.reasonCode !== undefined && !APPROVAL_REASON_CODES.includes(record.reasonCode)) {
				throw new Error(`Invalid approval_decided fact: reasonCode ${JSON.stringify(record.reasonCode)}`);
			}
			break;
		}
	}
	return sessionManager.appendCustomEntry(FACT_CUSTOM_TYPE, record);
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
