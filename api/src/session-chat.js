// Session Panel chat (Phase B): text chat between the technician's session window and the customer's Session Panel.
// Messages are stored with the session; every query is scoped by the tenant, and the technician's side also by the
// technician, so nobody outside the session can read or write it. Long-polls wait on in-process wake-ups; the
// database stays the source of truth, so a missed wake-up only delays a message until the next poll.
import { EventEmitter } from "node:events";

export const CHAT_MAX = 2000;
export const CHAT_WAIT_MS = 25000;
export const CHAT_SIDES = ["technician", "customer"];
const TYPING_MS = 6000;
const HISTORY_LIMIT = 500;

const other = (side) => (side === "technician" ? "customer" : "technician");

// What one side sent: a message, a typing signal or a read mark.
export function chatInput(body) {
  if (typeof body?.text === "string") {
    const text = body.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    if (!text) return { error: "Type a message first." };
    if (text.length > CHAT_MAX) return { error: `Messages can be at most ${CHAT_MAX} characters.` };
    return { kind: "send", text };
  }
  if (typeof body?.typing === "boolean") return { kind: "typing", on: body.typing };
  const read = Number(body?.read);
  if (Number.isSafeInteger(read) && read > 0) return { kind: "read", id: read };
  return { error: "Send a message, a typing signal or a read mark." };
}

// The long-poll's "what I already know": the last message id, and the other side's typing and read state.
export function chatCursor(query) {
  const number = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  };
  return {
    after: number(query.get("after")),
    typing: query.get("typing") === "1",
    read: number(query.get("read")),
    wait: query.get("wait") === "1",
  };
}

export function messageView(row) {
  return {
    id: Number(row.id),
    from: row.sender,
    name: row.sender_name || (row.sender === "technician" ? "Technician" : "Customer"),
    text: row.body,
    at: new Date(row.created_at).toISOString(),
  };
}

const bus = new EventEmitter();
bus.setMaxListeners(0);
const typingUntil = new Map();

function wake(sessionId) {
  bus.emit(String(sessionId));
}

export function setTyping(sessionId, side, on, now = Date.now()) {
  const key = `${sessionId}:${side}`;
  const was = (typingUntil.get(key) || 0) > now;
  if (on) typingUntil.set(key, now + TYPING_MS);
  else typingUntil.delete(key);
  if (was !== on) wake(sessionId);
}

export function isTyping(sessionId, side, now = Date.now()) {
  const key = `${sessionId}:${side}`;
  const until = typingUntil.get(key) || 0;
  if (until <= now) typingUntil.delete(key);
  return until > now;
}

// Resolves when the session's chat changes, after ms, or when the request closes, whichever is first.
export function waitForChat(sessionId, ms, req = null) {
  return new Promise((resolve) => {
    const key = String(sessionId);
    const done = () => {
      clearTimeout(timer);
      bus.off(key, done);
      req?.off?.("close", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    bus.on(key, done);
    req?.on?.("close", done);
  });
}

// The technician's current session on a device: their own, in their own tenant, from the last 12 hours.
export async function technicianChatSession(db, { deviceId, orgId, userId }) {
  const found = await db.query(
    `SELECT rs.id, rs.ended_by, rs.ticket_id, d.support_panel, o.panel_options
     FROM remote_sessions rs
     JOIN devices d ON d.id = rs.device_id AND d.org_id = rs.org_id
     JOIN orgs o ON o.id = rs.org_id
     WHERE rs.device_id = $1 AND rs.org_id = $2 AND rs.user_id = $3 AND rs.status <> 'untracked'
       AND rs.started_at > now() - interval '12 hours'
     ORDER BY rs.id DESC
     LIMIT 1`,
    [deviceId, orgId, userId],
  );
  return found.rows[0] || null;
}

export async function addMessage(db, { orgId, sessionId, sender, userId = null, name = "", text }) {
  const saved = await db.query(
    `INSERT INTO remote_session_messages (org_id, session_id, sender, user_id, sender_name, body)
     SELECT rs.org_id, rs.id, $3, $4, $5, $6 FROM remote_sessions rs
     WHERE rs.id = $1 AND rs.org_id = $2 AND rs.ended_by IS NULL
     RETURNING id, sender, sender_name, body, created_at`,
    [sessionId, orgId, sender, userId, String(name || "").slice(0, 120), text],
  );
  const row = saved.rows[0];
  if (!row) return null;
  setTyping(sessionId, sender, false);
  wake(sessionId);
  return messageView(row);
}

export async function markRead(db, { orgId, sessionId, side, id }) {
  const column = side === "technician" ? "chat_read_technician" : "chat_read_customer";
  const saved = await db.query(
    `UPDATE remote_sessions SET ${column} = $3
     WHERE id = $1 AND org_id = $2 AND COALESCE(${column}, 0) < $3
       AND $3 <= (SELECT COALESCE(max(id), 0) FROM remote_session_messages WHERE session_id = $1)
     RETURNING id`,
    [sessionId, orgId, id],
  );
  if (saved.rows[0]) wake(sessionId);
}

// What one side sees: messages after its cursor, whether the other side is typing, and how far the other side read.
export async function chatState(db, { orgId, sessionId, side, after = 0 }) {
  const [messages, marks] = await Promise.all([
    db.query(
      `SELECT id, sender, sender_name, body, created_at FROM remote_session_messages
       WHERE session_id = $1 AND org_id = $2 AND id > $3
       ORDER BY id
       LIMIT ${HISTORY_LIMIT}`,
      [sessionId, orgId, after],
    ),
    db.query("SELECT chat_read_technician, chat_read_customer FROM remote_sessions WHERE id = $1 AND org_id = $2", [sessionId, orgId]),
  ]);
  const row = marks.rows[0] || {};
  const read = side === "technician" ? row.chat_read_customer : row.chat_read_technician;
  return {
    sessionId: Number(sessionId),
    messages: messages.rows.map(messageView),
    typing: isTyping(sessionId, other(side)),
    read: read == null ? 0 : Number(read),
  };
}

// chatState, held open up to CHAT_WAIT_MS while nothing the caller doesn't already know has changed.
export async function waitChatState(db, { orgId, sessionId, side, cursor, req = null, waitMs = CHAT_WAIT_MS }) {
  const state = await chatState(db, { orgId, sessionId, side, after: cursor.after });
  const unchanged = !state.messages.length && state.typing === cursor.typing && state.read === cursor.read;
  if (!cursor.wait || !unchanged) return state;
  await waitForChat(sessionId, waitMs, req);
  return chatState(db, { orgId, sessionId, side, after: cursor.after });
}

// The full conversation for the timeline's transcript view, within the tenant.
export async function chatTranscript(db, { orgId, sessionId }) {
  const session = await db.query(
    `SELECT rs.id, rs.started_at, rs.device_id, rs.ticket_id, COALESCE(d.hostname, rs.device_name) AS device_name, u.name AS technician_name
     FROM remote_sessions rs
     LEFT JOIN devices d ON d.id = rs.device_id AND d.org_id = rs.org_id
     LEFT JOIN users u ON u.id = rs.user_id
     WHERE rs.id = $1 AND rs.org_id = $2`,
    [sessionId, orgId],
  );
  const row = session.rows[0];
  if (!row) return null;
  const messages = await db.query(
    `SELECT id, sender, sender_name, body, created_at FROM remote_session_messages
     WHERE session_id = $1 AND org_id = $2 ORDER BY id`,
    [sessionId, orgId],
  );
  return {
    session: {
      id: Number(row.id),
      startedAt: new Date(row.started_at).toISOString(),
      device: row.device_id == null ? null : { id: Number(row.device_id), name: row.device_name || null },
      ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
      technician: row.technician_name || null,
    },
    messages: messages.rows.map(messageView),
  };
}

// Conversations whose session is over and that are not on the timelines yet. Claimed one at a time, so a second
// sweep can't log the same chat twice.
export async function finishedChats(db, limit = 50) {
  const found = await db.query(
    `SELECT rs.id, rs.org_id, rs.device_id, rs.ticket_id, rs.user_id,
            (SELECT count(*) FROM remote_session_messages m WHERE m.session_id = rs.id) AS messages
     FROM remote_sessions rs
     WHERE rs.id IN (SELECT DISTINCT session_id FROM remote_session_messages WHERE created_at > now() - interval '7 days')
       AND rs.chat_logged_at IS NULL
       AND (rs.ended_by IS NOT NULL OR rs.ended_at IS NOT NULL
            OR COALESCE(rs.shell_seen_at, rs.started_at) < now() - interval '10 minutes')
     ORDER BY rs.id
     LIMIT $1`,
    [limit],
  );
  return found.rows;
}

export async function claimChatLog(db, sessionId) {
  const claimed = await db.query(
    "UPDATE remote_sessions SET chat_logged_at = now() WHERE id = $1 AND chat_logged_at IS NULL RETURNING id",
    [sessionId],
  );
  return Boolean(claimed.rows[0]);
}
