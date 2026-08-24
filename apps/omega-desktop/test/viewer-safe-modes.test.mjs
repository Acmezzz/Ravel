import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("FileViewer exposes source-only diagram modes without a misleading fake diff", async () => {
  const source = await readFile(new URL("../src/renderer/components/files/FileViewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /diffMode/);
  assert.match(source, /Mermaid source（安全预览）/);
  assert.match(source, /LaTeX source（安全预览）/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
