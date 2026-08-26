/**
 * Ravel MCP bridge — first-party execution bridge for local stdio MCP servers.
 *
 * Reads Ravel-owned definitions (~/.ravel/mcp.json plus <workspace>/.ravel/mcp.json,
 * project shadowing user by name), spawns only `enabled` servers, performs the
 * MCP initialize handshake over newline-delimited JSON-RPC, and registers every
 * remote tool through pi's native pipeline as `mcp__<server>__<tool>`.
 *
 * Because tools flow through pi's own tool lifecycle, permission profiles,
 * approval facts, tool cards and risk tiering apply unchanged: an untrusted
 * profile rejects them outright, ask-before-command records durable decisions.
 *
 * Failure policy is per-server and non-blocking: one broken server never stops
 * the others or the session. Startup is capped at 10s per server.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROTOCOL_VERSION = "2024-11-05";
const STARTUP_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_SERVERS = 32;
const NAME_SAFE = /^[A-Za-z0-9_-]+$/;

interface McpServerDef {
	command: string;
	args?: string[];
	enabled?: boolean;
}

function readConfig(file: string): Record<string, McpServerDef> {
	if (!existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: unknown };
		const servers = parsed?.mcpServers;
		return servers && typeof servers === "object" && !Array.isArray(servers) ? (servers as Record<string, McpServerDef>) : {};
	} catch {
		return {}; // A malformed definition file disables bridging instead of crashing the session.
	}
}

function sanitizeSegment(input: string): string {
	const cleaned = input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return cleaned || "x";
}

/** Minimal JSON-RPC peer over stdio: pending-request map plus notification sink. */
interface JsonRpcResult {
	[key: string]: unknown;
}

class StdioPeer {
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (value: JsonRpcResult) => void; reject: (error: Error) => void }>();
	private buffer = "";
	private readonly child;

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

export default function ravelMcpBridge(pi: ExtensionAPI) {
	const peers = new Map<string, StdioPeer>();

	pi.on("session_start", (_event, ctx) => {
		void (async () => {
			const cwd = process.cwd();
			const user = readConfig(join(homedir(), ".ravel", "mcp.json"));
			const project = readConfig(join(cwd, ".ravel", "mcp.json"));
			const names = [...new Set([...Object.keys(project), ...Object.keys(user)])]
				.filter((name) => (project[name] ?? user[name]).enabled !== false)
				.slice(0, MAX_SERVERS);

			let totalTools = 0;
			let failed = 0;
			for (const name of names) {
				const def = (project[name] ?? user[name])!;
				if (!NAME_SAFE.test(sanitizeSegment(name))) continue;
				const peer = new StdioPeer(def.command, def.args ?? [], () => {});
				peers.set(name, peer);
				try {
					await peer.request(
						"initialize",
						{
							protocolVersion: PROTOCOL_VERSION,
							capabilities: {},
							clientInfo: { name: "ravel-desktop", version: "1.0.0" },
						},
						STARTUP_TIMEOUT_MS,
					);
					peer.notify("notifications/initialized", {});
					const listing = await peer.request("tools/list", {}, STARTUP_TIMEOUT_MS);
					const tools: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }> = Array.isArray(listing?.tools)
						? (listing.tools as Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>)
						: [];
					for (const tool of tools.slice(0, 64)) {
						if (typeof tool.name !== "string" || !tool.name.trim()) continue;
						registerRemoteTool(pi, peers, name, sanitizeSegment(name), tool);
						totalTools += 1;
					}
				} catch (error) {
					failed += 1;
					peer.stop();
					peers.delete(name);
					ctx.ui.notify(`MCP ${name} 启动失败：${error instanceof Error ? error.message : String(error)}`, "warning");
				}
			}
			if (totalTools > 0) ctx.ui.notify(`Ravel MCP 桥已加载 ${totalTools} 个工具`, "info");
			else if (failed === 0 && names.length > 0) ctx.ui.notify("Ravel MCP 桥未发现可用工具", "info");
		})();
	});

	pi.on("session_shutdown", () => {
		for (const peer of peers.values()) peer.stop();
		peers.clear();
	});
}

function registerRemoteTool(
	pi: ExtensionAPI,
	peers: Map<string, StdioPeer>,
	serverName: string,
	serverSegment: string,
	tool: { name?: string; description?: string; inputSchema?: Record<string, unknown> },
): void {
	const toolName = `mcp__${serverSegment}__${sanitizeSegment(tool.name!)}`;
	const rawSchema = tool.inputSchema;
	const schema =
		rawSchema && rawSchema.type === "object"
			? rawSchema
			: ({ type: "object", properties: {}, required: [] } as Record<string, unknown>);
	pi.registerTool({
		name: toolName,
		label: `${serverName}: ${tool.name}`,
		description: tool.description ?? `Tool ${tool.name} from MCP server ${serverName}`,
		promptSnippet: `[MCP:${serverName}] ${tool.description ?? tool.name}`.slice(0, 200),
		parameters: schema,
		async execute(_toolCallId: string, params: unknown) {
			const peer = peers.get(serverName);
			if (!peer) throw new Error(`MCP server ${serverName} is not running`);
			const result = await peer.request("tools/call", { name: tool.name, arguments: params ?? {} }, CALL_TIMEOUT_MS);
			const content: Array<{ type?: string; text?: string }> = Array.isArray(result?.content) ? result.content : [];
			const text = content
				.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
				.filter(Boolean)
				.join("\n") || "(empty MCP result)";
			return {
				content: [{ type: "text", text }],
				details: { mcpServer: serverName, mcpTool: tool.name, isError: result?.isError === true },
				...(result?.isError === true ? { isError: true } : {}),
			};
		},
	});
}
