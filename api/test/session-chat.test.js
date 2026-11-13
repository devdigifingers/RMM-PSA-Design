import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityFromAudit } from "../src/activity.js";
import { CHAT_MAX, chatCursor, chatInput, isTyping, messageView, setTyping, waitChatState, waitForChat } from "../src/session-chat.js";

describe("session chat input", () => {
  it("accepts a message, trimmed, with line breaks kept and control characters dropped", () => {
    assert.deepEqual(chatInput({ text: "  Hi there\r\nCan you see my screen?\u0007  " }), { kind: "send", text: "Hi there\nCan you see my screen?" });
  });

  it("refuses empty and over-long messages", () => {
    assert.ok(chatInput({ text: "   " }).error);
    assert.ok(chatInput({ text: "x".repeat(CHAT_MAX + 1) }).error);
    assert.equal(chatInput({ text: "x".repeat(CHAT_MAX) }).kind, "send");
  });

  it("reads typing signals and read marks", () => {
    assert.deepEqual(chatInput({ typing: true }), { kind: "typing", on: true });
    assert.deepEqual(chatInput({ read: "42" }), { kind: "read", id: 42 });
    assert.ok(chatInput({ read: -1 }).error);
    assert.ok(chatInput({}).error);
    assert.ok(chatInput(null).error);
  });

  it("reads the long-poll cursor, ignoring junk", () => {
    assert.deepEqual(chatCursor(new URLSearchParams("after=7&typing=1&read=5&files=2-lq3k9&wait=1")), { after: 7, typing: true, read: 5, files: "2-lq3k9", wait: true });
    assert.deepEqual(chatCursor(new URLSearchParams("after=abc&read=-3&files=<x>")), { after: 0, typing: false, read: 0, files: "", wait: false });
  });

  it("shows a message without database ids beyond its own", () => {
    const view = messageView({ id: "3", sender: "customer", sender_name: "", body: "Thanks", created_at: "2026-11-12T10:00:00Z", org_id: 9, user_id: 4 });
    assert.deepEqual(view, { id: 3, from: "customer", name: "Customer", text: "Thanks", at: "2026-11-12T10:00:00.000Z" });
  });
});

describe("session chat typing and wake-ups", () => {
  it("expires typing after a few seconds and clears it on demand", () => {
    setTyping(900001, "customer", true, 1000);
    assert.equal(isTyping(900001, "customer", 2000), true);
    assert.equal(isTyping(900001, "technician", 2000), false);
    assert.equal(isTyping(900001, "customer", 8000), false);
    setTyping(900001, "customer", true);
    setTyping(900001, "customer", false);
    assert.equal(isTyping(900001, "customer"), false);
  });

  it("wakes a waiting long-poll when the other side starts typing", async () => {
    const started = Date.now();
    const waiting = waitForChat(900002, 5000);
    setTimeout(() => setTyping(900002, "technician", true), 20);
    await waiting;
    assert.ok(Date.now() - started < 2000);
    setTyping(900002, "technician", false);
  });

  it("answers at once when the caller is behind, and waits only when nothing changed", async () => {
    const rows = [{ id: 5, sender: "technician", sender_name: "Thandi", body: "Hello", created_at: new Date() }];
    const files = [];
    const db = {
      query: async (sql, params) => {
        if (sql.includes("remote_session_messages")) return { rows: rows.filter((row) => row.id > params[2]) };
        if (sql.includes("remote_session_files")) return { rows: files };
        return { rows: [{ chat_read_technician: null, chat_read_customer: null }] };
      },
    };
    const behind = await waitChatState(db, { orgId: 1, sessionId: 900003, side: "customer", cursor: { after: 0, typing: false, read: 0, wait: true } });
    assert.equal(behind.messages.length, 1);
    const started = Date.now();
    const current = await waitChatState(db, { orgId: 1, sessionId: 900003, side: "customer", cursor: { after: 5, typing: false, read: 0, wait: true }, waitMs: 50 });
    assert.equal(current.messages.length, 0);
    assert.ok(Date.now() - started >= 40);

    const at = new Date("2026-11-12T10:00:00Z");
    files.push({ id: 3, direction: "to_customer", sender_name: "Thandi", file_name: "setup.pdf", content_type: "application/pdf", size_bytes: "2048", status: "offered", created_at: at, updated_at: at });
    const fileStarted = Date.now();
    const offered = await waitChatState(db, { orgId: 1, sessionId: 900003, side: "customer", cursor: { after: 5, typing: false, read: 0, files: "0", wait: true }, waitMs: 2000 });
    assert.ok(Date.now() - fileStarted < 1000);
    assert.equal(offered.files[0].name, "setup.pdf");
    assert.notEqual(offered.filesRev, "0");
  });
});

describe("session chat on the timeline", () => {
  it("logs one entry per session with the message count and a link to the transcript", () => {
    const event = activityFromAudit({ action: "remote.chat", targetType: "device", targetId: "16", detail: { sessionId: 88, messages: 6, ticketId: 12 }, actorId: 4 });
    assert.equal(event.deviceId, 16);
    assert.equal(event.ticketId, 12);
    assert.equal(event.payload.chatSessionId, 88);
    assert.match(event.summary, /6 messages/);
    assert.match(activityFromAudit({ action: "remote.chat", targetType: "device", targetId: "16", detail: { sessionId: 88, messages: 1 } }).summary, /1 message\)/);
  });
});
