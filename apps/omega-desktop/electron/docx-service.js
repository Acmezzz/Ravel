import { readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const MAX_DOCX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function u16(buffer, offset) { return buffer.readUInt16LE(offset); }
function u32(buffer, offset) { return buffer.readUInt32LE(offset); }

function entriesOf(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) fail("invalid_docx", "DOCX ZIP directory is missing");
  const count = u16(buffer, eocd + 10);
  const directorySize = u32(buffer, eocd + 12);
  const directoryOffset = u32(buffer, eocd + 16);
  if (count > MAX_ENTRIES || directoryOffset + directorySize > buffer.length) fail("docx_limits", "DOCX ZIP directory exceeds limits");
  const entries = new Map();
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (u32(buffer, cursor) !== 0x02014b50) fail("invalid_docx", "DOCX central directory entry is invalid");
    const compression = u16(buffer, cursor + 10);
    const compressedSize = u32(buffer, cursor + 20);
    const uncompressedSize = u32(buffer, cursor + 24);
    const nameLength = u16(buffer, cursor + 28);
    const extraLength = u16(buffer, cursor + 30);
    const commentLength = u16(buffer, cursor + 32);
    const localOffset = u32(buffer, cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (name.length > 512 || compressedSize > MAX_ENTRY_BYTES || uncompressedSize > MAX_ENTRY_BYTES) fail("docx_limits", "DOCX entry exceeds limits");
    entries.set(name, { compression, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  if (u32(buffer, entry.localOffset) !== 0x04034b50) fail("invalid_docx", "DOCX local entry is invalid");
  const nameLength = u16(buffer, entry.localOffset + 26);
  const extraLength = u16(buffer, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) fail("invalid_docx", "DOCX entry is truncated");
  const compressed = buffer.subarray(start, end);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  fail("unsupported_docx", "DOCX compression method is unsupported");
}

function textFromXml(xml) {
  const normalized = xml.replace(/<w:tab\s*\/?>/g, "\t").replace(/<w:br\s*\/?>/g, "\n").replace(/<w:(?:p|lastRenderedPageBreak)[^>]*>/g, "\n");
  const text = normalized.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "");
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
}

export function isDocxPath(path) {
  return typeof path === "string" && /\.docx$/i.test(path);
}

export function readDocxText(filePath) {
  const size = statSync(filePath).size;
  if (size > MAX_DOCX_BYTES) fail("docx_limits", "DOCX file exceeds the preview size limit");
  const buffer = readFileSync(filePath);
  const entries = entriesOf(buffer);
  const document = entries.get("word/document.xml");
  if (!document) fail("invalid_docx", "DOCX document.xml is missing");
  const xml = readEntry(buffer, document).toString("utf8");
  return { text: textFromXml(xml), size, safe: true, format: "docx" };
}
