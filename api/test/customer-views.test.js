import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateOnly, isOverdue, listFields, resolveCustomerView, slaFor, ticketDue, viewScope } from "../src/customer-views.js";

const REMOTE_ONLY = { remote: true, service: false };
const SERVICE_ONLY = { remote: false, service: true };
const BOTH = { remote: true, service: true };

const ROW = {
  device_count: 4,
  online_count: 2,
  last_session_at: "2026-10-28T10:00:00Z",
  open_ticket_count: 3,
  overdue_count: 1,
  sla_plan_name: null,
  has_default_sla: true,
};

const TICKET_KEYS = ["openTicketCount", "overdueCount", "slaPlan"];
const DEVICE_KEYS = ["deviceCount", "onlineCount", "lastSessionAt"];

describe("resolveCustomerView", () => {
  it("lets each app open its own view", () => {
    assert.deepEqual(resolveCustomerView("remote", REMOTE_ONLY), { view: "remote" });
    assert.deepEqual(resolveCustomerView("desk", SERVICE_ONLY), { view: "desk" });
    assert.deepEqual(resolveCustomerView("", REMOTE_ONLY), { view: "" });
    assert.deepEqual(resolveCustomerView(null, SERVICE_ONLY), { view: "" });
  });

  it("refuses a view for an app the tenant has not bought", () => {
    const desk = resolveCustomerView("desk", REMOTE_ONLY);
    assert.equal(desk.status, 403);
    assert.equal(desk.body.code, "app_not_entitled");
    assert.equal(desk.body.app, "servicedesk");
    const remote = resolveCustomerView("remote", SERVICE_ONLY);
    assert.equal(remote.status, 403);
    assert.equal(remote.body.app, "remote");
  });

  it("rejects unknown views", () => {
    assert.equal(resolveCustomerView("billing", BOTH).status, 400);
  });
});

describe("listFields", () => {
  it("Remote Desk only: no ticket fields in any view", () => {
    for (const view of ["remote", ""]) {
      const fields = listFields(ROW, view, REMOTE_ONLY);
      for (const key of TICKET_KEYS) assert.equal(key in fields, false, `${view || "neutral"} leaked ${key}`);
    }
    assert.deepEqual(listFields(ROW, "remote", REMOTE_ONLY), {
      deviceCount: 4,
      onlineCount: 2,
      lastSessionAt: "2026-10-28T10:00:00Z",
    });
  });

  it("Service Desk only: no device or session fields in any view", () => {
    for (const view of ["desk", ""]) {
      const fields = listFields(ROW, view, SERVICE_ONLY);
      for (const key of DEVICE_KEYS) assert.equal(key in fields, false, `${view || "neutral"} leaked ${key}`);
    }
    assert.deepEqual(listFields(ROW, "desk", SERVICE_ONLY), { openTicketCount: 3, overdueCount: 1, slaPlan: "Default" });
  });

  it("both apps: each view still carries only its own app's columns", () => {
    const remote = listFields(ROW, "remote", BOTH);
    for (const key of TICKET_KEYS) assert.equal(key in remote, false);
    const desk = listFields(ROW, "desk", BOTH);
    for (const key of DEVICE_KEYS) assert.equal(key in desk, false);
  });

  it("names the plan, the default, or nothing", () => {
    assert.equal(listFields({ ...ROW, sla_plan_name: "Gold" }, "desk", SERVICE_ONLY).slaPlan, "Gold");
    assert.equal(listFields({ ...ROW, has_default_sla: false }, "desk", SERVICE_ONLY).slaPlan, null);
  });
});

describe("viewScope", () => {
  it("scopes record data to the view", () => {
    assert.deepEqual(viewScope("remote", BOTH), { remote: true, desk: false });
    assert.deepEqual(viewScope("desk", BOTH), { remote: false, desk: true });
    assert.deepEqual(viewScope("", REMOTE_ONLY), { remote: true, desk: false });
    assert.deepEqual(viewScope("", SERVICE_ONLY), { remote: false, desk: true });
  });
});

describe("SLA plans", () => {
  const book = {
    base: { responseMinutes: 60, resolveMinutes: 480 },
    plans: new Map([["7", { id: 7, name: "Gold", responseMinutes: 15, resolveMinutes: 120 }]]),
  };

  it("uses the customer's plan, else the tenant default", () => {
    assert.equal(slaFor(book, 7).name, "Gold");
    assert.equal(slaFor(book, "7").resolveMinutes, 120);
    assert.equal(slaFor(book, null), book.base);
    assert.equal(slaFor(book, 99), book.base);
    assert.equal(slaFor({ base: null, plans: new Map() }, null), null);
  });

  it("works out due dates from the resolve target", () => {
    const row = { status: "open", created_at: "2026-10-28T08:00:00Z" };
    assert.equal(ticketDue(row, { resolveMinutes: 120 }).toISOString(), "2026-10-28T10:00:00.000Z");
    assert.equal(ticketDue({ ...row, status: "resolved" }, { resolveMinutes: 120 }), null);
    assert.equal(ticketDue(row, null), null);
  });

  it("counts pending tickets as overdue and ignores response targets", () => {
    const now = new Date("2026-10-28T11:00:00Z");
    const sla = { responseMinutes: 15, resolveMinutes: 120 };
    assert.equal(isOverdue({ status: "open", created_at: "2026-10-28T08:00:00Z" }, sla, now), true);
    assert.equal(isOverdue({ status: "pending", created_at: "2026-10-28T08:00:00Z" }, sla, now), true);
    assert.equal(isOverdue({ status: "resolved", created_at: "2026-10-28T08:00:00Z" }, sla, now), false);
    assert.equal(isOverdue({ status: "open", created_at: "2026-10-28T10:30:00Z" }, sla, now), false);
    assert.equal(isOverdue({ status: "open", created_at: "2026-10-28T08:00:00Z" }, null, now), false);
  });
});

describe("dateOnly", () => {
  it("formats dates without shifting the day", () => {
    assert.equal(dateOnly(new Date(2026, 0, 31)), "2026-01-31");
    assert.equal(dateOnly("2026-12-01"), "2026-12-01");
  });
});
