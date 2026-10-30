import assert from "node:assert/strict";
import test from "node:test";
import { remoteAgentChange, remoteAgentFrom, remoteAgentOffer, remoteAgentView } from "../src/remote-agent.js";

test("heartbeat remote agent reports are cleaned", () => {
  assert.equal(remoteAgentFrom({}), null);
  assert.equal(remoteAgentFrom({ remoteAgent: { state: "exploded" } }), null);
  assert.deepEqual(remoteAgentFrom({ remoteAgent: { state: "blocked", detail: "line one\nline two" } }), { state: "blocked", detail: "line one line two" });
  assert.deepEqual(remoteAgentFrom({ remoteAgent: { state: "running", repairedAt: "2026-10-30T12:00:00Z" } }), { state: "running", repairedAt: "2026-10-30T12:00:00.000Z" });
});

test("the install hash is offered only when the remote agent has to be installed", () => {
  const release = { sha256: "a".repeat(64) };
  assert.deepEqual(remoteAgentOffer({ state: "missing" }, release), { sha256: release.sha256 });
  assert.deepEqual(remoteAgentOffer({ state: "blocked" }, release), { sha256: release.sha256 });
  assert.equal(remoteAgentOffer({ state: "running" }, release), null);
  assert.equal(remoteAgentOffer({ state: "missing" }, null), null);
});

test("only meaningful state changes are audited", () => {
  assert.equal(remoteAgentChange(null, { state: "running" }), null);
  assert.equal(remoteAgentChange({ state: "running" }, { state: "running" }), null);
  assert.equal(remoteAgentChange({ state: "running" }, { state: "missing" }), "device.remote_agent_missing");
  assert.equal(remoteAgentChange({ state: "missing" }, { state: "repairing" }), null);
  assert.equal(remoteAgentChange({ state: "repairing" }, { state: "running" }), "device.remote_agent_ok");
  assert.equal(remoteAgentChange({ state: "repairing" }, { state: "blocked" }), "device.remote_agent_blocked");
  assert.equal(remoteAgentChange({ state: "running" }, null), null);
});

test("the device list shows a message unless remote support is running", () => {
  assert.equal(remoteAgentView(null), null);
  assert.equal(remoteAgentView({ state: "running" }).ok, true);
  assert.match(remoteAgentView({ state: "blocked" }).message, /antivirus/);
});
