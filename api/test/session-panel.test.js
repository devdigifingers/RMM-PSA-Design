import assert from "node:assert/strict";
import test from "node:test";
import {
  groupConsentFor,
  initials,
  isServerOs,
  nodeConsentFor,
  panelOptions,
  panelOptionsInput,
  panelReportFrom,
  panelSessionView,
  roleLabel,
  silentFor,
  supportEventFrom,
} from "../src/session-panel.js";

test("panel reports from the agent are cleaned", () => {
  assert.equal(panelReportFrom({}), null);
  assert.equal(panelReportFrom({ supportPanel: { state: "dancing" } }), null);
  assert.deepEqual(panelReportFrom({ supportPanel: { state: "ready" } }), { state: "ready" });
  assert.deepEqual(panelReportFrom({ supportPanel: { state: "failed", detail: "line one\nline two" } }), { state: "failed", detail: "line one line two" });
});

test("panel options fall back to the defaults", () => {
  assert.deepEqual(panelOptions(null), {
    enabled: false, showToTechnician: false, silentWorkstations: false, silentServers: true, phone: "", email: "",
  });
  assert.equal(panelOptions({ silentServers: false }).silentServers, false);
  assert.equal(panelOptions({ enabled: "yes" }).enabled, false);
});

test("panel option input is validated", () => {
  assert.equal(panelOptionsInput({ enabled: true }, {}).value.enabled, true);
  assert.equal(panelOptionsInput({ silentServers: false }, {}).value.silentServers, false);
  assert.equal(panelOptionsInput({ phone: "+27 21 555 0100" }, {}).value.phone, "+27 21 555 0100");
  assert.ok(panelOptionsInput({ phone: "call me" }, {}).error);
  assert.equal(panelOptionsInput({ email: "Help@Example.co.za" }, {}).value.email, "help@example.co.za");
  assert.ok(panelOptionsInput({ email: "nope" }, {}).error);
  assert.equal(panelOptionsInput({ phone: "" }, { phone: "+27 21 555 0100" }).value.phone, "");
});

test("servers are silent by default, workstations are not", () => {
  assert.equal(isServerOs("Windows Server 2022 Standard"), true);
  assert.equal(isServerOs("Windows 11 Pro"), false);
  assert.equal(silentFor({}, "Windows Server 2019"), true);
  assert.equal(silentFor({}, "Windows 10 Pro"), false);
  assert.equal(silentFor({ silentWorkstations: true }, "Windows 10 Pro"), true);
});

test("the strip stays unless the panel is turned on and ready", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const ready = { state: "ready", at: "2026-11-12T11:59:30Z" };
  assert.equal(nodeConsentFor({}, ready, now), 0);
  assert.equal(nodeConsentFor({ enabled: true }, ready, now), 0);
  assert.equal(nodeConsentFor({ enabled: true }, { state: "failed", at: ready.at }, now), 64);
  assert.equal(nodeConsentFor({ enabled: true }, { state: "ready", at: "2026-11-12T11:50:00Z" }, now), 64);
  assert.equal(nodeConsentFor({ enabled: true }, null, now), 64);
  assert.equal(groupConsentFor({ enabled: true }, 71), 7);
  assert.equal(groupConsentFor({}, 71), 71);
  assert.equal(groupConsentFor({}, 7), 71);
});

test("technician details for the panel", () => {
  assert.equal(initials("Shafiek Christian"), "SC");
  assert.equal(initials("Fiona"), "FI");
  assert.equal(initials("  "), "DF");
  assert.equal(roleLabel(["owner", "admin"]), "Owner");
  assert.equal(roleLabel(["admin"]), "Administrator");
  assert.equal(roleLabel([]), "Technician");
  const view = panelSessionView({
    id: "12", started_at: "2026-11-12T10:00:00Z", paused_at: null, tsid: 2,
    technician_name: "Shafiek Christian", technician_roles: ["admin"], org_name: "Digital Fingers",
    ticket_id: "1042", ticket_subject: "Printer offline",
  }, { showToTechnician: true });
  assert.deepEqual(view, {
    id: 12,
    startedAt: "2026-11-12T10:00:00.000Z",
    paused: false,
    tsid: 2,
    mode: "control",
    technician: { name: "Shafiek Christian", initials: "SC", role: "Administrator" },
    company: "Digital Fingers",
    ticket: { id: 1042, subject: "Printer offline" },
    showToTechnician: true,
  });
  assert.equal(panelSessionView(null, {}), null);
});

test("support events need a session for session actions", () => {
  assert.equal(supportEventFrom({ type: "session.end" }), null);
  assert.deepEqual(supportEventFrom({ type: "session.end", sessionId: 5 }), { type: "session.end", sessionId: 5 });
  assert.deepEqual(supportEventFrom({ type: "panel.failed", detail: "no\nruntime" }), { type: "panel.failed", sessionId: null, detail: "no runtime" });
  assert.equal(supportEventFrom({ type: "session.hack", sessionId: 5 }), null);
});
