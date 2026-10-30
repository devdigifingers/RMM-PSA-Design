import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IsolationError,
  approvalSummary,
  buildPlan,
  defaultSchedule,
  eligibleRoles,
  isExpired,
  parseRequestInput,
  purgeDue,
  renamed,
  requestFingerprint,
  rollbackOpen,
  significantChange,
} from "../src/migration-plan.js";

const SOURCE = 1;
const TARGET = 2;

function sides() {
  return {
    source: {
      customers: [
        { id: 10, org_id: SOURCE, name: "Acme" },
        { id: 11, org_id: SOURCE, name: "Beta Ltd" },
        { id: 12, org_id: SOURCE, name: "Gamma" },
      ],
      contacts: [
        { id: 20, org_id: SOURCE, customer_id: 10, name: "Ann", email: "ann@acme.test" },
        { id: 21, org_id: SOURCE, customer_id: 11, name: "Ben", email: "ben@beta.test" },
        { id: 22, org_id: SOURCE, customer_id: 12, name: "Gus", email: null },
      ],
      sites: [
        { id: 30, org_id: SOURCE, customer_id: 10, name: "Main" },
        { id: 31, org_id: SOURCE, customer_id: 11, name: "Main" },
      ],
      devices: [
        { id: 40, org_id: SOURCE, site_id: 30, hostname: "ACME-PC1" },
        { id: 41, org_id: SOURCE, site_id: 31, hostname: "SHARED-NAME" },
      ],
      tickets: [
        { id: 50, org_id: SOURCE, customer_id: 10, comments: 2, events: 5, attachments: 1, time_entries: 1 },
        { id: 51, org_id: SOURCE, customer_id: 11, comments: 1, events: 2, attachments: 0, time_entries: 0 },
        { id: 52, org_id: SOURCE, customer_id: 12, comments: 0, events: 1, attachments: 0, time_entries: 0 },
      ],
      slaPlans: [{ id: 60, org_id: SOURCE, name: "Gold" }],
      users: [{ id: 70, org_id: SOURCE, name: "Tech One", email: "tech@source.test" }],
      settings: { categories: ["Network", "Printers"], tags: [], cannedReplies: [], holidays: [] },
    },
    target: {
      customers: [{ id: 110, org_id: TARGET, name: "beta ltd" }],
      contacts: [{ id: 120, org_id: TARGET, email: "ANN@acme.test" }],
      devices: [{ id: 140, org_id: TARGET, hostname: "shared-name" }],
      slaPlans: [{ id: 160, org_id: TARGET, name: "gold" }],
      settings: { categories: ["network"], tags: [], cannedReplies: [], holidays: [] },
    },
  };
}

const LICENSED = { active: true, features: ["ticketing", "enrollment"], devicesLeft: 100 };

function plan(overrides = {}, license = LICENSED) {
  const { source, target } = sides();
  return buildPlan({
    request: {
      sourceId: SOURCE,
      targetId: TARGET,
      mode: "move",
      scope: { customers: true, tickets: true, devices: true, settings: true, users: false, customerIds: null },
      resolutions: {},
      acknowledged: [],
      ...overrides,
    },
    source,
    target,
    sourceLicense: { active: true },
    targetLicense: license,
    names: { source: "Source", target: "Target" },
  });
}

test("input parsing rejects the same tenant and orphaned tickets", () => {
  assert.match(parseRequestInput({ sourceId: 1, targetId: 1, mode: "copy", scope: { customers: true } }).error, /different/);
  assert.match(parseRequestInput({ sourceId: 1, targetId: 2, mode: "copy", scope: { tickets: true } }).error, /include customers/);
  assert.match(parseRequestInput({ sourceId: 1, targetId: 2, mode: "copy", scope: {} }).error, /at least one/);
  assert.match(parseRequestInput({ sourceId: 1, targetId: 2, mode: "copy", scope: { customers: true }, resolutions: { "customer:1": "drop" } }).error, /resolution/);
  const ok = parseRequestInput({ sourceId: 1, targetId: 2, mode: "move", scope: { customers: true, customerIds: [3, 3, 2] } });
  assert.deepEqual(ok.value.scope.customerIds, [2, 3]);
});

test("a request needs all three approvals, and the requester cannot be the platform approver", () => {
  const request = { requested_by: 9 };
  const approve = (role, userId) => ({ role, user_id: userId, decision: "approved" });
  assert.equal(approvalSummary([approve("source_owner", 1), approve("target_owner", 2)], 9).complete, false);
  assert.equal(approvalSummary([approve("source_owner", 1), approve("target_owner", 2), approve("platform_admin", 9)], 9).complete, false);
  assert.equal(approvalSummary([approve("source_owner", 1), approve("target_owner", 2), approve("platform_admin", 8)], 9).complete, true);
  assert.deepEqual(eligibleRoles({ user: { id: 9, isPlatformAdmin: true }, request }), []);
  assert.deepEqual(eligibleRoles({ user: { id: 8, isPlatformAdmin: true }, request }), ["platform_admin"]);
  assert.deepEqual(eligibleRoles({ user: { id: 8, isPlatformAdmin: false, impersonating: true }, request, sourceApprovers: [8] }), []);
  assert.deepEqual(eligibleRoles({ user: { id: 1 }, request, sourceApprovers: [1], targetApprovers: [1] }), ["source_owner", "target_owner"]);
  const declined = approvalSummary([approve("source_owner", 1), { role: "target_owner", user_id: 2, decision: "declined" }], 9);
  assert.equal(declined.complete, false);
  assert.equal(declined.declined.role, "target_owner");
});

test("cleared approvals no longer count", () => {
  const rows = ["source_owner", "target_owner", "platform_admin"].map((role, i) => ({ role, user_id: i + 1, decision: "approved", cleared_at: "2026-10-01" }));
  assert.equal(approvalSummary(rows, 9).complete, false);
  assert.deepEqual(eligibleRoles({ user: { id: 1 }, request: { requested_by: 9 }, sourceApprovers: [1], approvals: rows }), ["source_owner"]);
});

test("changing scope, mode or schedule changes the fingerprint that clears approvals", () => {
  const base = { scope: { customers: true, tickets: false }, mode: "copy", scheduleAt: null, resolutions: {}, acknowledged: [] };
  assert.equal(requestFingerprint(base), requestFingerprint({ ...base, scope: { tickets: false, customers: true } }));
  assert.notEqual(requestFingerprint(base), requestFingerprint({ ...base, scope: { customers: true, tickets: true } }));
  assert.notEqual(requestFingerprint(base), requestFingerprint({ ...base, mode: "move" }));
  assert.notEqual(requestFingerprint(base), requestFingerprint({ ...base, scheduleAt: "2026-11-01T17:00:00Z" }));
});

test("pending requests expire after 7 days", () => {
  const submitted = "2026-10-01T10:00:00Z";
  assert.equal(isExpired({ status: "pending", submitted_at: submitted }, new Date("2026-10-08T09:59:00Z")), false);
  assert.equal(isExpired({ status: "pending", submitted_at: submitted }, new Date("2026-10-08T10:01:00Z")), true);
  assert.equal(isExpired({ status: "approved", submitted_at: submitted }, new Date("2026-12-01T00:00:00Z")), false);
});

test("conflicts default to merge and honour rename and skip", () => {
  const merged = plan();
  const keys = merged.conflicts.map((item) => item.key).sort();
  assert.deepEqual(keys, ["contact:20", "customer:11", "device:41", "sla_plan:60"]);
  assert.equal(merged.selection.customers[11], "merge");
  assert.equal(merged.selection.contacts[20], "merge");
  assert.equal(merged.selection.devices[41], "rename");
  assert.equal(merged.counts.customers, 2);
  assert.equal(merged.counts.customersMerged, 1);

  const skipped = plan({ resolutions: { "customer:11": "skip", "device:41": "skip" } });
  assert.equal(skipped.selection.customers[11], "skip");
  assert.equal(skipped.selection.contacts[21], undefined, "a skipped customer's contacts stay behind");
  assert.deepEqual(skipped.selection.tickets, [50, 52], "and so do its tickets");
  assert.equal(skipped.selection.devices[41], undefined);
  assert.equal(skipped.counts.customersSkipped, 1);

  const renamedPlan = plan({ resolutions: { "customer:11": "rename" } });
  assert.equal(renamedPlan.selection.customers[11], "rename");
  assert.equal(renamedPlan.counts.customers, 3);
  assert.equal(renamed("Beta Ltd", ["beta ltd", "Beta Ltd (migrated)"]), "Beta Ltd (migrated 2)");
});

test("data the target's package lacks is blocked until excluded or acknowledged", () => {
  const noDesk = { active: true, features: ["enrollment"], devicesLeft: 100 };
  const blocked = plan({}, noDesk);
  assert.deepEqual(blocked.blocked.map((item) => item.key), ["tickets_unlicensed"]);
  assert.equal(blocked.ready, false);
  assert.equal(plan({ acknowledged: ["tickets_unlicensed"] }, noDesk).ready, true);
  const excluded = plan({ scope: { customers: true, tickets: false, devices: true, settings: true, users: false, customerIds: null } }, noDesk);
  assert.equal(excluded.blocked.length, 0);
  assert.equal(excluded.ready, true);
  assert.equal(plan({}, { ...LICENSED, devicesLeft: 1 }).blocked[0].key, "devices_over_cap");
});

test("devices can only be moved, and an inactive tenant stops the plan", () => {
  assert.match(plan({ mode: "copy" }).errors.join(" "), /only be moved/);
  assert.equal(plan({}, { ...LICENSED, active: false }).ready, false);
});

test("picking customers limits everything else to them", () => {
  const picked = plan({ scope: { customers: true, tickets: true, devices: true, settings: false, users: false, customerIds: [10] } });
  assert.deepEqual(Object.keys(picked.selection.customers), ["10"]);
  assert.deepEqual(picked.selection.tickets, [50]);
  assert.deepEqual(Object.keys(picked.selection.devices), ["40"]);
  assert.match(plan({ scope: { customers: true, customerIds: [999] } }).errors.join(" "), /does not belong/);
});

test("rows from any other tenant stop the dry run", () => {
  const { source, target } = sides();
  source.tickets.push({ id: 99, org_id: 3, customer_id: 10 });
  assert.throws(() => buildPlan({
    request: { sourceId: SOURCE, targetId: TARGET, mode: "copy", scope: { customers: true, tickets: true }, resolutions: {}, acknowledged: [] },
    source,
    target,
    sourceLicense: { active: true },
    targetLicense: LICENSED,
  }), IsolationError);
  const clean = sides();
  clean.target.customers.push({ id: 300, org_id: 3, name: "Other tenant" });
  assert.throws(() => buildPlan({
    request: { sourceId: SOURCE, targetId: TARGET, mode: "copy", scope: { customers: true }, resolutions: {}, acknowledged: [] },
    source: clean.source,
    target: clean.target,
    sourceLicense: { active: true },
    targetLicense: LICENSED,
  }), IsolationError);
});

test("users are listed but never moved silently", () => {
  const withUsers = plan({ scope: { customers: true, tickets: false, devices: false, settings: false, users: true, customerIds: null } });
  assert.equal(withUsers.users.length, 1);
  assert.equal(withUsers.users[0].outcome, "skipped");
});

test("a big change since approval sends the request back", () => {
  const before = plan();
  assert.equal(significantChange(before, plan()), false);
  const after = plan();
  after.counts.tickets = before.counts.tickets + 5;
  assert.equal(significantChange(before, after), true);
  const extra = plan({ resolutions: { "customer:11": "skip" } });
  extra.conflicts.push({ key: "customer:77" });
  assert.equal(significantChange(before, extra), true);
});

test("schedule defaults to 19:00 Johannesburg, and the rollback window is 30 days", () => {
  assert.equal(defaultSchedule(new Date("2026-10-29T08:00:00Z")), "2026-10-29T17:00:00.000Z");
  assert.equal(defaultSchedule(new Date("2026-10-29T18:00:00Z")), "2026-10-30T17:00:00.000Z");
  const done = { status: "completed", mode: "move", completed_at: "2026-10-01T00:00:00Z" };
  assert.equal(rollbackOpen(done, new Date("2026-10-20T00:00:00Z")), true);
  assert.equal(rollbackOpen(done, new Date("2026-11-01T00:00:00Z")), false);
  assert.equal(purgeDue(done, new Date("2026-11-01T00:00:00Z")), true);
  assert.equal(rollbackOpen({ ...done, mode: "copy" }, new Date("2027-01-01T00:00:00Z")), true);
});
