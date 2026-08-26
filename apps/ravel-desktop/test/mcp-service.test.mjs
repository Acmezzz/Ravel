import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listMcpRows,
  loadMcpBundle,
  mutateMcpFile,
  parseMcpConfig,
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  validateMcpArgs,
  validateMcpCommand,
  validateMcpName,
} from "../electron/mcp-service.js";

test("validation bounds mirror the design contract", () => {
  assert.equal(validateMcpName(" github-context "), "github-context");
  assert.throws(() => validateMcpName(""), { code: "invalid_args" });
  assert.throws(() => validateMcpName("-leading-dash"), { code: "invalid_args" });
  assert.throws(() => validateMcpName("has space"), { code: "invalid_args" });
  assert.throws(() => validateMcpName("x".repeat(65)), { code: "invalid_args" });

  assert.equal(validateMcpCommand(" npx -y @modelcontextprotocol/server-git "), "npx -y @modelcontextprotocol/server-git");
  assert.throws(() => validateMcpCommand("-evil-flag"), { code: "invalid_args" });
  assert.throws(() => validateMcpCommand("line1\nline2"), { code: "invalid_args" });
  assert.deepEqual(validateMcpArgs(undefined), []);
  assert.throws(() => validateMcpArgs(["ok", 42]), { code: "invalid_args" });
});

test("config transforms are pure and project rows shadow user rows", () => {
  let config = { mcpServers: {} };
  config = upsertMcpServer(config, { name: "a", command: "cmd-a", args: ["x"], enabled: false });
  config = upsertMcpServer(config, { name: "b", command: "cmd-b" });
  assert.deepEqual(Object.keys(config.mcpServers), ["a", "b"]);
  // Original untouched (pure).
  assert.deepEqual(config.mcpServers.a.enabled, false);

  const toggled = setMcpServerEnabled(config, "a", true);
  assert.equal(toggled.mcpServers.a.enabled, true);
  assert.equal(config.mcpServers.a.enabled, false);
  assert.throws(() => setMcpServerEnabled(config, "missing", true), { code: "not_found" });

  const removed = removeMcpServer(toggled, "a");
  assert.ok(!removed.mcpServers.a);
  assert.throws(() => removeMcpServer(removed, "a"), { code: "not_found" });

  const rows = listMcpRows({ mcpServers: { shared: { command: "u", enabled: true }, userOnly: { command: "u" } } }, { mcpServers: { shared: { command: "p", enabled: false } } });
  assert.deepEqual(
    rows.map((row) => `${row.name}:${row.scope}:${row.enabled}`),
    ["shared:project:false", "userOnly:user:true"],
  );
});

test("parse rejects malformed json and non-object payloads", () => {
  assert.deepEqual(parseMcpConfig("").mcpServers, {});
  assert.deepEqual(parseMcpConfig('{"mcpServers":{"x":{"command":"c"}}}').mcpServers.x.command, "c");
  assert.throws(() => parseMcpConfig("{broken"));
  assert.throws(() => parseMcpConfig("[1,2]"));
  assert.throws(() => parseMcpConfig('{"mcpServers":[]}'));
});

test("mutateMcpFile writes atomically under lock and reads back via loadMcpBundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "ravel-mcp-"));
  try {
    const userFile = join(dir, "user-mcp.json");
    const projectFile = join(dir, "project", ".ravel", "mcp.json");

    mutateMcpFile(userFile, (config) =>
      upsertMcpServer(config, { name: "fs-server", command: "node", args: ["server.js"] }),
    );
    const bundle = loadMcpBundle({ userFile, projectFile });
    assert.equal(bundle.user.mcpServers["fs-server"].command, "node");
    assert.equal(bundle.project, null);

    mutateMcpFile(projectFile, (config) =>
      upsertMcpServer(config, { name: "proj-server", command: "python", args: [], enabled: true }),
    );
    const after = loadMcpBundle({ userFile, projectFile });
    assert.equal(after.project.mcpServers["proj-server"].command, "python");
    // No temp or lock residue.
    assert.ok(!existsSync(`${userFile}.lock`));
    assert.ok(!existsSync(join(dir, `user-mcp.json.tmp-${process.pid}`)));

    // A stale lock directory is broken instead of blocking forever.
    mkdirSync(`${projectFile}.lock`, { recursive: true });
    writeFileSync(join(`${projectFile}.lock`, "owner.json"), JSON.stringify({ pid: 999999999, createdAt: 1 }));
    mutateMcpFile(projectFile, (config) => setMcpServerEnabled(config, "proj-server", false));
    assert.equal(loadMcpBundle({ userFile, projectFile }).project.mcpServers["proj-server"].enabled, false);

    // A live foreign lock refuses the write.
    mkdirSync(`${userFile}.lock`, { recursive: true });
    writeFileSync(join(`${userFile}.lock`, "owner.json"), JSON.stringify({ pid: process.pid + 424242, createdAt: Date.now() }));
    assert.throws(() => mutateMcpFile(userFile, (config) => setMcpServerEnabled(config, "fs-server", false)), { code: "busy" });
    rmSync(`${userFile}.lock`, { recursive: true, force: true });

    // Invalid JSON on disk surfaces as invalid_args, not a silent empty config.
    writeFileSync(projectFile, "{oops", "utf8");
    assert.throws(() => loadMcpBundle({ userFile, projectFile }), { code: "invalid_args" });
    assert.ok(readFileSync(userFile, "utf8").includes('"fs-server"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
