import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("packaged smoke launches an isolated app and requires runtime handshake", async () => {
  const source = await readFile(new URL("../scripts/electron-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /spawn\(executable/);
  assert.match(source, /OMEGA_AUTOTEST: "1"/);
  assert.match(source, /OMEGA_DOMPROBE: "1"/);
  assert.match(source, /--user-data-dir/);
  assert.match(source, /agent worker ready/);
  assert.match(source, /autotest done, quitting/);
  assert.match(source, /missing signals/);
  assert.match(source, /child\.kill\(\)/);
  assert.match(source, /resources.*omega-runtime|omega-runtime/);
});
