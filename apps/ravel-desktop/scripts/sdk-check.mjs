/**
 * Minimal SDK smoke test (route-1 foundation).
 * Verifies: createAgentSession instantiates with the generic extensions root,
 * and a trivial prompt round-trips — all in a plain Node process.
 * Run from ravel-desktop:  npm run sdk-check
 */
import {
	createAgentSession,
	DefaultResourceLoader,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { toRendererEvent } from "../electron/agent-bridge.js";
import { homedir } from "node:os";
import { join } from "node:path";

const agentDir = join(homedir(), ".pi", "agent");
const cwd = process.cwd();

async function main() {
	const projected = toRendererEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "offline" } });
	if (!projected.some((event) => event?.assistantMessageEvent?.type === "text_delta")) throw new Error("offline event projection failed");
	console.log("[sdk-check] offline event projection: PASS");
	if (process.env.RAVEL_LIVE_PROVIDER !== "1") {
		console.log("[sdk-check] live prompt: SKIPPED (set RAVEL_LIVE_PROVIDER=1 to require provider/network smoke)");
		return;
	}
	console.log("[sdk-check] agentDir =", agentDir);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.create(cwd, agentDir),
	});
	await resourceLoader.reload();

	const { session, extensionsResult } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		tools: ["read", "bash"],
	});

	const extNames = extensionsResult.extensions.map((e) => {
		const segs = e.path.split(/[\\/]/).filter(Boolean);
		return segs.at(-2) && segs.at(-1) === "index.ts" ? segs.at(-2) : segs.at(-1);
	}).filter(Boolean);
	const errors = extensionsResult.errors.map((e) => `${e.path}: ${e.error}`);
	console.log("[sdk-check] loaded extensions:", extNames.length ? extNames.join(", ") : "(none)");
	console.log("[sdk-check] extension errors:", errors.length ? errors.join(" | ") : "(none)");

	try {
		let gotDelta = false;
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				gotDelta = true;
			}
		});
		await session.prompt("Reply with exactly: ok");
		console.log(`[sdk-check] prompt round-trip streamed text: ${gotDelta ? "YES" : "NO"}`);
		if (!gotDelta) throw new Error("prompt round-trip produced no text_delta");
	} catch (err) {
		console.error("[sdk-check] prompt round-trip failed:", err?.message ?? String(err));
		throw err;
	}

	if (errors.length > 0) throw new Error("SDK smoke assertions failed");
	session.dispose();
	process.exit(0);
}

main().catch((err) => {
	console.error("[sdk-check] FAILED:", err);
	process.exit(1);
});
