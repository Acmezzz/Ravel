/**
 * Aggregated IPC client surface.
 *
 * This module keeps the single `ipc` export that every renderer caller relies
 * on (`import { ipc } from "../ipc/client"` then `ipc.xxx(...)`). The concrete
 * method implementations now live in per-domain modules in this directory
 * (agent/session/workspace/git/pty/histos); each is spread into the `ipc`
 * object below so no caller-facing name changes and nothing is left dangling.
 *
 * `RavelBridge` describes the narrow `window.omega` preload bridge and stays
 * here as the single source of truth for its shape. `ok`/`unwrap` helpers are
 * shared via `./utils` (re-exported from here for backward compatibility).
 */
import type { RavelBridge } from "./utils";

import { agentClient } from "./agent-client";
import { sessionClient } from "./session-client";
import { workspaceClient } from "./workspace-client";
import { gitClient } from "./git-client";
import { ptyClient } from "./pty-client";
import { histosClient } from "./histos-client";

export type { RavelBridge };
export type { PromptSessionReference } from "./utils";
export { ok, unwrap } from "./utils";

/** Thin wrapper around the narrow, validated `window.omega` preload bridge. */
export const ipc = {
  ...agentClient,
  ...sessionClient,
  ...workspaceClient,
  ...gitClient,
  ...ptyClient,
  ...histosClient,
};

export type Ipc = typeof ipc;