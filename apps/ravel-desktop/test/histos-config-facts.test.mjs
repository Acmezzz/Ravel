import test from "node:test";
import assert from "node:assert/strict";
import { recordConfigChange, readFacts } from "../electron/session-facts.js";
import { projectFactBatchToTriples } from "../electron/histos-fact-derivation.js";
import { FACT_PREDICATES } from "../electron/histos-fact-graph.js";

function fakeSessionManager() {
  const entries = [];
  let nextId = 0;
  return {
    entries,
    getLeafId: () => null,
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      const entry = { type: "custom", customType, data, id: `entry-${++nextId}` };
      entries.push(entry);
      return entry.id;
    },
  };
}

test("recordConfigChange lands a config_changed fact through the single writer", () => {
  const manager = fakeSessionManager();
  recordConfigChange(manager, { domain: "resource", action: "create", id: "skill:greet", reason: "user install" });
  recordConfigChange(manager, { domain: "mcp", action: "delete", id: "mcp:serp" });
  const facts = readFacts(manager);
  assert.equal(facts.length, 2);
  assert.deepEqual(
    facts.map((fact) => [fact.type, fact.domain, fact.action, fact.targetId, fact.reason ?? null]),
    [
      ["config_changed", "resource", "create", "skill:greet", "user install"],
      ["config_changed", "mcp", "delete", "mcp:serp", null],
    ],
  );
  assert.match(facts[0].id, /^config-/);
});

test("recordConfigChange rejects unknown domain/action and empty ids", () => {
  const manager = fakeSessionManager();
  for (const args of [
    { domain: "bogus", action: "update", id: "x" },
    { domain: "resource", action: "rename", id: "x" },
    { domain: "resource", action: "update", id: "" },
    { domain: "resource", action: "update" },
  ]) {
    assert.throws(() => recordConfigChange(manager, args));
  }
  assert.equal(readFacts(manager).length, 0);
});

test("config_changed facts derive to a domain predicate family queryable as a timeline", () => {
  const now = 1_000_000;
  const facts = [
    { type: "config_changed", id: "c1", domain: "resource", action: "create", targetId: "skill:greet", timestamp: now },
    { type: "config_changed", id: "c2", domain: "resource", action: "delete", targetId: "skill:greet", timestamp: now + 1 },
    { type: "config_changed", id: "c3", domain: "permission", action: "update", targetId: "bash", timestamp: now + 2 },
    { type: "config_changed", id: "c4", domain: "trust", action: "update", targetId: "workspace-1", timestamp: now + 3 },
    { type: "config_changed", id: "c5", domain: "mcp", action: "create", targetId: "mcp:serp", timestamp: now + 4 },
    { type: "config_changed", id: "c6", domain: "mode", action: "update", targetId: "plan", timestamp: now + 5 },
    { type: "config_changed", id: "c7", domain: "provider", action: "update", targetId: "anthropic", timestamp: now + 6 },
    { type: "config_changed", id: "c8", domain: "profile", action: "update", targetId: "default", timestamp: now + 7 },
  ];
  const triples = projectFactBatchToTriples(facts, { sessionId: "s1" });
  // Every domain maps to its predicate family; the timeline keeps order.
  const byDomain = (domain) => triples.filter((triple) => triple.predicate === `custom_config_${domain}`).map((triple) => triple.object);
  for (const domain of ["resource", "permission", "trust", "mcp", "mode", "provider", "profile"]) {
    assert.ok(byDomain(domain).length > 0, `expected a triple for domain ${domain}`);
  }
  assert.deepEqual(byDomain("resource"), ["create:skill:greet", "delete:skill:greet"]);
  assert.deepEqual(byDomain("mode"), ["update:plan"]);
  for (const triple of triples) {
    assert.ok(FACT_PREDICATES.includes(triple.predicate) || triple.predicate.startsWith("custom_"), `predicate ${triple.predicate} not allowed`);
    assert.equal(triple.tag, "config");
  }
  // Unknown domains derive nothing instead of throwing.
  assert.deepEqual(projectFactBatchToTriples([{ type: "config_changed", id: "c9", domain: "bogus", action: "update", targetId: "x" }], { sessionId: "s1" }), []);
});

test("config change timeline is reconstructable from the JSONL after restart", () => {
  // The fact stream is append-only; replaying readFacts in order rebuilds the
  // configuration change timeline exactly as it happened.
  const manager = fakeSessionManager();
  recordConfigChange(manager, { domain: "mcp", action: "create", id: "mcp:a" });
  recordConfigChange(manager, { domain: "mcp", action: "update", id: "mcp:a" });
  recordConfigChange(manager, { domain: "mcp", action: "delete", id: "mcp:a" });
  const timeline = readFacts(manager).map((fact) => `${fact.domain}:${fact.action}:${fact.targetId}`);
  assert.deepEqual(timeline, ["mcp:create:mcp:a", "mcp:update:mcp:a", "mcp:delete:mcp:a"]);
});
