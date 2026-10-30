import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addBusinessMinutes,
  businessMinutes,
  calendarFrom,
  DEFAULT_HOURS,
  isOverdue,
  parseHours,
  parsePercent,
  slaState,
  targetsFor,
  ticketClock,
  zaHolidays,
} from "../src/sla-engine.js";
import { parseCc, parseChannel, parseDueAt, similarTickets } from "../src/ticket-input.js";

const office = calendarFrom(DEFAULT_HOURS);

describe("business hours", () => {
  it("counts only office minutes across a weekend", () => {
    // Friday 16:00 to Monday 09:00 South African time.
    assert.equal(businessMinutes("2026-10-30T14:00:00Z", "2026-11-02T07:00:00Z", office), 120);
    assert.equal(businessMinutes("2026-10-30T14:00:00Z", "2026-11-02T07:00:00Z", null), 3900);
  });

  it("adds office minutes and skips holidays", () => {
    assert.equal(addBusinessMinutes("2026-10-30T14:00:00Z", 120, office).toISOString(), "2026-11-02T07:00:00.000Z");
    const withHoliday = calendarFrom(DEFAULT_HOURS, ["2026-11-02"]);
    assert.equal(addBusinessMinutes("2026-10-30T14:00:00Z", 120, withHoliday).toISOString(), "2026-11-03T07:00:00.000Z");
  });

  it("validates opening times", () => {
    assert.equal(parseHours({ mon: [["17:00", "08:00"]] }).error, "Each closing time must be after its opening time.");
    assert.equal(parseHours({ mon: [["8am", "17:00"]] }).error, "Use 24-hour times such as 08:00 and 17:00.");
    assert.equal(parseHours({ mon: [["08:00", "12:00"], ["11:00", "17:00"]] }).error, "Opening times on the same day overlap.");
    assert.deepEqual(parseHours({ mon: [["13:00", "17:00"], ["08:00", "12:00"]] }).value.mon, [["08:00", "12:00"], ["13:00", "17:00"]]);
    assert.equal(calendarFrom({ mon: [], tue: [] }), null);
  });
});

describe("priority targets", () => {
  it("scales targets by priority percentage", () => {
    const sla = { responseMinutes: 60, resolveMinutes: 240, priorityPercent: { low: 200, normal: 100, high: 75, urgent: 50 } };
    assert.deepEqual(targetsFor(sla, "urgent"), { responseMinutes: 30, resolveMinutes: 120, percent: 50 });
    assert.deepEqual(targetsFor(sla, "low"), { responseMinutes: 120, resolveMinutes: 480, percent: 200 });
  });

  it("rejects percentages outside 5 to 500", () => {
    assert.ok(parsePercent({ urgent: 1 }).error);
    assert.deepEqual(parsePercent({ urgent: "50" }).value, { low: 100, normal: 100, high: 100, urgent: 50 });
  });
});

describe("ticket clock", () => {
  const sla = { responseMinutes: 60, resolveMinutes: 240 };

  it("pauses the resolve clock while pending", () => {
    const row = { created_at: "2026-10-29T10:00:00Z", status: "pending", priority: "normal", sla_paused_at: "2026-10-29T11:00:00Z", first_response_at: "2026-10-29T10:30:00Z" };
    const now = new Date("2026-10-29T13:00:00Z");
    const clock = ticketClock(row, sla, now);
    assert.equal(clock.paused, true);
    assert.equal(clock.pausedMinutes, 120);
    assert.equal(clock.resolveElapsed, 60);
    assert.equal(clock.resolveDueAt.toISOString(), "2026-10-29T16:00:00.000Z");
    assert.equal(slaState(row, sla, now).state, "paused");
    assert.equal(isOverdue(row, sla, new Date("2026-10-30T13:00:00Z")), false);
  });

  it("counts earlier pending spells after the ticket reopens", () => {
    const row = {
      created_at: "2026-10-29T10:00:00Z",
      status: "open",
      first_response_at: "2026-10-29T10:10:00Z",
      sla_pauses: [["2026-10-29T11:00:00Z", "2026-10-29T12:00:00Z"]],
    };
    const clock = ticketClock(row, sla, new Date("2026-10-29T13:00:00Z"));
    assert.equal(clock.resolveElapsed, 120);
    assert.equal(clock.resolveDueAt.toISOString(), "2026-10-29T15:00:00.000Z");
  });

  it("warns when under a quarter of the target is left and breaches after it", () => {
    const row = { created_at: "2026-10-29T10:00:00Z", status: "open", first_response_at: "2026-10-29T10:05:00Z" };
    assert.equal(slaState(row, sla, new Date("2026-10-29T13:30:00Z")).state, "soon");
    assert.equal(slaState(row, sla, new Date("2026-10-29T12:00:00Z")).state, "ok");
    const late = slaState(row, sla, new Date("2026-10-29T14:30:00Z"));
    assert.equal(late.state, "breached");
    assert.equal(late.target, "resolve");
  });

  it("uses the due date override", () => {
    const row = { created_at: "2026-10-29T10:00:00Z", status: "open", first_response_at: "2026-10-29T10:05:00Z", due_at: "2026-10-31T10:00:00Z" };
    const clock = ticketClock(row, sla, new Date("2026-10-29T15:00:00Z"));
    assert.equal(clock.dueOverridden, true);
    assert.equal(clock.resolveDueAt.toISOString(), "2026-10-31T10:00:00.000Z");
    assert.equal(isOverdue(row, sla, new Date("2026-10-29T15:00:00Z")), false);
    assert.equal(isOverdue(row, sla, new Date("2026-10-31T11:00:00Z")), true);
  });
});

describe("South African public holidays", () => {
  it("includes Easter dates and moves Sunday holidays to Monday", () => {
    const days = new Map(zaHolidays(2026).map((item) => [item.day, item.name]));
    assert.equal(days.get("2026-04-03"), "Good Friday");
    assert.equal(days.get("2026-04-06"), "Family Day");
    assert.equal(days.get("2026-08-10"), "National Women's Day (observed)");
    assert.equal(days.size, 13);
  });
});

describe("new ticket inputs", () => {
  it("reads a datetime-local due date as South African time", () => {
    const now = new Date("2026-10-29T08:00:00Z");
    assert.equal(parseDueAt("2026-10-30T14:30", now).value.toISOString(), "2026-10-30T12:30:00.000Z");
    assert.equal(parseDueAt("", now).value, null);
    assert.ok(parseDueAt("next week", now).error);
  });

  it("limits channels and CC lists", () => {
    assert.equal(parseChannel("walk_in").value, "walk_in");
    assert.ok(parseChannel("alert").error);
    assert.deepEqual(parseCc(["3", 3, "4"]).value, [3, 4]);
    assert.ok(parseCc(Array.from({ length: 21 }, (_, i) => i + 1)).error);
  });

  it("finds open tickets with a similar subject", () => {
    const rows = [
      { id: 1, subject: "Printer offline in reception" },
      { id: 2, subject: "Outlook keeps asking for password" },
      { id: 3, subject: "Reception printer not printing" },
    ];
    assert.deepEqual(similarTickets(rows, "Reception printer offline").map((row) => row.id), [1, 3]);
    assert.deepEqual(similarTickets(rows, "help"), []);
  });
});
