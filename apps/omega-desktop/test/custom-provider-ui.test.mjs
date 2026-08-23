import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Model Center exposes offline local provider configuration without OAuth/network claims", async () => {
  const source = await readFile(new URL("../src/renderer/components/layout/ModelCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /添加本地 Provider/);
  assert.match(source, /configureCustomProvider/);
  assert.match(source, /不会联网 discovery/);
});
