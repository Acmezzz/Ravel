/**
 * Ravel MCP bridge — first-party execution bridge for MCP servers.
 *
 * Reads Ravel-owned definitions (~/.ravel/mcp.json plus <workspace>/.ravel/mcp.json,
 * project shadowing user by name), connects only `enabled` servers — stdio
 * ({command, args}) or streamable-HTTP ({url, headers?}) — performs the MCP
 * initialize handshake, and registers every remote tool through pi's native
 * pipeline as `mcp__<server>__<tool>`.
 *
 * Because tools flow through pi's own tool lifecycle, permission profiles,
 * approval facts, tool cards and risk tiering apply unchanged: an untrusted
 * profile rejects them outright, ask-before-command records durable decisions.
 *
 * Header values of the form "$cred:<id>" resolve against the desktop
 * credential vault (injected by the agent worker as globalThis.__ravelMcpCredentials);
 * the secret never appears in any config file.
 *
 * Failure policy is per-server and non-blocking: one broken server never stops
 * the others or the session. Startup is capped at 10s per server.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CALL_TIMEOUT_MS, HttpPeer, PROTOCOL_VERSION, STARTUP_TIMEOUT_MS, StdioPeer, type JsonRpcResult } from "./transport.ts";

const MAX_SERVERS = 32;
const NAME_SAFE = /^[A-Za-z0-9_-]+$/;

interface McpServerDef {
	command?: string;
	args?: string[];
	url?: string;
	headers?: Record<string, string>;
	auth?: { authorizationUrl?: string; tokenUrl?: string; clientId?: string };
	enabled?: boolean;
}

type Peer = StdioPeer | HttpPeer;

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

function openPeer(def: McpServerDef, onNotify: (notification: JsonRpcResult) => void, headers: Record<string, string>): Peer {
	if (def.url) return new HttpPeer(def.url, headers, onNotify);
	return new StdioPeer(def.command!, def.args ?? [], onNotify);
}

export default function ravelMcpBridge(pi: ExtensionAPI) {
	const peers = new Map<string, Peer>();

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
				if (def.url ? !/^https?:\/\//.test(def.url) : !def.command) continue;
				// OAuth login (B5): the desktop vault stores the access token under
				// mcp:<name>; header values with "$cred:" resolve at connect time.
				const headers = { ...(def.headers ?? {}) };
				if (def.auth && !headers.Authorization) headers.Authorization = `Bearer $cred:mcp:${name}`;
				const peer = openPeer(def, () => {}, headers);
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
					await peer.notify("notifications/initialized", {});
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
	peers: Map<string, Peer>,
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
