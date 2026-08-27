/**
 * Skill version identity. Overwriting a skill file is a new version: same path,
 * new SHA-256. Never treat the hash as a fact-layer id of its own — it is the
 * content half of `name + path + content hash`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function contentHashOf(content) {
	return createHash("sha256").update(typeof content === "string" ? content : String(content ?? ""), "utf8").digest("hex");
}

/** Best-effort file hash. Missing files yield an empty string, never throw. */
export function contentHashOfFile(filePath) {
	try {
		return createHash("sha256").update(readFileSync(filePath)).digest("hex");
	} catch {
		return "";
	}
}
