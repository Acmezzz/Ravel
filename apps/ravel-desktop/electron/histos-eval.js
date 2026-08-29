import { createHash } from "node:crypto";
import { canonicalJson, normalizeFactAddress } from "./histos-address.js";

const OUTCOMES = new Set(["scored", "unscored", "skipped", "pending", "errored"]);
const MAX_TEXT = 4096;
const MAX_GROUP_KEY = 8192;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function boundedString(value, label, max = MAX_TEXT) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function finiteMetric(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalid(`${label} must be a non-negative finite number`);
  return value;
}

function finiteScore(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${label} must be a finite number`);
  return value;
}

/**
 * Normalize one eval observation into a content-addressable, lossless record.
 * Missing scores and telemetry remain missing; they are never coerced to zero.
 */
export function normalizeEvalResult(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw invalid("eval result must be an object");
  const evalSet = boundedString(input.evalSet, "evalSet");
  const groupKey = boundedString(input.groupKey, "groupKey", MAX_GROUP_KEY);
  const testName = boundedString(input.testName, "testName");
  const file = boundedString(input.file, "file");
  const harness = boundedString(input.harness, "harness");
  const baseline = boundedString(input.baseline, "baseline");
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) throw invalid("candidates must be a non-empty array");
  const candidates = input.candidates.map((candidate, index) => boundedString(candidate, `candidates[${index}]`));
  if (new Set(candidates).size !== candidates.length) throw invalid("candidates must be unique");
  if (!Number.isSafeInteger(input.repetition) || input.repetition < 1) throw invalid("repetition must be a positive integer");
  const outcome = input.outcome;
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) throw invalid(`outcome must be one of ${[...OUTCOMES].join(", ")}`);
  const score = input.score === undefined ? undefined : finiteScore(input.score, "score");
  if (outcome === "scored" && score === undefined) throw invalid("scored eval result requires a score");
  if (outcome !== "scored" && input.score !== undefined) throw invalid("only scored eval results may contain a score");
  return {
    schemaVersion: 1,
    evalSet,
    groupKey,
    testName,
    file,
    harness,
    baseline,
    candidates,
    repetition: input.repetition,
    outcome,
    ...(score === undefined ? {} : { score }),
    ...(finiteMetric(input.totalTokens, "totalTokens") === undefined ? {} : { totalTokens: input.totalTokens }),
    ...(finiteMetric(input.totalMs, "totalMs") === undefined ? {} : { totalMs: input.totalMs }),
    ...(finiteMetric(input.estimatedCostUsd, "estimatedCostUsd") === undefined ? {} : { estimatedCostUsd: input.estimatedCostUsd }),
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function evalResultRevisionId(input) {
  return sha256(canonicalJson(normalizeEvalResult(input)));
}

/** Stable FactAddress for an eval observation; revisionId is the observation hash. */
export function evalResultAddress(input) {
  const result = normalizeEvalResult(input);
  const identity = sha256(`${result.evalSet}\u0000${result.groupKey}\u0000${result.harness}\u0000${result.repetition}`);
  return normalizeFactAddress({
    sourceType: "eval_result",
    objectId: identity,
    revisionId: sha256(canonicalJson(result)),
  });
}

/**
 * Project one observation into the existing GraphRevision family. This is a
 * pure adapter: callers may persist it through the normal Histos artifact path,
 * while unscored/error observations remain explicit in metadata.
 */
export function evalResultGraph(input) {
  const result = normalizeEvalResult(input);
  const revisionId = evalResultRevisionId(result);
  const address = evalResultAddress(result);
  const identity = sha256(`${result.evalSet}\u0000${result.groupKey}\u0000${result.harness}\u0000${result.repetition}`);
  const nodeId = `eval-result:${identity}`;
  const nodeRevisionId = sha256(`eval-result-node:${revisionId}`);
  const telemetry = {
    outcome: result.outcome,
    ...(result.score === undefined ? {} : { score: result.score }),
    ...(result.totalTokens === undefined ? {} : { totalTokens: result.totalTokens }),
    ...(result.totalMs === undefined ? {} : { totalMs: result.totalMs }),
    ...(result.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: result.estimatedCostUsd }),
  };
  return {
    schemaVersion: 1,
    kind: "graph_revision",
    lens: "structural",
    granularity: "entry",
    sourceSet: { sourceTypes: ["eval_result"], evalSets: [result.evalSet] },
    nodes: [{
      nodeId,
      nodeRevisionId,
      kind: "eval_result",
      title: `${result.evalSet}: ${result.testName} (${result.harness}, ${result.outcome})`.slice(0, 512),
      metadata: telemetry,
    }],
    edges: [],
    evidence: [{ revisionId: nodeRevisionId, address, role: "produces" }],
    parents: [],
    evalResult: result,
  };
}
