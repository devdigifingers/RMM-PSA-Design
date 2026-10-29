import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanColumns,
  cleanTags,
  cleanViewQuery,
  filterTickets,
  pageOf,
  parseListQuery,
  slaState,
  sortTickets,
  ticketsCsv,
  viewCounts,
} from "../src/ticket-list.js";

const NOW = new Date("2026-10-28T10:00:00Z");

function ticket(id, extra = {}) {
  return {
    id,
    subject: `Ticket ${id}`,
    status: "open",
    priority: "normal",
    customer: { id: 1, name: "Acme", contactName: "Jo" },
    device: null,
    assignee: null,
    channel: "console",
    category: null,
    tags: [],
    createdAt: "2026-10-27T10:00:00Z",
    lastActivityAt: "2026-10-27T10:00:00Z",
    dueAt: null,
    overdue: false,
    sla: { state: "none" },
    ...extra,
  };
}

describe("list query", () => {
  it("defaults to last activity, newest first, page 1", () => {
    const query = parseListQuery(new URLSearchParams(""));
    assert.equal(query.sort, "lastActivity");
    assert.equal(query.dir, "desc");
    assert.equal(query.page, 1);
    assert.equal(query.view, "all");
  });

  it("drops unknown values instead of trusting them", () => {
    const query = parseListQuery(new URLSearchParams("status=open,bogus&priority=x&sort=drop&owner=abc&sla=late&page=-2&view=secret"));
    assert.deepEqual(query.status, ["open"]);
    assert.deepEqual(query.priority, []);
    assert.equal(query.sort, "lastActivity");
    assert.equal(query.owner, null);
    assert.equal(query.sla, null);
    assert.equal(query.page, 1);
    assert.equal(query.view, "all");
  });

  it("reads date ranges as whole Johannesburg days", () => {
    const query = parseListQuery(new URLSearchParams("created_from=2026-10-27&created_to=2026-10-27"));
    assert.equal(query.createdFrom.toISOString(), "2026-10-26T22:00:00.000Z");
    assert.equal(query.createdTo.toISOString(), "2026-10-27T22:00:00.000Z");
  });
});

describe("SLA state", () => {
  const targets = { responseMinutes: 60, resolveMinutes: 480 };

  it("is breached when the response target has passed without a reply", () => {
    const state = slaState({ status: "open", createdAt: "2026-10-28T08:00:00Z" }, targets, NOW);
    assert.equal(state.state, "breached");
    assert.equal(state.target, "response");
  });

  it("is due soon with under a quarter of the time left", () => {
    const state = slaState({ status: "open", createdAt: "2026-10-28T03:00:00Z", firstResponseAt: "2026-10-28T03:10:00Z" }, targets, NOW);
    assert.equal(state.state, "soon");
    assert.equal(state.target, "resolve");
    assert.equal(state.minutesLeft, 60);
  });

  it("is OK with plenty of time and none once resolved", () => {
    assert.equal(slaState({ status: "open", createdAt: "2026-10-28T09:50:00Z" }, targets, NOW).state, "ok");
    assert.equal(slaState({ status: "resolved", createdAt: "2026-10-20T00:00:00Z" }, targets, NOW).state, "none");
    assert.equal(slaState({ status: "open", createdAt: "2026-10-28T09:50:00Z" }, null, NOW).state, "none");
  });
});

describe("filters", () => {
  const tickets = [
    ticket(1, { priority: "high", tags: ["Printer"], category: "Hardware", assignee: { id: 7, name: "Ann" } }),
    ticket(2, { status: "pending", customer: { id: 2, name: "Beta" }, sla: { state: "breached" } }),
    ticket(3, { status: "resolved", channel: "alert", createdAt: "2026-10-01T10:00:00Z" }),
  ];
  const base = parseListQuery(new URLSearchParams(""));

  it("combines status, priority, owner, tag and category", () => {
    assert.deepEqual(filterTickets(tickets, { ...base, status: ["open"], priority: ["high"] }, 7).map((item) => item.id), [1]);
    assert.deepEqual(filterTickets(tickets, { ...base, owner: "me" }, 7).map((item) => item.id), [1]);
    assert.deepEqual(filterTickets(tickets, { ...base, owner: "none" }, 7).map((item) => item.id), [2, 3]);
    assert.deepEqual(filterTickets(tickets, { ...base, tag: "printer", category: "hardware" }, 7).map((item) => item.id), [1]);
  });

  it("filters by customer, channel, SLA state, created range and search", () => {
    assert.deepEqual(filterTickets(tickets, { ...base, customer: 2 }, 7).map((item) => item.id), [2]);
    assert.deepEqual(filterTickets(tickets, { ...base, channel: "alert" }, 7).map((item) => item.id), [3]);
    assert.deepEqual(filterTickets(tickets, { ...base, sla: "breached" }, 7).map((item) => item.id), [2]);
    const october = parseListQuery(new URLSearchParams("created_from=2026-10-01&created_to=2026-10-01"));
    assert.deepEqual(filterTickets(tickets, october, 7).map((item) => item.id), [3]);
    assert.deepEqual(filterTickets(tickets, { ...base, q: "#2" }, 7).map((item) => item.id), [2]);
  });

  it("counts the built-in views", () => {
    const counts = viewCounts(tickets, 7);
    assert.equal(counts.all, 3);
    assert.equal(counts.mine, 1);
    assert.equal(counts.resolved, 1);
  });
});

describe("sorting and paging", () => {
  it("sorts priority by rank and breaks ties newest first", () => {
    const list = [ticket(1, { priority: "low" }), ticket(2, { priority: "urgent" }), ticket(3, { priority: "low" })];
    assert.deepEqual(sortTickets(list, "priority", "desc").map((item) => item.id), [2, 3, 1]);
    assert.deepEqual(sortTickets(list, "priority", "asc").map((item) => item.id), [3, 1, 2]);
  });

  it("pages 50 at a time and clamps out-of-range pages", () => {
    const list = Array.from({ length: 120 }, (_, index) => ticket(index + 1));
    const third = pageOf(list, 3);
    assert.equal(third.items.length, 20);
    assert.equal(third.pages, 3);
    assert.equal(pageOf(list, 99).page, 3);
  });
});

describe("cleaning input", () => {
  it("keeps up to ten unique tags", () => {
    assert.deepEqual(cleanTags(" VPN , vpn,Printer,, "), ["VPN", "Printer"]);
    assert.equal(cleanTags(Array.from({ length: 20 }, (_, index) => `t${index}`)).length, 10);
  });

  it("only accepts known columns and requires the subject", () => {
    assert.deepEqual(cleanColumns(["subject", "id", "evil", "id"]), ["subject", "id"]);
    assert.equal(cleanColumns(["id"]), null);
  });

  it("keeps only list parameters in a saved view", () => {
    assert.equal(cleanViewQuery("?status=open&page=4&token=x&sort=due"), "status=open&sort=due");
  });

  it("neutralises spreadsheet formulas in the CSV export", () => {
    const csv = ticketsCsv([ticket(1, { subject: "=HYPERLINK(\"x\")" })]);
    assert.match(csv, /'=HYPERLINK\(""x""\)/);
  });
});
