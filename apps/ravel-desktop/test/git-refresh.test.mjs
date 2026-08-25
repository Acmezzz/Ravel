import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Git review refreshes on focus and handles stale snapshots explicitly", async () => {
  const source = await readFile(new URL("../src/renderer/components/panels/DiffViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /setInterval/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /stale_diff_snapshot/);
  assert.match(source, /请重新选择/);
});
