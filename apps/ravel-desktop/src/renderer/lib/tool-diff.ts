/**
 * Structured line diff for edit tool cards, computed from the tool's own
 * oldText/newText arguments (reliable before/after data — never guessed from
 * result text). Pure functions only; no store access.
 */

export interface ToolDiffLine {
  type: "context" | "add" | "del";
  content: string;
}

export interface ToolDiffBlock {
  lines: ToolDiffLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

const MAX_DIFF_LINES = 400;
/** Guard the O(n*m) LCS table; beyond this the pair degrades to a replace block. */
const MAX_LCS_CELLS = 200_000;

interface EditPair {
  oldText: string;
  newText: string;
}

/** Extract edit pairs from an edit tool argsJson; null when not applicable. */
export function parseToolEdits(argsJson?: string): { path?: string; edits: EditPair[] } | null {
  if (!argsJson) return null;
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : undefined;
  const rawEdits = Array.isArray(record.edits) ? record.edits : [record];
  const edits: EditPair[] = [];
  for (const item of rawEdits) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.oldText !== "string") continue;
    if (typeof candidate.newText !== "string") continue;
    edits.push({ oldText: candidate.oldText, newText: candidate.newText });
  }
  return edits.length > 0 ? { ...(path ? { path } : {}), edits } : null;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** LCS-based line diff; falls back to a whole-block replace when too large. */
export function lineDiff(oldText: string, newText: string): ToolDiffBlock {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldText === newText) {
    return { lines: [], additions: 0, deletions: 0, truncated: false };
  }

  let pairs: Array<[string | null, string | null]>;
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    pairs = [
      ...oldLines.map((content): [string | null, string | null] => [content, null]),
      ...newLines.map((content): [string | null, string | null] => [null, content]),
    ];
  } else {
    const rows = oldLines.length;
    const cols = newLines.length;
    // lcs[i][j] = LCS length of oldLines[i..] and newLines[j..]
    const lcs: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        lcs[i]![j] = oldLines[i] === newLines[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }
    pairs = [];
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (oldLines[i] === newLines[j]) {
        pairs.push([oldLines[i]!, newLines[j]!]);
        i += 1;
        j += 1;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
        pairs.push([oldLines[i++]!, null]);
      } else {
        pairs.push([null, newLines[j++]!]);
      }
    }
    while (i < rows) pairs.push([oldLines[i++]!, null]);
    while (j < cols) pairs.push([null, newLines[j++]!]);
  }

  const lines: ToolDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let truncated = false;
  for (const [oldLine, newLine] of pairs) {
    if (oldLine !== null && newLine !== null) {
      if (lines.length < MAX_DIFF_LINES) lines.push({ type: "context", content: oldLine });
      else truncated = true;
      continue;
    }
    if (oldLine !== null) {
      deletions += 1;
      if (lines.length < MAX_DIFF_LINES) lines.push({ type: "del", content: oldLine });
      else truncated = true;
    }
    if (newLine !== null) {
      additions += 1;
      if (lines.length < MAX_DIFF_LINES) lines.push({ type: "add", content: newLine });
      else truncated = true;
    }
  }
  return { lines, additions, deletions, truncated };
}
