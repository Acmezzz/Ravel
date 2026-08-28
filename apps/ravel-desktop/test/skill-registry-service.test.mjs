import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MAX_REGISTRY_ENTRIES,
  downloadRegistryEntries,
  fetchRegistryIndex,
  mapWithConcurrency,
  parseRegistryIndex,
} from "../electron/skill-registry-service.js";

const INDEX_URL = "https://registry.example.com/skills/index.json";

test("registry index parsing normalizes entries and drops invalid ones", () => {
  const raw = JSON.stringify({
    skills: [
      { name: "good-skill", description: "does things", url: "https://cdn.example.com/good-skill.md" },
      { name: "bad-url", url: "http://insecure/skill.md" },
      { name: "bad name!", url: "https://cdn.example.com/x.md" },
      { name: "good-skill", url: "https://cdn.example.com/dup.md" },
      { nope: true },
    ],
  });
  const entries = parseRegistryIndex(raw);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { name: "good-skill", url: "https://cdn.example.com/good-skill.md", description: "does things" });
  // A bare array and relative-entry rejection.
  assert.equal(parseRegistryIndex(JSON.stringify([{ name: "a", url: "https://a/x.md" }])).length, 1);
  assert.throws(() => parseRegistryIndex("not json"), (error) => error.code === "invalid_args");
  assert.throws(() => parseRegistryIndex(JSON.stringify({ other: [] })), (error) => error.code === "invalid_args");
  // Entry cap.
  const many = Array.from({ length: MAX_REGISTRY_ENTRIES + 10 }, (_, i) => ({ name: `s-${i}`, url: `https://a/${i}.md` }));
  assert.equal(parseRegistryIndex(JSON.stringify(many)).length, MAX_REGISTRY_ENTRIES);
});

test("mapWithConcurrency preserves order and respects the limit", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `concurrency limit held (peak ${peak})`);
});

function fakeFetchFor(files) {
  return async (url) => {
    const body = files.get(String(url));
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
}

test("registry download stages entries concurrently with sha256 keys and per-entry errors", async () => {
  const stagingRoot = mkdtempSync(join(tmpdir(), "ravel-registry-"));
  const files = new Map([
    ["https://cdn.example.com/a.md", "skill A"],
    ["https://cdn.example.com/b.md", "skill B"],
  ]);
  const fetchImpl = fakeFetchFor(files);
  const entries = [
    { name: "a", url: "https://cdn.example.com/a.md" },
    { name: "broken", url: "https://cdn.example.com/missing.md" },
    { name: "b", url: "https://cdn.example.com/b.md" },
  ];
  try {
    const results = await downloadRegistryEntries(entries, stagingRoot, { fetchImpl, concurrency: 3 });
    assert.equal(results.length, 3);
    assert.equal(results[0].name, "a");
    assert.ok(results[0].sha256 && results[0].path);
    const expectedSha = createHash("sha256").update("skill A").digest("hex");
    assert.equal(results[0].sha256, expectedSha);
    assert.ok(results[0].path.includes(expectedSha), "staging key is the content sha256");
    assert.ok(existsSync(results[0].path));
    assert.equal(readFileSync(results[0].path, "utf8"), "skill A");
    assert.equal(results[1].name, "broken");
    assert.ok(results[1].error, "a failed entry carries an error without breaking the rest");
    assert.equal(results[2].sha256, createHash("sha256").update("skill B").digest("hex"));
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("fetchRegistryIndex rejects non-https, HTTP errors and oversized indexes", async () => {
  await assert.rejects(() => fetchRegistryIndex("http://insecure/index.json"), (error) => error.code === "invalid_args");
  await assert.rejects(
    () => fetchRegistryIndex(INDEX_URL, { fetchImpl: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    (error) => error.code === "fetch_failed",
  );
  const big = " ".repeat(1024 * 1024 + 1);
  await assert.rejects(
    () => fetchRegistryIndex(INDEX_URL, { fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(big).buffer }) }),
    (error) => error.code === "too_large",
  );
  const entries = await fetchRegistryIndex(INDEX_URL, {
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify([{ name: "x", url: "https://a/x.md" }])).buffer }),
  });
  assert.deepEqual(entries, [{ name: "x", url: "https://a/x.md" }]);
});
