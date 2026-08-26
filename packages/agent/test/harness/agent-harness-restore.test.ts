import { createModels, type Usage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
	AgentHarness,
	HarnessClosed,
	HarnessNotImplemented,
	MissingIdentities,
	NothingToResume,
} from "../../src/harness/agent-harness.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { RecordLogCorruption } from "../../src/harness/reducer.ts";
import {
	InMemorySessionStorage,
	JsonlSessionRepo,
	type NewRecord,
	type OperationStartedRecord,
	Session,
} from "../../src/harness/session/index.ts";
import type { AgentMessage } from "../../src/types.ts";
import { createTempDir } from "./session-test-utils.ts";

const usage: Usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const prompt: AgentMessage[] = [
	{
		role: "user",
		content: [{ type: "text", text: "continue" }],
		timestamp: 1,
	},
];

function memorySession(id = "session"): Session {
	return new Session(new InMemorySessionStorage({ id, createdAt: 1 }));
}

function runStarted(
	overrides: Partial<NewRecord<OperationStartedRecord>> & {
		originalPrompt?: AgentMessage[];
	} = {},
): NewRecord<OperationStartedRecord> {
	const { originalPrompt = prompt, ...rest } = overrides;
	return {
		type: "operation_started",
		id: "run",
		lane: "main",
		sourceLeafId: null,
		intent: { kind: "run", originalPrompt, initialMessages: [] },
		...rest,
	};
}

function createOptions(session: Session, extras: Partial<Parameters<typeof AgentHarness.create>[0]> = {}) {
	return {
		session,
		models: createModels(),
		model: getModel("google", "gemini-2.5-flash"),
		...extras,
	};
}

describe("AgentHarness restore", () => {
	it("restores an open in-memory run as a crash-suspended operation", async () => {
		const session = memorySession("recorded");
		await session.appendRecord(runStarted());

		const { harness, suspended } = await AgentHarness.create(createOptions(session));

		expect(suspended).toHaveLength(1);
		expect(suspended[0]).toMatchObject({
			lane: "main",
			kind: "run",
			id: "run",
			reason: "crash",
			missing: { tools: [], models: [] },
		});
		expect(suspended[0].prompt).toEqual(prompt);
		await expect(harness.resume()).rejects.toMatchObject({
			name: "HarnessNotImplemented",
			operation: "resume.execute",
		});
	});

	it("restores an open JSONL run after the repository is reopened", async () => {
		const root = createTempDir();
		const repository = new JsonlSessionRepo({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: root,
		});
		const created = await repository.create({ id: "jsonl-restore", cwd: root });
		await created.appendRecord(runStarted());
		const metadata = await created.getMetadata();

		const reopened = await new JsonlSessionRepo({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: root,
		}).open(metadata);
		const { suspended } = await AgentHarness.create(createOptions(reopened));

		expect(suspended).toHaveLength(1);
		expect(suspended[0]).toMatchObject({
			lane: "main",
			kind: "run",
			id: "run",
			reason: "crash",
		});
		expect(suspended[0].prompt).toEqual(prompt);
	});

	it("does not suspend a finished operation after reopen", async () => {
		const session = memorySession("finished");
		await session.appendRecord(runStarted());
		await session.appendRecord({
			type: "operation_finished",
			id: "finish",
			lane: "main",
			runId: "run",
			outcome: "completed",
		});

		const { harness, suspended } = await AgentHarness.create(createOptions(session));

		expect(suspended).toEqual([]);
		await expect(harness.resume()).rejects.toBeInstanceOf(NothingToResume);
	});

	it("maps a deferred assistant entry to a deferred suspended operation", async () => {
		const session = memorySession("deferred");
		const started = await session.appendRecord(runStarted());
		await session.appendEntry(
			{
				type: "message",
				id: "assistant-deferred",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "wait" }],
					api: "openai-responses",
					provider: "openai",
					model: "test-model",
					usage,
					stopReason: "deferred",
					timestamp: started.timestamp + 1,
					deferred: {
						provider: "openai",
						modelId: "test-model",
						api: "openai-responses",
						id: "deferred-1",
					},
				},
			},
			"main",
		);

		const { suspended } = await AgentHarness.create(createOptions(session));

		expect(suspended).toHaveLength(1);
		expect(suspended[0]).toMatchObject({
			reason: "deferred",
			deferred: { provider: "openai", modelId: "test-model", api: "openai-responses", id: "deferred-1" },
		});
	});

	it("rejects reducer corruption without mutating the session", async () => {
		const session = memorySession("corrupt");
		await session.appendRecord(runStarted());
		await session.appendRecord({
			type: "operation_finished",
			id: "finish",
			lane: "main",
			runId: "run",
			outcome: "completed",
		});
		await session.appendRecord({ type: "abort_requested", id: "abort", lane: "main", runId: "run" });
		const before = await session.findRecords({ lane: "main", order: "oldestFirst" });

		await expect(AgentHarness.create(createOptions(session))).rejects.toBeInstanceOf(RecordLogCorruption);
		await expect(AgentHarness.create(createOptions(session))).rejects.toMatchObject({
			reason: "record_after_finish",
		});
		expect(await session.findRecords({ lane: "main", order: "oldestFirst" })).toEqual(before);
	});

	it("keeps own entries bounded to the operation and reads configuration from the anchor", async () => {
		const session = memorySession("bounded");
		const prior = await session.appendEntry(
			{
				type: "model_change",
				id: "prior-model",
				provider: "google",
				modelId: "gemini-2.5-flash",
			},
			"main",
		);
		const started = await session.appendRecord(runStarted({ sourceLeafId: prior.id }));
		await session.appendEntry(
			{
				type: "active_tools_change",
				id: "operation-tools",
				activeToolNames: [],
			},
			"main",
		);
		await session.appendEntry(
			{
				type: "message",
				id: "assistant-owned",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "owned" }],
					api: "openai-responses",
					provider: "openai",
					model: "owned-model",
					usage,
					stopReason: "stop",
					timestamp: started.timestamp + 1,
				},
			},
			"main",
		);

		const { suspended } = await AgentHarness.create(createOptions(session));
		expect(suspended).toHaveLength(1);
		expect(suspended[0].missing).toEqual({ tools: [], models: ["openai/owned-model"] });
	});

	it("returns MissingIdentities when the recovered active tool is unavailable", async () => {
		const session = memorySession("missing-tool");
		await session.appendRecord(runStarted());
		const { harness, suspended } = await AgentHarness.create(
			createOptions(session, { activeToolNames: ["missing-tool"] }),
		);

		expect(suspended[0]?.missing).toEqual({ tools: ["missing-tool"], models: [] });
		await expect(harness.resume()).rejects.toBeInstanceOf(MissingIdentities);
		await expect(harness.resume()).rejects.toMatchObject({
			tools: ["missing-tool"],
			models: [],
		});
	});

	it("returns HarnessClosed for resume after close", async () => {
		const session = memorySession("closed");
		await session.appendRecord(runStarted());
		const { harness } = await AgentHarness.create(createOptions(session));
		await harness.close();
		await expect(harness.resume()).rejects.toBeInstanceOf(HarnessClosed);
	});

	it("returns NothingToResume for an idle session", async () => {
		const { harness, suspended } = await AgentHarness.create(createOptions(memorySession("idle")));
		expect(suspended).toEqual([]);
		await expect(harness.resume()).rejects.toBeInstanceOf(NothingToResume);
	});

	it("does not treat resume.execute as a successful outcome", async () => {
		const session = memorySession("execute-missing");
		await session.appendRecord(runStarted());
		const { harness } = await AgentHarness.create(createOptions(session));
		await expect(harness.resume()).rejects.toBeInstanceOf(HarnessNotImplemented);
	});
});
