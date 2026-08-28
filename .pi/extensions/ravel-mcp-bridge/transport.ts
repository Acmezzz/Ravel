/**
 * MCP transport peers for the Ravel bridge (first-party, zero-dependency).
 *
 * StdioPeer: newline-delimited JSON-RPC over a spawned child process.
 * HttpPeer: MCP streamable-HTTP transport (POST JSON-RPC; response is either
 * a JSON body or an SSE stream carrying the matching message). The legacy
 * 2024 SSE transport (GET /sse + POST endpoint) is deprecated by the spec
 * and intentionally not implemented — add it when a real server needs it.
 *
 * Both expose the same surface: request(method, params, timeoutMs), notify(),
 * stop(). Header values of the form "$cred:<id>" are resolved against
 * globalThis.__ravelMcpCredentials (injected by the agent worker from the
 * desktop credential vault); an unresolvable reference fails the server at
 * startup rather than sending an unauthenticated call.
 */
import { spawn } from "node:child_process";

export const PROTOCOL_VERSION = "2024-11-05";
export const STARTUP_TIMEOUT_MS = 10_000;
export const CALL_TIMEOUT_MS = 120_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

export interface JsonRpcResult {
  [key: string]: unknown;
}

export function resolveHeaderValues(headers: Record<string, string>): Record<string, string> {
  const vault = (globalThis as { __ravelMcpCredentials?: Record<string, string> }).__ravelMcpCredentials ?? {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string" && value.startsWith("$cred:")) {
      const secret = vault[value.slice(6)];
      if (typeof secret !== "string" || !secret) {
        throw Object.assign(new Error(`MCP credential "${value.slice(6)}" is not configured`), { code: "credential_missing" });
      }
      resolved[key] = secret;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

export class StdioPeer {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: JsonRpcResult) => void; reject: (error: Error) => void }>();
  private buffer = "";
  private readonly child: ReturnType<typeof spawn>;

  constructor(command: string, args: string[], onNotify: (notification: JsonRpcResult) => void) {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as { id?: unknown; error?: { message?: unknown }; result?: JsonRpcResult; method?: unknown };
          if (typeof message.id === "number" && this.pending.has(message.id)) {
            const entry = this.pending.get(message.id)!;
            this.pending.delete(message.id);
            if (message.error) entry.reject(new Error(String(message.error.message ?? "MCP error")));
            else entry.resolve(message.result ?? {});
          } else if (message.method) {
            onNotify(message as JsonRpcResult);
          }
        } catch {
          // Malformed line from a third-party server: drop, keep the stream alive.
        }
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => {}); // drained; server logs never enter the transcript
    this.child.on("exit", () => {
      for (const [, entry] of this.pending) entry.reject(new Error("MCP server exited"));
      this.pending.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResult> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(payload);
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  stop(): void {
    try {
      this.child.kill();
    } catch {
      /* best effort */
    }
  }
}

/** Extract the JSON-RPC result carrying `id` from one SSE body; null when absent. */
function parseSseForId(body: string, id: number): JsonRpcResult | null {
  for (const event of body.split("\n\n")) {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      let message: { id?: unknown; error?: { message?: unknown }; result?: JsonRpcResult };
      try {
        message = JSON.parse(data) as { id?: unknown; error?: { message?: unknown }; result?: JsonRpcResult };
      } catch {
        continue; // malformed event: keep scanning
      }
      if (message.id === id) {
        if (message.error) throw new Error(String(message.error.message ?? "MCP error"));
        return message.result ?? {};
      }
    }
  }
  return null;
}

interface HttpResponse {
  status: number;
  contentType: string;
  text: string;
  sessionHeader: string | null;
}

export class HttpPeer {
  private nextId = 1;
  private sessionId: string | null = null;
  private closed = false;
  private readonly headers: Record<string, string>;
  private readonly onNotify: (notification: JsonRpcResult) => void;
  readonly url: string;

  constructor(url: string, headers: Record<string, string>, onNotify: (notification: JsonRpcResult) => void) {
    this.url = url;
    this.headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...resolveHeaderValues(headers) };
    this.onNotify = onNotify;
  }

  private async post(message: unknown, timeoutMs: number): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { ...this.headers, ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}) },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (response.status === 202) return { status: 202, contentType: "", text: "", sessionHeader: response.headers.get("mcp-session-id") };
      const contentType = String(response.headers.get("content-type") ?? "");
      const text = (await response.text()).slice(0, MAX_JSON_BYTES);
      return { status: response.status, contentType, text, sessionHeader: response.headers.get("mcp-session-id") };
    } finally {
      clearTimeout(timer);
    }
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResult> {
    if (this.closed) throw new Error("MCP server connection is closed");
    const id = this.nextId++;
    const { status, contentType, text, sessionHeader } = await this.post({ jsonrpc: "2.0", id, method, params }, timeoutMs);
    if (sessionHeader) this.sessionId = sessionHeader;
    if (status < 200 || status >= 300) {
      throw new Error(`MCP ${method} failed with HTTP ${status}`);
    }
    if (contentType.includes("text/event-stream")) {
      const result = parseSseForId(text, id);
      if (result === null) throw new Error(`MCP ${method}: SSE response carried no matching message`);
      return result;
    }
    if (!text.trim()) return {};
    let message: { error?: { message?: unknown }; result?: JsonRpcResult };
    try {
      message = JSON.parse(text) as { error?: { message?: unknown }; result?: JsonRpcResult };
    } catch {
      throw new Error(`MCP ${method}: response is not valid JSON`);
    }
    if (message.error) throw new Error(String(message.error.message ?? "MCP error"));
    return message.result ?? {};
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params }, CALL_TIMEOUT_MS);
  }

  stop(): void {
    this.closed = true;
    // ponytail: no DELETE session close; servers reap idle sessions.
  }
}
