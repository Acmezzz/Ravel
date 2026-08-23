/**
 * Desktop project trust — wraps Pi's ProjectTrustStore so the renderer can
 * decide Trust once / always / never through a dialog instead of `/trust`.
 *
 * Untrusted projects still open, but project-local extensions/skills/prompts
 * stay dormant. Omega's own additionalExtensionPaths are not gated here.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");
const DECISIONS = new Set(["once", "always", "never"]);

function keyOf(root) {
  const value = resolve(root);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function createProjectTrust(agentDir = DEFAULT_AGENT_DIR) {
  const store = new ProjectTrustStore(agentDir);
  /** Session-only overrides; not written to trust.json. */
  const sessionOnly = new Map();

  function inspect(cwd) {
    const requiresTrust = hasTrustRequiringProjectResources(cwd);
    const saved = store.get(cwd);
    const session = sessionOnly.get(keyOf(cwd));
    let decision = "undecided";
    if (session === true || saved === true) decision = "trusted";
    else if (session === false || saved === false) decision = "untrusted";
    if (!requiresTrust && decision === "undecided") decision = "trusted";
    return {
      cwd,
      requiresTrust,
      decision,
      saved: saved === true ? "trusted" : saved === false ? "untrusted" : "undecided",
      sessionOnly: session !== undefined,
      resourcesDormant: requiresTrust && decision !== "trusted",
    };
  }

  function decide(cwd, choice) {
    if (!DECISIONS.has(choice)) {
      const error = new Error("Trust decision must be once, always, or never");
      error.code = "invalid_args";
      throw error;
    }
    const k = keyOf(cwd);
    if (choice === "always") {
      store.set(cwd, true);
      sessionOnly.delete(k);
    } else if (choice === "never") {
      store.set(cwd, false);
      sessionOnly.delete(k);
    } else {
      sessionOnly.set(k, true);
    }
    return inspect(cwd);
  }

  function isTrusted(cwd) {
    return inspect(cwd).decision === "trusted";
  }

  return { inspect, decide, isTrusted };
}

export const projectTrust = createProjectTrust();
