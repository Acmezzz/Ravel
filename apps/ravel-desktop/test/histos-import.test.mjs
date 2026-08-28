import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";

test("importContext re-owns a frozen ContextSet, pins the source sha, and enforces the budget", async (t) => {
  const sourceRoot = await fs.mkdtemp(join(os.tmpdir(), "ravel-import-src-"));
  const targetRoot = await fs.mkdtemp(join(os.tmpdir(), "ravel-import-dst-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
    await fs.rm(targetRoot, { recursive: true, force: true });
  });
  const source = new HistosEngine({
    workspaceId: "ws-source",
    databasePath: join(sourceRoot, "index.sqlite"),
    artifactsDir: join(sourceRoot, "artifacts"),
    semanticProvider: async () => "登录模块凝练：认证与令牌刷新",
  });
  await source.distillResource({ kind: "skill", name: "auth", filePath: "skills/auth.md", revisionId: "c".repeat(64), content: "登录认证技能" });
  const suggested = source.suggestContext({ terms: ["登录"] });
  const ids = suggested.candidates.map((candidate) => candidate.nodeRevisionId);
  const frozen = await source.freezeContext({ sourceSet: {}, lens: "mixed", granularity: "entry", selection: ids, budget: 64_000 });
  source.close();

  const target = new HistosEngine({
    workspaceId: "ws-target",
    databasePath: join(targetRoot, "index.sqlite"),
    artifactsDir: join(targetRoot, "artifacts"),
  });
  const imported = await target.importContext({ sourceWorkspaceId: "ws-source", sourceSha256: frozen.sha256, sourceArtifactsDir: join(sourceRoot, "artifacts") });
  assert.match(imported.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(imported.artifact.parents, [frozen.sha256], "the import must pin the source sha as parent");
  assert.equal(imported.artifact.workspaceId, "ws-target", "the imported artifact must be re-owned");

  // Same-workspace import is a misuse and fails closed.
  await assert.rejects(
    () => target.importContext({ sourceWorkspaceId: "ws-target", sourceSha256: frozen.sha256, sourceArtifactsDir: join(sourceRoot, "artifacts") }),
    (error) => error.code === "invalid_args",
  );
  // A tiny budget must fail before writing anything.
  await assert.rejects(
    () => target.importContext({ sourceWorkspaceId: "ws-source", sourceSha256: frozen.sha256, sourceArtifactsDir: join(sourceRoot, "artifacts"), budget: 10 }),
    (error) => error.code === "budget_exceeded",
  );
  // Tampered or unknown source sha fails integrity checks.
  await assert.rejects(
    () => target.importContext({ sourceWorkspaceId: "ws-source", sourceSha256: "d".repeat(64), sourceArtifactsDir: join(sourceRoot, "artifacts") }),
    (error) => error.code === "integrity_error" || error.code === "not_found",
  );
  target.close();
});
