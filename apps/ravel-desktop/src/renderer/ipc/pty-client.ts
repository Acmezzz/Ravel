import type { IpcResult, PtyDataDTO, PtyExitDTO } from "../types/dto";
import { ok } from "./utils";

/** Interactive terminal (PTY) channel: create/write/resize/kill + push events. */
export const ptyClient = {
  ptyCreate: async (req: { sessionId: string; cwd: string; cols?: number; rows?: number }): Promise<IpcResult<{ sessionId: string }>> => ok(await window.omega?.ptyCreate?.(req)),
  ptyWrite: async (req: { sessionId: string; data: string }): Promise<IpcResult<void>> => ok(await window.omega?.ptyWrite?.(req)),
  ptyResize: async (req: { sessionId: string; cols: number; rows: number }): Promise<IpcResult<void>> => ok(await window.omega?.ptyResize?.(req)),
  ptyKill: async (req: { sessionId: string }): Promise<IpcResult<void>> => ok(await window.omega?.ptyKill?.(req)),
  onPtyData: (callback: (data: PtyDataDTO) => void): (() => void) => window.omega?.onPtyData?.(callback) ?? (() => {}),
  onPtyExit: (callback: (data: PtyExitDTO) => void): (() => void) => window.omega?.onPtyExit?.(callback) ?? (() => {}),
};

export type PtyClient = typeof ptyClient;