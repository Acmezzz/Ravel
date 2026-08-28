import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";

async function tempEngine(t, provider) {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-histos-suggest-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const engine = new HistosEngine({
    workspaceId: "workspace-suggest",
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
    ...(provider ? { semanticProvider: provider } : {}),
  });
  return { engine, root };
}

test("suggestContext is deterministic, read-only, and honest about no hits", async (t) => {
  const { engine, root } = await tempEngine(t, async () => "登录模块凝练：处理认证与令牌刷新");
  // Seed one structural session and one distilled semantic node.
  const sessionFile = join(root, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: "session-suggest", cwd: root }),
    JSON.stringify({ type: "message", id: "entry-1", parentId: null, message: { role: "user", content: "修复登录模块的认证流程" } }),
    JSON.stringify({ type: "message", id: "entry-2", parentId: "entry-1", message: { role: "assistant", content: "done" } }),
    "",
  ].join("\n"), "utf8");
  await engine.applySessionFacts({ file: sessionFile });
  await engine.distillResource({ kind: "skill", name: "auth", filePath: "skills/auth.md", revisionId: "a".repeat(64), content: "关于登录模块认证的技能说明" });

  const before = JSON.stringify(engine.getGraph({ sourceSet: {}, lens: "mixed", granularity: "entry" }));
  const result = engine.suggestContext({ query: "登录 认证" });
  assert.deepEqual(result.terms, ["登录", "认证"]);
  assert.ok(result.candidates.length >= 1, "the distilled skill node should match 登录/认证");
  assert.ok(result.candidates.every((candidate) => typeof candidate.nodeRevisionId === "string" && candidate.score >= 1));
  assert.equal(JSON.stringify(engine.getGraph({ sourceSet: {}, lens: "mixed", granularity: "entry" })), before, "suggestion must not write anything");

  const none = engine.suggestContext({ terms: ["不存在关键词xyz"] });
  assert.deepEqual(none.candidates, [], "no hits must be an honest empty list");

  assert.throws(() => engine.suggestContext({}), (error) => error.code === "invalid_args");
  assert.throws(() => engine.suggestContext({ terms: ["a"] }), (error) => error.code === "invalid_args");
  assert.throws(() => engine.suggestContext({ terms: ["ok"], limit: 0 }), (error) => error.code === "invalid_args");
  engine.close();
});

test("suggested nodes freeze across source sets with an empty sourceSet and mixed lens", async (t) => {
  const { engine } = await tempEngine(t, async () => "登录模块凝练：处理认证与令牌刷新");
  await engine.distillResource({ kind: "skill", name: "auth", filePath: "skills/auth.md", revisionId: "b".repeat(64), content: "关于登录模块认证的技能说明" });
  const suggested = engine.suggestContext({ terms: ["登录"] });
  const ids = suggested.candidates.map((candidate) => candidate.nodeRevisionId);
  assert.ok(ids.length >= 1);
  const frozen = await engine.freezeContext({ sourceSet: {}, lens: "mixed", granularity: "entry", selection: ids, budget: 64_000 });
  assert.match(frozen.sha256, /^[0-9a-f]{64}$/);
  assert.ok(frozen.artifact.selection.length >= 1);
  engine.close();
});
