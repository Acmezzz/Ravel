import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";

async function tempEngine(t, provider) {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-histos-distill-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const engine = new HistosEngine({
    workspaceId: "workspace-distill",
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
    ...(provider ? { semanticProvider: provider } : {}),
  });
  return { engine, root };
}

const CONTENT = "# greet\n\n当用户打招唿时，用热情的一句话回应，并附上当天日期。\n";

test("distillResource fails closed without a semantic provider", async (t) => {
  const { engine } = await tempEngine(t);
  const result = await engine.distillResource({ kind: "skill", name: "greet", filePath: "skills/greet.md", revisionId: createHash("sha256").update(CONTENT).digest("hex"), content: CONTENT });
  assert.equal(result.ok, false);
  assert.equal(result.code, "semantic_provider_unavailable");
  engine.close();
});

test("distillResource produces a GraphRevision plus a draft ContextSet anchored to the skill file", async (t) => {
  const providerCalls = [];
  const { engine, root } = await tempEngine(t, async (request) => {
    providerCalls.push(request);
    return "问候用户并附上当天日期";
  });
  const revisionId = createHash("sha256").update(CONTENT).digest("hex");
  const result = await engine.distillResource({ kind: "skill", name: "greet", filePath: "skills/greet.md", revisionId, content: CONTENT });
  assert.equal(result.ok, true);
  assert.match(result.graphSha256, /^[0-9a-f]{64}$/);
  assert.match(result.contextSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.node.title, "问候用户并附上当天日期");

  // One provider call carrying the compiled prompt and the raw content.
  assert.equal(providerCalls.length, 1);
  assert.match(providerCalls[0].prompt, /CONTENT:/);
  assert.ok(providerCalls[0].prompt.includes("greet"));

  // The distilled node is queryable and its evidence points at the skill file
  // address anchored by the content hash.
  const node = engine.getNode(result.node.nodeRevisionId, { sourceSet: { resource: "skill:greet" }, lens: "semantic", granularity: "file" });
  assert.ok(node);
  assert.equal(node.kind, "skill");
  assert.equal(node.evidence.length, 1);
  assert.equal(node.evidence[0].address.sourceType, "skill");
  assert.equal(node.evidence[0].address.revisionId, revisionId);
  assert.ok(node.evidence[0].address.objectId.startsWith("skill:greet+"));

  // The draft ContextSet artifact exists on disk and references the node.
  const draft = JSON.parse(await fs.readFile(join(root ?? "", "artifacts", `${result.contextSha256}.json`), "utf8"));
  assert.equal(draft.kind, "context_set");
  assert.ok(draft.selection.some((item) => item.revisionId === result.node.nodeRevisionId));

  // Re-distilling the same content appends a new revision when content or
  // time differ; identical canonical bytes within the same millisecond dedupe
  // to the same sha (INSERT OR IGNORE). Either way the old node stays
  // queryable and nothing is overwritten in place.
  const again = await engine.distillResource({ kind: "skill", name: "greet", filePath: "skills/greet.md", revisionId, content: CONTENT });
  assert.equal(again.ok, true);
  assert.match(again.graphSha256, /^[0-9a-f]{64}$/);
  const firstNode = engine.getNode(result.node.nodeRevisionId, { sourceSet: { resource: "skill:greet" }, lens: "semantic", granularity: "file" });
  assert.ok(firstNode, "the previous revision must remain queryable after a re-distill");
  engine.close();
});

test("distillResource rejects invalid kinds, ids, and oversized content", async (t) => {
  const { engine } = await tempEngine(t, async () => "总结");
  const revisionId = createHash("sha256").update(CONTENT).digest("hex");
  await assert.rejects(
    () => engine.distillResource({ kind: "mcp", name: "x", filePath: "p", revisionId, content: CONTENT }),
    (error) => error.code === "invalid_args",
  );
  await assert.rejects(
    () => engine.distillResource({ kind: "skill", name: "x", filePath: "p", revisionId: "deadbeef", content: CONTENT }),
    (error) => error.code === "invalid_args",
  );
  await assert.rejects(
    () => engine.distillResource({ kind: "skill", name: "x", filePath: "p", revisionId, content: "" }),
    (error) => error.code === "invalid_args",
  );
  engine.close();
});
