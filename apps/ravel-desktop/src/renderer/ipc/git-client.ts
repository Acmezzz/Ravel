import type {
  IpcResult,
  GitSnapshot,
  GitApplyResult,
  GitStageItem,
  GitWorktreeList,
  ChangeApprovalResult,
} from "../types/dto";
import { ok } from "./utils";

/** Git snapshot, staging, commit, worktrees, and diff approval. */
export const gitClient = {
  gitSnapshot: async (): Promise<IpcResult<GitSnapshot>> => ok(await window.omega?.gitSnapshot?.()),
  gitStage: async (req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>> => ok(await window.omega?.gitStage?.(req)),
  gitUnstage: async (req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>> => ok(await window.omega?.gitUnstage?.(req)),
  gitCommit: async (req: { message: string }): Promise<IpcResult<{ hash: string }>> => ok(await window.omega?.gitCommit?.(req)),
  listWorktrees: async (): Promise<IpcResult<GitWorktreeList>> => ok(await window.omega?.listWorktrees?.()),
  addWorktree: async (req?: { path?: string; branch?: string; createBranch?: boolean }): Promise<IpcResult<GitWorktreeList>> =>
    ok(await window.omega?.addWorktree?.(req)),
  removeWorktree: async (req: { path: string; force?: boolean }): Promise<IpcResult<GitWorktreeList>> =>
    ok(await window.omega?.removeWorktree?.(req)),
  approveChange: async (req: {
    action: "accept" | "reject";
    snapshotToken?: string;
    files?: string[];
    items?: GitStageItem[];
  }): Promise<IpcResult<ChangeApprovalResult>> => ok(await window.omega?.approveChange?.(req)),
};

export type GitClient = typeof gitClient;