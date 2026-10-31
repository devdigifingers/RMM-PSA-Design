import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_GROUPS,
  GROUP_TYPES,
  TICKET_ONLY_TYPES,
  activityFromAudit,
  activityFromTicketEvent,
  cursorFor,
  ticketActor,
  ticketTimelineQuery,
  timelineQuery,
  timelineView,
} from "../src/activity.js";

const AUDITED = [
  ["customer.create", "customer", { name: "Acme" }],
  ["customer.update", "customer", {}],
  ["customer.notes", "customer", {}],
  ["customer.sla", "customer", {}],
  ["customer.contact", "customer", { contactName: "Sam" }],
  ["contact.create", "contact", { name: "Sam", accountId: 4 }],
  ["contact.update", "contact", { name: "Sam" }],
  ["contact.delete", "contact", { accountId: 4 }],
  ["device.enroll", "device", { hostname: "PC1" }],
  ["device.rename", "device", { name: "Front desk" }],
  ["device.link", "device", { customerId: 4 }],
  ["device.unlink", "device", {}],
  ["device.assign", "device", { contactId: 2, customerId: 4 }],
  ["device.site", "device", { site: "Cape Town" }],
  ["device.remote_agent_missing", "device", {}],
  ["device.remote_agent_ok", "device", {}],
  ["remote.launch", "device", { user: "Sam", ticketId: 9 }],
  ["remote.resume", "device", {}],
  ["remote.end", "device", {}],
  ["support.start", "support_session", { code: "x" }],
  ["support.join", "support_session", { hostname: "PC1" }],
  ["support.end", "support_session", {}],
  ["job.create", "job", { deviceId: 3, command: "ipconfig /all" }],
  ["terminal.open", "device", { shell: "cmd" }],
  ["power.request", "device", { action: "restart" }],
  ["service.set", "device", { name: "Spooler" }],
  ["process.end", "device", { name: "notepad.exe" }],
  ["startup.set", "device", { name: "OneDrive" }],
  ["file.upload", "device", { name: "a.txt" }],
  ["file.download", "device", { name: "b.txt" }],
  ["alert.fire", "alert", { deviceId: 3, metric: "cpu", value: 97, threshold: 90 }],
  ["patch.push", "device", { count: 3 }],
  ["patch.deploy", "patch_deploy", { status: "succeeded", packageName: "KB5031" }],
  ["patch.restart", "device", {}],
  ["agent.update.request", "device", { to: "1.6.1" }],
];

test("every timeline audit action becomes an event in a known group", () => {
  for (const [action, targetType, detail] of AUDITED) {
    const event = activityFromAudit({ action, targetType, targetId: "7", detail, actorId: 2 });
    assert.ok(event, action);
    assert.ok(ACTIVITY_GROUPS[event.group], `${action} group`);
    assert.ok(GROUP_TYPES[event.group].some((prefix) => event.type.startsWith(prefix)), `${action} type ${event.type} fits its group filter`);
    assert.ok(event.summary.length > 3 && !event.summary.includes("undefined"), `${action} summary: ${event.summary}`);
    assert.equal(event.actorType, "user");
    assert.equal(event.actorId, 2);
  }
});

test("audit actions that are not customer history stay off the timeline", () => {
  for (const action of ["login.mfa_fail", "user.create", "ticket.update", "patch.approve", "report.export", "api_token.create", "agent.update.offer"]) {
    assert.equal(activityFromAudit({ action, targetType: "org", targetId: "1", detail: {} }), null, action);
  }
});

test("targets point the event at the right customer, device or record to look up", () => {
  assert.equal(activityFromAudit({ action: "customer.update", targetType: "customer", targetId: "4" }).customerId, 4);
  assert.equal(activityFromAudit({ action: "contact.delete", targetType: "contact", targetId: "8", detail: { accountId: 4 } }).customerId, 4);
  assert.equal(activityFromAudit({ action: "device.rename", targetType: "device", targetId: "3", detail: { name: "x" } }).deviceId, 3);
  assert.deepEqual(activityFromAudit({ action: "patch.deploy", targetType: "patch_deploy", targetId: "5", detail: { status: "failed" } }).lookup, { table: "patch_deploy", id: 5 });
  assert.equal(activityFromAudit({ action: "remote.launch", targetType: "device", targetId: "3", detail: { ticketId: 9 } }).ticketId, 9);
  assert.equal(activityFromAudit({ action: "patch.deploy", targetType: "patch_deploy", targetId: "5", detail: { status: "failed" } }).type, "patch.failed");
});

test("scripts, API tokens and system actions are told apart", () => {
  const script = activityFromAudit({ action: "job.create", targetType: "job", targetId: "1", detail: { kind: "script", length: 9000, apiToken: "Grok" } });
  assert.equal(script.type, "script.run");
  assert.equal(script.actorType, "api");
  assert.match(script.actorLabel, /Grok/);
  assert.match(script.summary, /9000/);
  assert.equal(activityFromAudit({ action: "alert.fire", targetType: "alert", targetId: "1", detail: { metric: "disk", value: 95, threshold: 90 } }).actorType, "system");
});

test("every ticket event is stored with its detail, ones recorded elsewhere kept off the wider feeds", () => {
  const detail = { from: "open", to: "pending", minutes: 30, rule: "Close stale", rating: "good", into: 4, commentId: 9 };
  for (const kind of ["created", "reply", "note", "status", "priority", "assignee", "csat", "merged", "sla_breach", "time", "time_removed", "automation", "email",
    "command", "command_result", "remote_start", "remote_end"]) {
    const event = activityFromTicketEvent(kind, detail);
    assert.equal(event.type, `ticket.${kind}`);
    assert.deepEqual(event.payload, detail, `${kind} keeps its detail`);
    assert.ok(!event.summary.includes("undefined"), kind);
  }
  assert.equal(activityFromTicketEvent("time", { minutes: 90 }).group, "time");
  assert.match(activityFromTicketEvent("time", { minutes: 90 }).summary, /1 h 30 min/);
  const feed = timelineQuery({ orgId: 1, customerId: 2, apps: ["servicedesk"] });
  assert.ok(feed.values.some((value) => Array.isArray(value) && TICKET_ONLY_TYPES.every((type) => value.includes(type))));
  assert.match(feed.text, /e\.type <> ALL/);
  assert.equal(ticketActor("automation", null, "Automation").actorType, "automation");
  assert.equal(ticketActor("created", null, "Alert monitor").actorType, "system");
  assert.equal(ticketActor("reply", 5, null).actorType, "user");
});

test("the timeline query is always scoped to the organisation and the customer or device", () => {
  const query = timelineQuery({ orgId: 12, customerId: 4, apps: ["remote"] });
  assert.match(query.text, /WHERE e\.org_id = \$1 AND e\.customer_id = \$2/);
  assert.deepEqual(query.values.slice(0, 2), [12, 4]);
  const device = timelineQuery({ orgId: 12, deviceId: 3, apps: [] });
  assert.match(device.text, /e\.device_id = \$2/);
  assert.throws(() => timelineQuery({ orgId: 12, apps: [] }));
  assert.throws(() => timelineQuery({ customerId: 4, apps: [] }));
  for (const join of ["devices d", "tickets t", "customers c"]) {
    assert.match(query.text, new RegExp(`JOIN ${join} ON .* AND \\w\\.org_id = e\\.org_id`), `${join} join stays in the organisation`);
  }
});

test("the feed only shows what the package includes", () => {
  assert.deepEqual(timelineQuery({ orgId: 1, customerId: 2, apps: [] }).values[2], ["core"]);
  assert.deepEqual(timelineQuery({ orgId: 1, customerId: 2, apps: ["remote"] }).values[2], ["core", "remote"]);
  assert.deepEqual(timelineQuery({ orgId: 1, customerId: 2, apps: ["servicedesk", "reporting", "anything"] }).values[2], ["core", "servicedesk"]);
});

test("filters, search and the cursor are passed as values, never as SQL", () => {
  const query = timelineQuery({
    orgId: 1,
    customerId: 2,
    apps: ["remote", "servicedesk"],
    filters: { groups: ["tickets", "nonsense"], device: "5", actor: "7", from: "2026-10-01", to: "2026-10-31", q: "100%_done'; DROP", before: "2026-10-30T10:00:00.000Z_99" },
  });
  assert.ok(!query.text.includes("DROP"));
  assert.ok(query.values.includes("ticket.%"));
  assert.ok(!query.values.some((value) => String(value).includes("nonsense")));
  assert.ok(query.values.includes(5) && query.values.includes(7));
  assert.ok(query.values.includes("%100\\%\\_done'; DROP%"));
  assert.ok(query.values.includes("2026-10-30T10:00:00.000Z") && query.values.includes("99"));
  const ignored = timelineQuery({ orgId: 1, customerId: 2, apps: [], filters: { from: "yesterday", before: "garbage", device: "x" } });
  assert.equal(ignored.values.length, 4);
});

test("a ticket timeline reads one ticket and those merged into it, inside the organisation", () => {
  const query = ticketTimelineQuery(12, 40);
  assert.deepEqual(query.values, [12, 40]);
  assert.match(query.text, /WHERE id = \$2 AND org_id = \$1/);
  assert.match(query.text, /t\.merged_into_id = f\.id WHERE t\.org_id = \$1/);
  assert.match(query.text, /WHERE e\.org_id = \$1 AND e\.ticket_id IN \(SELECT id FROM family\) AND e\.type LIKE 'ticket\.%'/);
  assert.match(query.text, /e\.type <> 'ticket\.created'/);
  assert.throws(() => ticketTimelineQuery(null, 40));
});

test("pages carry a cursor only when there is more to read", () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: 10 - i, type: "ticket.reply", actor_type: "user", actor_name: "Sam", summary: "replied", created_at: new Date(Date.UTC(2026, 9, 31, 10, 0, 0) - i * 60000), payload: {} }));
  const full = timelineView(rows, 2);
  assert.equal(full.items.length, 2);
  assert.equal(full.next, cursorFor(rows[1]));
  assert.equal(timelineView(rows.slice(0, 2), 2).next, null);
  assert.equal(full.items[0].actor, "Sam");
});
