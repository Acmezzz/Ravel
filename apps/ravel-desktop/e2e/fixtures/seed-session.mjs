import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SESSION_ID = "p7-seeded-session";
const CONTEXT_SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function sessionDirectory(workspace, home) {
  const resolvedWorkspace = resolve(workspace);
  const safePath = `--${resolvedWorkspace.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolve(home), ".pi", "agent", "sessions", safePath);
}

/** Seed a provider-free session in an isolated HOME/USERPROFILE tree. */
export async function seedSession({ workspace, home }) {
  const sessionDir = sessionDirectory(workspace, home);
  await mkdir(sessionDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const sessionFile = join(sessionDir, "2026-08-28T00-00-00-000Z_p7-seeded-session.jsonl");
  const entries = [
    { type: "session", version: 3, id: SESSION_ID, timestamp: "2026-08-28T00:00:00.000Z", cwd: resolve(workspace) },
    { type: "session_info", id: "p7-info", parentId: null, timestamp: "2026-08-28T00:00:01.000Z", name: "P7 Seed Session" },
    { type: "message", id: "p7-user", parentId: "p7-info", timestamp: "2026-08-28T00:00:02.000Z", message: { role: "user", content: "Provider-free P7 smoke session" } },
    { type: "message", id: "p7-assistant", parentId: "p7-user", timestamp: "2026-08-28T00:00:03.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "p7-tool-call", name: "read", arguments: { path: "seed.txt" } }] } },
    { type: "message", id: "p7-tool-result", parentId: "p7-assistant", timestamp: "2026-08-28T00:00:04.000Z", message: { role: "toolResult", toolCallId: "p7-tool-call", content: [{ type: "text", text: "P7 fixture" }], isError: false } },
    { type: "custom", customType: "ravel_record", id: "p7-approval-asked-entry", parentId: "p7-tool-result", timestamp: "2026-08-28T00:00:05.000Z", data: { type: "approval_asked", id: "p7-approval-asked", lane: "main", runId: "p7-run", toolCallId: "p7-tool-call", toolName: "read", argsDigest: "sha256:p7", timestamp: 1787875205000 } },
    { type: "custom", customType: "ravel_record", id: "p7-approval-decided-entry", parentId: "p7-approval-asked-entry", timestamp: "2026-08-28T00:00:06.000Z", data: { type: "approval_decided", id: "p7-approval-decided", lane: "main", runId: "p7-run", toolCallId: "p7-tool-call", askedId: "p7-approval-asked", outcome: "allowed-once", reasonCode: "user-allowed", timestamp: 1787875206000 } },
    { type: "custom", customType: "ravel_record", id: "p7-context-entry", parentId: "p7-approval-decided-entry", timestamp: "2026-08-28T00:00:07.000Z", data: { type: "context_attached", id: "p7-context-attached", lane: "main", targetSessionId: SESSION_ID, contextSha: CONTEXT_SHA, timestamp: 1787875207000 } },
  ];
  await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  await writeFile(join(workspace, "seed.txt"), "P7 fixture\n", "utf8");
  return { sessionId: SESSION_ID, sessionFile, contextSha: CONTEXT_SHA };
}
