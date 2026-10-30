import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { insertAudit } from "./audit.js";
import { mailConfigured, sendMail } from "./mail.js";
import { PLATFORM_ROLES, PLATFORM_ROLE_LABEL, lastSuperGuard, parsePlatformInvite } from "./platform-team-rules.js";

const INVITE_DAYS = 7;
export const PLATFORM_TEAM_NAME = "the Digital Fingers platform team";

function consoleUrl() {
  return String(process.env.CONSOLE_URL || "https://rmm.digitalfingers.co.za").replace(/\/+$/, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function memberView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.platform_role,
    mfaEnabled: Boolean(row.mfa_enabled_at),
    mfaDueAt: row.mfa_enabled_at ? null : row.platform_mfa_due_at,
    active: !row.disabled_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
  };
}

function inviteView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.platform_role,
    invitedBy: row.invited_by_name || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() < Date.now(),
  };
}

async function teamView() {
  const [members, invites] = await Promise.all([
    pool.query(
      `SELECT id, name, email, platform_role, mfa_enabled_at, platform_mfa_due_at, disabled_at, created_at
       FROM users WHERE is_platform_admin = true
       ORDER BY disabled_at IS NOT NULL, array_position(ARRAY['super', 'admin', 'support'], platform_role), name`,
    ),
    pool.query(
      `SELECT i.*, u.name AS invited_by_name
       FROM platform_invites i LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC`,
    ),
  ]);
  return { members: members.rows.map(memberView), invites: invites.rows.map(inviteView) };
}

async function lockedSupers(client) {
  const rows = await client.query(
    "SELECT id FROM users WHERE is_platform_admin = true AND platform_role = 'super' AND disabled_at IS NULL ORDER BY id FOR UPDATE",
  );
  return rows.rows;
}

async function lockedMember(client, id) {
  const rows = await client.query(
    "SELECT id, name, email, platform_role, disabled_at, mfa_enabled_at FROM users WHERE id = $1 AND is_platform_admin = true FOR UPDATE",
    [id],
  );
  return rows.rows[0] || null;
}

// Runs fn inside a transaction; fn returns { status, error } or { status, body, revoke }.
async function change(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query(result.error ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createInvite(actor, input) {
  const token = randomBytes(32).toString("base64url");
  let invite;
  try {
    invite = await change(async (client) => {
      const existing = await client.query("SELECT 1 FROM users WHERE lower(email) = $1", [input.email]);
      if (existing.rows[0]) return { status: 409, error: "That email already has a login. Use a different address for the platform account." };
      await client.query(
        "UPDATE platform_invites SET revoked_at = now() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()",
        [input.email],
      );
      const inserted = await client.query(
        `INSERT INTO platform_invites (email, name, platform_role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         RETURNING id`,
        [input.email, input.name, input.role, sha256(token), actor.id, INVITE_DAYS],
      );
      const id = Number(inserted.rows[0].id);
      await insertAudit(client, null, actor.id, "platform.invite", "platform_invite", id, { email: input.email, role: input.role });
      return { status: 201, id };
    });
  } catch (error) {
    if (error.code === "23505") return { status: 409, error: "That email already has an open invite." };
    throw error;
  }
  if (invite.error) return invite;

  let sent = false;
  try {
    sent = mailConfigured() && (await sendMail({
      to: input.email,
      subject: "You're invited to the Digital Fingers platform team",
      text: [
        `Hi ${input.name},`,
        "",
        `${actor.name || actor.email} invited you to the Digital Fingers platform team as ${PLATFORM_ROLE_LABEL[input.role]}.`,
        "",
        "Set your password here. At your first sign-in you will set up an authenticator app on your phone; platform accounts always need one.",
        `${consoleUrl()}/invite/${token}`,
        "",
        `This link expires in ${INVITE_DAYS} days. If you weren't expecting it, ignore this email.`,
      ].join("\n"),
    }));
  } catch (error) {
    console.error(`platform invite mail failed: ${error.message}`);
  }
  if (!sent) {
    await pool.query("UPDATE platform_invites SET revoked_at = now() WHERE id = $1", [invite.id]);
    return { status: 502, error: "The invite email could not be sent, so the invite was cancelled. Check the mail settings." };
  }
  return invite;
}

export async function platformInviteByToken(db, token, { lock = false } = {}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const result = await db.query(`SELECT * FROM platform_invites WHERE token_hash = $1${lock ? " FOR UPDATE" : ""}`, [sha256(token)]);
  return result.rows[0] || null;
}

// The invite row is already locked and open. New platform accounts set up MFA at their first sign-in.
export async function acceptPlatformInvite(client, row, { name, passwordHash }) {
  const user = await client.query(
    `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin, platform_role, platform_mfa_due_at)
     VALUES (NULL, $1, $2, $3, true, $4, now()) RETURNING id`,
    [row.email, name || row.name, passwordHash, row.platform_role],
  );
  const userId = Number(user.rows[0].id);
  await client.query("UPDATE platform_invites SET accepted_at = now(), accepted_user_id = $2 WHERE id = $1", [row.id, userId]);
  await insertAudit(client, null, userId, "platform.invite_accept", "user", userId, { inviteId: String(row.id), role: row.platform_role });
  return userId;
}

function requireSuper(actor, res, h) {
  if (!h.requirePlatform(actor, res)) return false;
  if (actor.platform_role !== "super") {
    h.send(res, 403, { error: "Only a super admin can change the platform team." });
    return false;
  }
  return true;
}

export async function handlePlatformTeam(req, res, url, actor, h) {
  const path = url.pathname;
  if (!path.startsWith("/v1/platform/team")) return false;

  if (req.method === "GET" && path === "/v1/platform/team") {
    if (!h.requirePlatform(actor, res)) return true;
    return h.send(res, 200, { ...(await teamView()), you: { id: Number(actor.id), role: actor.platform_role } }), true;
  }

  if (req.method === "POST" && path === "/v1/platform/team/invites") {
    if (!requireSuper(actor, res, h)) return true;
    const parsed = parsePlatformInvite(await h.readJson(req));
    if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
    const result = await createInvite(actor, parsed.value);
    return h.send(res, result.status, result.error ? { error: result.error } : { id: result.id }), true;
  }

  const inviteMatch = path.match(/^\/v1\/platform\/team\/invites\/(\d+)$/);
  if (req.method === "DELETE" && inviteMatch) {
    if (!requireSuper(actor, res, h)) return true;
    const result = await change(async (client) => {
      const done = await client.query(
        "UPDATE platform_invites SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email",
        [inviteMatch[1]],
      );
      if (!done.rows[0]) return { status: 404, error: "That invite is not open." };
      await insertAudit(client, null, actor.id, "platform.invite_revoke", "platform_invite", inviteMatch[1], { email: done.rows[0].email });
      return { status: 200 };
    });
    return h.send(res, result.status, result.error ? { error: result.error } : { ok: true }), true;
  }

  const memberMatch = path.match(/^\/v1\/platform\/team\/(\d+)(?:\/(disable|enable|reset-mfa))?$/);
  if (!memberMatch) return false;
  const memberId = Number(memberMatch[1]);
  const action = memberMatch[2] || (req.method === "PUT" ? "role" : null);
  if (!action || (action === "role" ? req.method !== "PUT" : req.method !== "POST")) {
    return h.send(res, 405, { error: "Method not allowed." }), true;
  }
  if (!requireSuper(actor, res, h)) return true;
  if (memberId === Number(actor.id)) {
    return h.send(res, 400, { error: "You can't change your own platform account here. Ask another super admin." }), true;
  }
  const body = action === "role" ? await h.readJson(req) : {};
  const result = await change(async (client) => {
    const supers = await lockedSupers(client);
    const member = await lockedMember(client, memberId);
    if (!member) return { status: 404, error: "That platform account was not found." };
    const active = !member.disabled_at;
    if (action === "role") {
      const role = typeof body.role === "string" ? body.role : "";
      if (!PLATFORM_ROLES.includes(role)) return { status: 400, error: "Choose a level." };
      if (role === member.platform_role) return { status: 200, body: { changed: false } };
      const blocked = lastSuperGuard(supers, memberId, role, active);
      if (blocked) return { status: 409, error: blocked };
      await client.query("UPDATE users SET platform_role = $2 WHERE id = $1", [memberId, role]);
      await insertAudit(client, null, actor.id, "platform.role_change", "user", memberId, { email: member.email, from: member.platform_role, to: role });
      return { status: 200, body: { changed: true }, revoke: true };
    }
    if (action === "disable") {
      if (!active) return { status: 200, body: { changed: false } };
      const blocked = lastSuperGuard(supers, memberId, member.platform_role, false);
      if (blocked) return { status: 409, error: blocked };
      await client.query("UPDATE users SET disabled_at = now() WHERE id = $1", [memberId]);
      await insertAudit(client, null, actor.id, "platform.disable", "user", memberId, { email: member.email, role: member.platform_role });
      return { status: 200, body: { changed: true }, revoke: true };
    }
    if (action === "enable") {
      if (active) return { status: 200, body: { changed: false } };
      await client.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [memberId]);
      await insertAudit(client, null, actor.id, "platform.enable", "user", memberId, { email: member.email, role: member.platform_role });
      return { status: 200, body: { changed: true } };
    }
    await client.query(
      "UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery = NULL, platform_mfa_due_at = now() WHERE id = $1",
      [memberId],
    );
    await insertAudit(client, null, actor.id, "platform.mfa_reset", "user", memberId, { email: member.email });
    return { status: 200, body: { changed: true }, revoke: true };
  });
  if (result.revoke) await h.revokeUserSessions(memberId, null);
  return h.send(res, result.status, result.error ? { error: result.error } : result.body), true;
}
