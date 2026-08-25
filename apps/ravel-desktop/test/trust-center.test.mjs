import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Trust Center provides bulk workspace decisions and inheritance visibility", async () => {
  const source = await readFile(new URL("../src/renderer/components/layout/TrustCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /Trust Center/);
  assert.match(source, /继承父目录信任/);
  assert.match(source, /decideProjectTrust/);
  assert.match(source, /once/);
  assert.match(source, /always/);
  assert.match(source, /never/);
});
