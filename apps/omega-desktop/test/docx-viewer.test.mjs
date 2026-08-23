import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDocxText } from "../electron/docx-service.js";

function zipStore(name, content) {
  const nameBuffer = Buffer.from(name);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30 + nameBuffer.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(local, 30);
  data.copy(local, 30 + nameBuffer.length);
  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  nameBuffer.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

test("DOCX preview extracts safe text without executing markup", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-docx-"));
  const file = join(root, "demo.docx");
  const xml = "<w:document><w:body><w:p><w:r><w:t>Hello &amp; world</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;bad&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>";
  await writeFile(file, zipStore("word/document.xml", xml));
  const result = readDocxText(file);
  assert.equal(result.safe, true);
  assert.match(result.text, /Hello & world/);
  assert.match(result.text, /script/);
});

test("DOCX preview rejects malformed archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-docx-bad-"));
  const file = join(root, "bad.docx");
  await writeFile(file, Buffer.from("not-a-zip"));
  assert.throws(() => readDocxText(file), (error) => error.code === "invalid_docx");
});
