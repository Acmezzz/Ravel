import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules", "ui"]);
const files = [];

function collectTypescriptFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name)) {
				collectTypescriptFiles(join(directory, entry.name));
			}
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
			files.push(join(directory, entry.name));
		}
	}
}

function isRelativeJavaScriptSpecifier(specifier) {
	return /^\.\.?\//.test(specifier) && /\.js(?:[?#].*)?$/.test(specifier);
}

// Matches module specifiers in `import ... from "..."`, bare side-effect
// `import "..."`, `export ... from "..."` (including multiline lists where
// `from` sits on its own line), and dynamic `import("...")` calls.
const specifierPattern = /(?:\bimport\s*\(\s*|\bfrom\s+|\bimport\s+)("|')([^"']+)\1/g;

// Index of a trailing `//` line comment outside of quoted strings, or -1.
function lineCommentStart(line) {
	let quote = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "/" && line[i + 1] === "/") return i;
	}
	return -1;
}

const failures = [];

collectTypescriptFiles(".");

for (const file of files.sort()) {
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
		const commentStart = lineCommentStart(line);
		for (const match of line.matchAll(specifierPattern)) {
			if (commentStart >= 0 && (match.index ?? 0) >= commentStart) break;
			const specifier = match[2];
			if (!isRelativeJavaScriptSpecifier(specifier)) continue;
			const column = (match.index ?? 0) + match[0].indexOf(specifier) + 1;
			failures.push(`${file}:${i + 1}:${column}: ${specifier}`);
		}
	}
}

if (failures.length > 0) {
	console.error("Relative .js imports are not allowed in non-declaration .ts files:");
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
