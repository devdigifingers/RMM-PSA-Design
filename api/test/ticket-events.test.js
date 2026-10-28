import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachmentIds,
  commentAuthor,
  contentDisposition,
  EVENT_GROUPS,
  imageType,
  publicTimeline,
  safeFileName,
  storedContentType,
  ticketChanges,
  timeInput,
  timelineFilter,
  timelineItem,
  timerMinutes,
  timeTotals,
} from "../src/ticket-events.js";

const comments = new Map([
  [1, { body: "We are looking into it." }],
  [2, { body: "Customer's password is on the sticky note." }],
]);
const attachments = new Map([[1, [{ id: 9, name: "screen.png", isImage: true }]]]);

function event(id, kind, detail = {}, extra = {}) {
  return { id, kind, detail, actor_user_id: 5, actor_name: "Thandi", created_at: "2026-10-28T10:00:00Z", ...extra };
}

describe("ticket changes", () => {
  it("records only fields that changed", () => {
    const before = { status: "open", priority: "normal", assigneeUserId: "3", contactId: null, deviceId: 7 };
    const changes = ticketChanges(before, { status: "pending", priority: "normal", assigneeUserId: 3, contactId: 4, deviceId: 7 });
    assert.deepEqual(changes, [
      { kind: "status", from: "open", to: "pending" },
      { kind: "contact", from: null, to: 4 },
    ]);
  });

  it("skips fields that were not part of the change", () => {
    assert.deepEqual(ticketChanges({ status: "open", assigneeUserId: 2 }, { assigneeUserId: null }), [
      { kind: "assignee", from: 2, to: null },
    ]);
  });

  it("gives every change kind a timeline group", () => {
    for (const kind of ["created", "status", "priority", "assignee", "contact", "device"]) assert.equal(EVENT_GROUPS[kind], "changes");
  });
});

describe("timeline", () => {
  it("shows System or the automation name instead of Unknown", () => {
    assert.equal(commentAuthor({ author_name: null, author_label: null }), "System");
    assert.equal(commentAuthor({ author_name: null, author_label: "Patch monitor" }), "Patch monitor");
    const item = timelineItem(event(1, "status", { from: "open", to: "resolved" }, { actor_user_id: null, actor_name: null, actor_label: "Offline monitor" }));
    assert.equal(item.actor, "Offline monitor");
    assert.equal(item.automatic, true);
    assert.equal(timelineItem(event(2, "sla_breach", {}, { actor_user_id: null, actor_name: null })).actor, "System");
  });

  it("joins comment bodies and attachments", () => {
    const item = timelineItem(event(1, "reply", { commentId: 1 }), { comments, attachments });
    assert.equal(item.body, "We are looking into it.");
    assert.equal(item.attachments[0].name, "screen.png");
    assert.equal(item.group, "replies");
  });

  it("names users, contacts and devices, and survives removed ones", () => {
    const lookups = { users: new Map([[3, "Sam"]]), devices: new Map([[7, "FS01"]]) };
    const assignee = timelineItem(event(1, "assignee", { from: null, to: "3" }), lookups);
    assert.deepEqual([assignee.from, assignee.to], [null, "Sam"]);
    assert.equal(timelineItem(event(2, "assignee", { from: 99, to: null }), lookups).from, "a removed user");
    assert.equal(timelineItem(event(3, "remote_start", { deviceId: 7, user: "admin" }), lookups).device, "FS01");
  });

  it("falls back to all for unknown filters", () => {
    assert.equal(timelineFilter("notes"), "notes");
    assert.equal(timelineFilter("secret"), "all");
  });
});

describe("internal notes", () => {
  const items = [
    timelineItem(event(1, "created")),
    timelineItem(event(2, "reply", { commentId: 1 }), { comments, attachments }),
    timelineItem(event(3, "note", { commentId: 2 }), { comments, attachments }),
    timelineItem(event(4, "command", { command: "ipconfig" })),
    timelineItem(event(5, "time", { minutes: 30 })),
    timelineItem(event(6, "status", { from: "open", to: "resolved" })),
  ];

  it("never reach anything customer-facing", () => {
    const shown = publicTimeline(items);
    assert.deepEqual(shown.map((item) => item.kind), ["created", "reply", "status"]);
    assert.ok(!JSON.stringify(shown).includes("sticky note"));
    assert.ok(!JSON.stringify(shown).includes("ipconfig"));
  });

  it("keep reply attachments for customers", () => {
    assert.equal(publicTimeline(items).find((item) => item.kind === "reply").attachments.length, 1);
  });
});

describe("attachments", () => {
  it("only treats sniffed raster images as images", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webp = Buffer.from("RIFF0000WEBPVP8 ", "latin1");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', "utf8");
    assert.equal(imageType(png), "image/png");
    assert.equal(imageType(jpeg), "image/jpeg");
    assert.equal(imageType(webp), "image/webp");
    assert.equal(imageType(svg), null);
  });

  it("cleans file names and content types", () => {
    assert.equal(safeFileName("C:\\Users\\me\\report.pdf"), "report.pdf");
    assert.equal(safeFileName("../../etc/passwd"), "passwd");
    assert.equal(safeFileName('bad"name<>.txt'), "badname.txt");
    assert.equal(safeFileName(".."), "attachment");
    assert.equal(storedContentType("application/pdf; charset=binary"), "application/pdf");
    assert.equal(storedContentType("text/html\r\nx-evil: 1"), "application/octet-stream");
  });

  it("encodes download names safely", () => {
    const header = contentDisposition('Quote "final" é.pdf', false);
    assert.ok(header.startsWith('attachment; filename="Quote _final_ _.pdf"'));
    assert.ok(header.includes("filename*=UTF-8''Quote%20%22final%22%20%C3%A9.pdf"));
    assert.ok(contentDisposition("a.png", true).startsWith("inline"));
  });

  it("caps attachments per post", () => {
    assert.deepEqual(attachmentIds("3,3,4,x"), [3, 4]);
    assert.deepEqual(attachmentIds([]), []);
    assert.equal(attachmentIds(Array.from({ length: 11 }, (_, index) => index + 1)), null);
  });
});

describe("time entries", () => {
  it("validates manual entries", () => {
    assert.deepEqual(timeInput({ minutes: 45, billable: false, note: " Onsite " }), { minutes: 45, billable: false, note: "Onsite" });
    assert.equal(timeInput({ minutes: 45 }).billable, true);
    assert.ok(timeInput({ minutes: 0 }).error);
    assert.ok(timeInput({ minutes: 1441 }).error);
    assert.ok(timeInput({ minutes: 2.5 }).error);
  });

  it("rounds timers to whole minutes, at least one", () => {
    const now = new Date("2026-10-28T10:30:00Z");
    assert.equal(timerMinutes("2026-10-28T10:29:50Z", now), 1);
    assert.equal(timerMinutes("2026-10-28T10:00:20Z", now), 30);
    assert.equal(timerMinutes("2026-10-26T10:00:00Z", now), 1440);
  });

  it("totals billable time separately", () => {
    assert.deepEqual(timeTotals([{ minutes: 30, billable: true }, { minutes: 15, billable: false }]), { totalMinutes: 45, billableMinutes: 30 });
  });
});
