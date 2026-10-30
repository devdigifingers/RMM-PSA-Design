import assert from "node:assert/strict";
import test from "node:test";
import { countLines, fromSastInput, nextAfterHours, sastInput, scopeLine } from "../app/migration-labels.js";

test("schedule inputs are Johannesburg time", () => {
  assert.equal(sastInput("2026-10-29T17:00:00.000Z"), "2026-10-29T19:00");
  assert.equal(fromSastInput("2026-10-29T19:00"), "2026-10-29T17:00:00.000Z");
  assert.equal(fromSastInput("not a date"), null);
});

test("after hours is the next 19:00 SAST", () => {
  assert.equal(nextAfterHours(new Date("2026-10-29T08:00:00Z")), "2026-10-29T17:00:00.000Z");
  assert.equal(nextAfterHours(new Date("2026-10-29T18:30:00Z")), "2026-10-30T17:00:00.000Z");
});

test("summaries skip empty counts and name chosen customers", () => {
  assert.deepEqual(countLines({ customers: 2, contacts: 0, tickets: 5 }), ["2 new customers", "5 tickets"]);
  assert.deepEqual(countLines({ customers: 1, contacts: 1, timeEntries: 1 }), ["1 new customer", "1 new contact", "1 time entry"]);
  assert.equal(scopeLine({ customers: true, tickets: true, customerIds: [4] }), "Customers and contacts, Tickets with their history · 1 chosen customer");
});
