import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { addressIdForFactAddress, normalizeFactAddress } from "../electron/histos-address.js";
import {
  convertGraphToFlowDraft,
  loadFlowSpec,
  persistValidatedFlowSpec,
  validateFlowSpec,
} from "../electron/flow-validation.js";

function makeAddress(sourceType, objectId, revisionId) {
  const address = normalizeFactAddress({ sourceType, objectId, revisionId });
  return { address, addressId: addressIdForFactAddress(address) };
}

function sampleGraph() {
  const addr1 = makeAddress("session_entry", "session-1/entry-1", "entry-1");
  const addr2 = makeAddress("tool", "session-1/call-1", "entry-1");
  return {
    schemaVersion: 1,
    workspaceId: "workspace-1",
    sourceSet: { sessionIds: ["session-1"] },
    lens: "structural",
    granularity: "entry",
    nodes: [
      { nodeRevisionId: "rev-node-1", nodeId: "entry:1", kind: "entry", title: "entry 1", createdAt: 1, artifactSha: null },
      { nodeRevisionId: "rev-node-2", nodeId: "tool:1", kind: "tool", title: "tool 1", createdAt: 2, artifactSha: null },
    ],
    edges: [
      { edgeRevisionId: "rev-edge-1", edgeId: "edge:1", srcNodeId: "entry:1", dstNodeId: "tool:1", kind: "contains", createdAt: 3, artifactSha: null },
    ],
    evidence: [
      { revisionId: "rev-node-1", addressId: addr1.addressId, role: "supports", address: addr1.address },
      { revisionId: "rev-node-2", addressId: addr2.addressId, role: "supports", address: addr2.address },
      { revisionId: "rev-edge-1", addressId: addr1.addressId, role: "supports", address: addr1.address },
    ],
    parents: [],
  };
}

test("convertGraphToFlowDraft builds flow_revision draft preserving evidence", () => {
  const draft = convertGraphToFlowDraft(sampleGraph(), { workspaceId: "workspace-1" });
  assert.equal(draft.kind, "flow_revision");
  assert.equal(draft.nodes.length, 2);
  assert.equal(draft.edges.length, 1);
  assert.equal(draft.evidence.length, 3);
});

test("validateFlowSpec rejects missing endpoints and unsupported kinds (fail-closed)", () => {
  const invalidDraft = {
    schemaVersion: 1,
    workspaceId: "workspace-1",
    kind: "flow_revision",
    sourceSet: { sessionIds: ["session-1"] },
    lens: "structural",
    granularity: "entry",
    nodes: [
      { nodeRevisionId: "rev-node-1", nodeId: "entry:1", kind: "unknown_kind", title: "entry 1", createdAt: 1, artifactSha: null },
    ],
    edges: [
      { edgeRevisionId: "rev-edge-1", edgeId: "edge:1", srcNodeId: "entry:1", dstNodeId: "missing:node", kind: "contains", createdAt: 2, artifactSha: null },
    ],
    evidence: [],
    parents: [],
  };
  const result = validateFlowSpec(invalidDraft, { workspaceId: "workspace-1" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes("unsupported node kind")));
  assert.ok(result.errors.some((err) => err.includes("missing destination node")));
});

test("persistValidatedFlowSpec writes durable artifact and loadFlowSpec revalidates", async (t) => {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-flow-test-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const draft = convertGraphToFlowDraft(sampleGraph(), { workspaceId: "workspace-1" });
  const persisted = await persistValidatedFlowSpec(root, draft, { workspaceId: "workspace-1" });
  assert.match(persisted.sha256, /^[0-9a-f]{64}$/);

  const loaded = await loadFlowSpec(root, persisted.sha256, { workspaceId: "workspace-1" });
  assert.equal(loaded.sha256, persisted.sha256);
  assert.equal(loaded.validation.ok, true);
  assert.equal(loaded.kind, "flow_revision");
});
