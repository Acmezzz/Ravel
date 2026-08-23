const MAX = Object.freeze({ sessionId: 128, workspace: 4096, path: 4096, method: 128, command: 8192 });

export function boundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

export function sessionRequest(value) {
  const sessionId = boundedString(value?.sessionId, MAX.sessionId);
  return sessionId ? { sessionId } : null;
}

export function workspaceRequest(value) {
  const workspace = boundedString(value?.workspace, MAX.workspace);
  return workspace ? { workspace } : null;
}

export function fileRequest(value) {
  const path = boundedString(value?.path, MAX.path);
  return path ? { path } : null;
}

export function replayRequest(value) {
  const sessionId = typeof value?.sessionId === "string" && value.sessionId.length <= MAX.sessionId ? value.sessionId : undefined;
  const after = Number.isFinite(value?.after) && value.after >= 0 ? value.after : 0;
  const limit = Number.isInteger(value?.limit) ? Math.max(1, Math.min(value.limit, 100)) : 100;
  return { sessionId, after, limit };
}

export function gitCommitRequest(value) {
  const message = boundedString(value?.message, 8_000);
  return message ? { message } : null;
}

export function gitStageRequest(value) {
  const snapshotToken = boundedString(value?.snapshotToken, 256);
  const items = Array.isArray(value?.items) ? value.items.slice(0, 500).filter((item) => boundedString(item?.path, MAX.path)).map((item) => ({ path: item.path, hunks: Array.isArray(item.hunks) ? item.hunks.slice(0, 200).map((hunk) => String(hunk).slice(0, 64_000)) : undefined })) : [];
  return snapshotToken && items.length ? { snapshotToken, items } : null;
}

export function customProviderRequest(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function sessionRpcRequest(value) {
  const sessionId = boundedString(value?.sessionId, MAX.sessionId);
  const method = boundedString(value?.method, MAX.method);
  if (!sessionId || !method) return null;
  return { sessionId, method, args: value?.args && typeof value.args === "object" && !Array.isArray(value.args) ? value.args : {} };
}
