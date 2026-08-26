/**
 * Workspace-wide text search. Engines, in order: ripgrep (fastest, respects
 * .gitignore), then `git grep` (tracked files only). Queries run through
 * execFile argument arrays — never a shell — with hard budgets on matches,
 * time and output size.
 */
import { execFile } from "node:child_process";

export const SEARCH_MAX_RESULTS = 200;
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_QUERY_LENGTH = 256;

export function sanitizeSearchQuery(value) {
  if (typeof value !== "string") return null;
  const query = value.trim().slice(0, MAX_QUERY_LENGTH);
  return query.length > 0 ? query : null;
}

function parseMatches(stdout, limit) {
  const results = [];
  for (const line of stdout.split("\n")) {
    // Relative paths only (both engines run with cwd), so the first two
    // colons always separate path and line number.
    const match = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    results.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 400) });
    if (results.length >= limit) break;
  }
  return results;
}

function runEngine(command, args, cwd) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: SEARCH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => {
        // Exit code 1 from rg/git-grep means "no matches" — not an error.
        resolve({ ok: !error || error.code === 1, stdout: typeof stdout === "string" ? stdout : "" });
      },
    );
  });
}

/**
 * Search the workspace for a fixed string. Returns `{ engine, results,
 * truncated }`; `engine` is null when neither tool is available.
 */
export async function searchWorkspace(cwd, query, { limit = SEARCH_MAX_RESULTS } = {}) {
  const maxResults = Math.min(Math.max(1, Number(limit) || SEARCH_MAX_RESULTS), SEARCH_MAX_RESULTS);

  const rg = await runEngine(
    "rg",
    ["--line-number", "--no-heading", "--fixed-strings", "--max-count", "20", "--max-filesize", "1M", query, "."],
    cwd,
  );
  if (rg.ok) {
    const results = parseMatches(rg.stdout, maxResults);
    if (rg.stdout.length >= MAX_OUTPUT_BYTES || results.length >= maxResults) {
      return { engine: "rg", results, truncated: true };
    }
    return { engine: "rg", results, truncated: false };
  }

  const gitGrep = await runEngine("git", ["grep", "-n", "-I", "--fixed-strings", query], cwd);
  if (gitGrep.ok) {
    const results = parseMatches(gitGrep.stdout, maxResults);
    return { engine: "git-grep", results, truncated: results.length >= maxResults };
  }
  return { engine: null, results: [], truncated: false };
}
