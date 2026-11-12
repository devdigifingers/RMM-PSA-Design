// Tenant isolation for Session Panel chat. Runs against a throwaway Postgres with schema.sql applied; skipped unless
// BILLING_TEST_DB=1 (PG* variables point at that database).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const enabled = process.env.BILLING_TEST_DB === "1";

describe("session chat (database)", { skip: !enabled }, () => {
  let pool, chat;
  let orgA, orgB, techA, techA2, techB, deviceA, sessionA;

  before(async () => {
    ({ pool } = await import("../src/db.js"));
    chat = await import("../src/session-chat.js");
    const suffix = Date.now();
    const org = async (name) => Number((await pool.query("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, `${name}-${suffix}`.toLowerCase().replace(/\W+/g, "-")])).rows[0].id);
    const user = async (orgId, email, name) => Number((await pool.query("INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id", [orgId, `${email}-${suffix}@example.test`, name])).rows[0].id);
    orgA = await org("Chat Tenant A");
    orgB = await org("Chat Tenant B");
    techA = await user(orgA, "chat-a", "Thandi Mokoena");
    techA2 = await user(orgA, "chat-a2", "Sipho Dlamini");
    techB = await user(orgB, "chat-b", "Pieter Botha");
    deviceA = Number((await pool.query("INSERT INTO devices (org_id, hostname, os_name) VALUES ($1, 'CHAT-A-01', 'Windows 11 Pro') RETURNING id", [orgA])).rows[0].id);
    sessionA = Number((await pool.query(
      "INSERT INTO remote_sessions (org_id, device_id, user_id, device_name, status) VALUES ($1, $2, $3, 'CHAT-A-01', 'live') RETURNING id",
      [orgA, deviceA, techA],
    )).rows[0].id);
  });

  after(async () => {
    await pool?.end();
  });

  it("finds the chat only for the session's own technician in its own tenant", async () => {
    assert.equal(Number((await chat.technicianChatSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA })).id), sessionA);
    assert.equal(await chat.technicianChatSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA2 }), null);
    assert.equal(await chat.technicianChatSession(pool, { deviceId: deviceA, orgId: orgB, userId: techB }), null);
    assert.equal(await chat.technicianChatSession(pool, { deviceId: deviceA, orgId: orgB, userId: techA }), null);
  });

  it("stores messages both ways and never writes or reads through another tenant", async () => {
    const hello = await chat.addMessage(pool, { orgId: orgA, sessionId: sessionA, sender: "technician", userId: techA, name: "Thandi Mokoena", text: "Hello" });
    const reply = await chat.addMessage(pool, { orgId: orgA, sessionId: sessionA, sender: "customer", name: "HNA", text: "Hi" });
    assert.equal(hello.from, "technician");
    assert.equal(reply.from, "customer");
    assert.equal(await chat.addMessage(pool, { orgId: orgB, sessionId: sessionA, sender: "technician", userId: techB, text: "Sneaky" }), null);
    assert.equal((await chat.chatState(pool, { orgId: orgB, sessionId: sessionA, side: "technician" })).messages.length, 0);
    assert.equal(await chat.chatTranscript(pool, { orgId: orgB, sessionId: sessionA }), null);
    const state = await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "customer", after: hello.id });
    assert.deepEqual(state.messages.map((m) => m.text), ["Hi"]);
  });

  it("keeps read marks per side, within the tenant, and never past the last message", async () => {
    const last = (await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "customer" })).messages.at(-1).id;
    await chat.markRead(pool, { orgId: orgB, sessionId: sessionA, side: "customer", id: last });
    assert.equal((await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "technician" })).read, 0);
    await chat.markRead(pool, { orgId: orgA, sessionId: sessionA, side: "customer", id: last + 1000 });
    assert.equal((await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "technician" })).read, 0);
    await chat.markRead(pool, { orgId: orgA, sessionId: sessionA, side: "customer", id: last });
    assert.equal((await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "technician" })).read, last);
    assert.equal((await chat.chatState(pool, { orgId: orgA, sessionId: sessionA, side: "customer" })).read, 0);
  });

  it("refuses new messages once the customer ends, then logs the chat to the timeline exactly once", async () => {
    await pool.query("UPDATE remote_sessions SET ended_by = 'customer', status = 'ended', ended_at = now() WHERE id = $1", [sessionA]);
    assert.equal(await chat.addMessage(pool, { orgId: orgA, sessionId: sessionA, sender: "technician", userId: techA, text: "Still there?" }), null);
    const due = (await chat.finishedChats(pool, 500)).find((row) => Number(row.id) === sessionA);
    assert.equal(Number(due.messages), 2);
    assert.equal(Number(due.org_id), orgA);
    assert.equal(await chat.claimChatLog(pool, sessionA), true);
    assert.equal(await chat.claimChatLog(pool, sessionA), false);
    assert.equal((await chat.finishedChats(pool, 500)).some((row) => Number(row.id) === sessionA), false);
    const transcript = await chat.chatTranscript(pool, { orgId: orgA, sessionId: sessionA });
    assert.equal(transcript.session.technician, "Thandi Mokoena");
    assert.deepEqual(transcript.messages.map((m) => m.from), ["technician", "customer"]);
  });
});
