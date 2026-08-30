/**
 * P4 repo source adapter: project understanding via pure-text heuristics.
 *
 * Scans a repository root and produces file/module nodes + dependency edges
 * without any language toolchain: directory structure, import/require
 * parsing, README/docs extraction and extension-based language detection.
 * Node ids are `workspaceId + relative path`; a content change (contentSha256)
 * appends a new revision instead of overwriting — the same contract the web
 * source uses, so the canvas shows a module map whose history is traceable.
 *
 * Pure module: node:fs reads only, no Electron, no network.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const MAX_REPO_FILES = 4_000;
const MAX_REPO_DEPTH = 12;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".turbo", "coverage", ".cache", ".idea", ".vscode", ".workbuddy", "release", "ravel-ui-refresh"]);
const DOC_NAMES = new Set(["readme.md", "readme.txt", "readme", "package.json", "tsconfig.json", "cargo.toml", "go.mod", "pyproject.toml"]);
const MAX_FILE_BYTES = 512 * 1024;

const LANGUAGE_BY_EXTENSION = Object.freeze({
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".c": "c", ".h": "c",
  ".cpp": "cpp", ".hpp": "cpp", ".cs": "csharp", ".rb": "ruby", ".php": "php",
  ".swift": "swift", ".kt": "kotlin", ".scala": "scala", ".json": "json", ".md": "markdown",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".sql": "sql", ".sh": "shell",
  ".css": "css", ".scss": "scss", ".html": "html", ".vue": "vue", ".svelte": "svelte",
  ".lua": "lua", ".ex": "elixir", ".exs": "elixir", ".zig": "zig", ".dart": "dart",
});

// Binary / vendored artifact extensions that a pure-text index must skip.
const BINARY_EXTENSIONS = new Set([
  ".bin", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".otf",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".exe", ".dll", ".so", ".dylib", ".class", ".jar",
  ".wasm", ".map", ".lock", ".pack", ".idx", ".node", ".pdb", ".db", ".sqlite", ".sqlite3",
]);

const IMPORT_PATTERNS = [
  /from\s+["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /require\(\s*["']([^"']+)["']\s*\)/g,
  /import\s+["']([^"']+)["']/g,
  /use\s+["']([^"']+)["']/g,
];

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hashId(value) {
  return sha256(value);
}

function languageOf(filePath) {
  const extension = extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "text";
}

function isDocumentation(filePath) {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return DOC_NAMES.has(name) || extname(name).toLowerCase() === ".md";
}

/** Heuristic module-id resolution: strip ./ ../, drop query/hash. */
function moduleIdOf(specifier) {
  const cleaned = specifier.split(/[?#]/)[0];
  if (!cleaned || cleaned.startsWith("node:") || cleaned.startsWith("/")) return null;
  return cleaned;
}

/**
 * Scan a repository and project file/module nodes + dependency edges.
 * Returns plain graph input compatible with the engine's web-graph projector
 * (nodes carry nodeId + content-addressed nodeRevisionId + evidence).
 */
export function scanRepository(root, options = {}) {
  const maxFiles = Number.isSafeInteger(options.maxFiles) ? Math.min(options.maxFiles, MAX_REPO_FILES) : MAX_REPO_FILES;
  const maxDepth = Number.isSafeInteger(options.maxDepth) ? Math.min(options.maxDepth, MAX_REPO_DEPTH) : MAX_REPO_DEPTH;
  const nodes = [];
  const edges = [];
  const diagnostics = [];
  const files = [];
  let visited = 0;
  let truncated = false;

  const walk = (directory, depth) => {
    if (depth > maxDepth || truncated) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(join(directory, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (visited >= maxFiles) {
        truncated = true;
        return;
      }
      visited += 1;
      try {
        if (statSync(join(directory, entry.name)).size > MAX_FILE_BYTES) continue;
        files.push(join(directory, entry.name));
      } catch {
        /* unreadable entries are skipped */
      }
    }
  };
  walk(root, 0);
  if (truncated) diagnostics.push({ code: "truncated", message: `repo scan truncated at ${maxFiles} files` });

  const relativePathOf = (file) => relative(root, file).replace(/\\/g, "/");
  const fileNodes = new Map();

  for (const file of files) {
    const relativePath = relativePathOf(file);
    if (!relativePath) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const contentSha256 = sha256(content);
    const language = languageOf(file);
    const isDoc = isDocumentation(relativePath);
    const nodeId = `repo:${relativePath}`;
    const nodeRevisionId = hashId(`repo-node:${relativePath}:${contentSha256}`);
    const title = isDoc ? `📄 ${relativePath}` : `${relativePath} · ${language}`;
    fileNodes.set(relativePath, { nodeId, nodeRevisionId });
    nodes.push({
      id: nodeId,
      nodeId,
      nodeRevisionId,
      kind: "file",
      title,
      createdAt: Date.now(),
      evidence: [{ role: "supports", address: { sourceType: "file", objectId: nodeId, revisionId: contentSha256 } }],
      metadata: { language, size: content.length, documentation: isDoc },
    });
  }

  // Dependency edges from import/require heuristics (module-level edges
  // between files; external packages become "module" dependency targets).
  const moduleNodes = new Map();
  for (const file of files) {
    const relativePath = relativePathOf(file);
    if (!relativePath || !fileNodes.has(relativePath)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fromDir = join(root, relativePath.split("/").slice(0, -1).join("/"));
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const specifier = match[1];
        if (!specifier) continue;
        const targetModule = moduleIdOf(specifier);
        if (!targetModule) continue;
        // External package: create a module node once.
        if (!targetModule.startsWith(".")) {
          if (!moduleNodes.has(targetModule)) {
            const moduleId = `module:${targetModule}`;
            moduleNodes.set(targetModule, moduleId);
            nodes.push({
              id: moduleId,
              nodeId: moduleId,
              nodeRevisionId: hashId(`module-node:${targetModule}`),
              kind: "module",
              title: targetModule,
              createdAt: Date.now(),
              metadata: { language: "external" },
            });
          }
          edges.push({ id: `${fileNodes.get(relativePath).nodeId}->module:${targetModule}`, srcNodeId: fileNodes.get(relativePath).nodeId, dstNodeId: moduleNodes.get(targetModule), kind: "depends_on" });
          continue;
        }
        // Relative import: match the file on disk (with extension resolution).
        const candidate = resolve(fromDir, targetModule);
        const matchPath = files.find((file) => {
          const absolute = resolve(file);
          return absolute === candidate || absolute === `${candidate}.ts` || absolute === `${candidate}.tsx` || absolute === `${candidate}.js` || absolute === `${candidate}.jsx` || absolute === `${candidate}.mjs` || absolute === `${candidate}/index.ts` || absolute === `${candidate}/index.js`;
        });
        if (matchPath) {
          const target = relativePathOf(matchPath);
          if (fileNodes.has(target) && target !== relativePath) {
            edges.push({
              id: `${fileNodes.get(relativePath).nodeId}->${fileNodes.get(target).nodeId}`,
              srcNodeId: fileNodes.get(relativePath).nodeId,
              dstNodeId: fileNodes.get(target).nodeId,
              kind: "depends_on",
            });
          }
        }
      }
    }
  }

  return {
    nodes,
    edges,
    diagnostics: [...diagnostics, ...(files.length === 0 ? [{ code: "empty", message: "no files indexed (empty or unreadable repository)" }] : [])],
    fileCount: files.length,
  };
}

export const REPO_SOURCE_CONSTANTS = Object.freeze({ MAX_REPO_FILES, IGNORED_DIRS, LANGUAGE_BY_EXTENSION });
