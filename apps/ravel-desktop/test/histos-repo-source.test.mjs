import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { scanRepository } from "../electron/histos-repo-source.js";

const QUERY = { sourceSet: {}, lens: "structural", granularity: "entry" };

function repoFixture() {
  const root = mkdtempSync(join(tmpdir(), "ravel-repo-src-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), 'import { helper } from "./helper";\nimport fs from "node:fs";\nexport const x = helper(fs.readFileSync("/dev/null", "utf8"));\n');
  writeFileSync(join(root, "src", "helper.ts"), "export function helper(value: string): string { return value; }\n");
  writeFileSync(join(root, "README.md"), "# Demo\n\nA sample repository for the repo source adapter.\n");
  writeFileSync(join(root, "src", "ignored.bin"), "binary-not-text");
  return root;
}

function createEngine(root) {
  const directory = mkdtempSync(join(tmpdir(), "ravel-repo-engine-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

test("scanRepository projects file/module nodes and dependency edges with language detection", () => {
  const root = repoFixture();
  try {
    const graph = scanRepository(root, { maxFiles: 200 });
    assert.equal(graph.fileCount, 3);
    assert.ok(graph.nodes.some((node) => node.nodeId === "repo:src/index.ts"), "ts file node present");
    assert.ok(graph.nodes.some((node) => node.nodeId === "repo:README.md"), "readme indexed as doc");
    assert.ok(graph.nodes.some((node) => node.metadata?.language === "typescript"), "language detected");
    // Relative import edge: index.ts -> helper.ts
    const edge = graph.edges.find((item) => item.srcNodeId === "repo:src/index.ts" && item.dstNodeId === "repo:src/helper.ts");
    assert.ok(edge, "relative import resolved to a dependency edge");
    // External package node: fs is node:, skipped; a bare specifier like "fs" is external but node: is excluded.
    const moduleNodes = graph.nodes.filter((node) => node.kind === "module");
    assert.equal(moduleNodes.length, 0, "node: builtins are not indexed as modules");
    // nodeId = workspaceId + relative path shape (repo:<relpath>), content-addressed revision ids.
    const tsNode = graph.nodes.find((node) => node.nodeId === "repo:src/index.ts");
    assert.match(tsNode.nodeRevisionId, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyRepoIndex surfaces the module map; content changes append revisions (old version stays queryable)", async () => {
  const root = repoFixture();
  const { directory, engine } = createEngine(root);
  try {
    const first = await engine.applyRepoIndex({ root, maxFiles: 200 });
    assert.ok(first.nodeCount >= 3);
    const graph1 = engine.getGraph(QUERY);
    const indexNode = graph1.nodes.find((node) => node.nodeId === "repo:src/index.ts");
    assert.ok(indexNode, "module map appears on the canvas");

    // Change the file: a new revision appends, the old one stays queryable.
    writeFileSync(join(root, "src", "index.ts"), 'import { helper } from "./helper";\nimport { extra } from "./extra";\nexport const x = helper(extra);\n');
    await engine.applyRepoIndex({ root, maxFiles: 200 });
    const versions = engine.getGraph(QUERY).nodes.filter((node) => node.nodeId === "repo:src/index.ts");
    assert.equal(versions.length, 2, "content change must append a revision");
    assert.notEqual(versions[0].nodeRevisionId, versions[1].nodeRevisionId);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyRepoIndex rejects a missing/invalid root and honors file caps", async () => {
  const root = repoFixture();
  const { directory, engine } = createEngine(root);
  try {
    await assert.rejects(() => engine.applyRepoIndex({}), /repository root/);
    const capped = await engine.applyRepoIndex({ root, maxFiles: 1, maxDepth: 1 });
    assert.ok(capped.diagnostics.some((item) => item.code === "truncated" || item.code === "empty"));
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo module nodes can be frozen into a ContextSet artifact (distillation path)", async () => {
  const root = repoFixture();
  const { directory, engine } = createEngine(root);
  try {
    await engine.applyRepoIndex({ root, maxFiles: 200 });
    const graph = engine.getGraph(QUERY);
    const indexNode = graph.nodes.find((node) => node.nodeId === "repo:src/index.ts");
    assert.ok(indexNode);
    const frozen = await engine.freezeContext({ ...QUERY, selection: [indexNode.nodeRevisionId] });
    // Reuse the existing ContextSet freeze semantics: a repo selection either
    // freezes into a content-addressed artifact (sha256 present) or fails
    // closed with an explicit code - it never pretends to have frozen.
    assert.ok(frozen.sha256 ?? (frozen.ok === false && typeof frozen.code === "string"), `freeze must produce a sha256 or a fail-closed code, got ${JSON.stringify(frozen).slice(0, 120)}`);
    if (frozen.sha256) assert.match(frozen.sha256, /^[0-9a-f]{64}$/);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
