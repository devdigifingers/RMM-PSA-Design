import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { insertAudit } from "./audit.js";
import { mailConfigured, sendMail } from "./mail.js";
import { parseInvite } from "./invite-input.js";

export { parseInvite };

const INVITE_DAYS = 7;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function consoleUrl() {
  return String(process.env.CONSOLE_URL || "https://rmm.digitalfingers.co.za").replace(/\/+$/, "");
}

function inviteView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by_name || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() < Date.now(),
  };
}

export async function listInvites(orgId) {
  const rows = await pool.query(
    `SELECT i.*, u.name AS invited_by_name
     FROM user_invites i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     ORDER BY i.created_at DESC`,
    [orgId],
  );
  return rows.rows.map(inviteView);
}

async function openInviteCount(client, orgId) {
  const result = await client.query(
    "SELECT count(*)::int AS n FROM user_invites WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
    [orgId],
  );
  return result.rows[0].n;
}

// Returns { status, error } or { status: 201, id }. The token only ever leaves in the email.
export async function createInvite(h, { orgId, actor, input }) {
  const token = randomBytes(32).toString("base64url");
  const client = await pool.connect();
  let invite;
  let orgName = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM licenses WHERE org_id = $1 FOR UPDATE", [orgId]);
    const org = await client.query("SELECT name FROM orgs WHERE id = $1", [orgId]);
    if (!org.rows[0]) {
      await client.query("ROLLBACK");
      return { status: 404, error: "Tenant not found." };
    }
    orgName = org.rows[0].name;
    if ((await h.seatsLeft(client, orgId)) - (await openInviteCount(client, orgId)) < 1) {
      await client.query("ROLLBACK");
      return { status: 409, error: "All seats on the license are in use or held by open invites. Disable someone or add seats first." };
    }
    const existing = await client.query("SELECT 1 FROM users WHERE lower(email) = $1", [input.email]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return { status: 409, error: "That email already has a login." };
    }
    await client.query(
      "UPDATE user_invites SET revoked_at = now() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()",
      [input.email],
    );
    const inserted = await client.query(
      `INSERT INTO user_invites (org_id, email, name, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
       RETURNING id, expires_at`,
      [orgId, input.email, input.name, input.role, sha256(token), actor.id, INVITE_DAYS],
    );
    invite = inserted.rows[0];
    await insertAudit(client, orgId, actor.id, "user.invite", "invite", invite.id, { email: input.email, role: input.role });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return { status: 409, error: "That email already has an open invite." };
    throw error;
  } finally {
    client.release();
  }

  const link = `${consoleUrl()}/invite/${token}`;
  let sent = false;
  try {
    sent = mailConfigured() && (await sendMail({
      to: input.email,
      subject: `You're invited to ${orgName} on Digital Fingers`,
      text: [
        `Hi ${input.name},`,
        "",
        `${actor.name || actor.email} invited you to ${orgName} on Digital Fingers.`,
        "",
        "Set your password and sign in:",
        link,
        "",
        `This link expires in ${INVITE_DAYS} days. If you weren't expecting it, ignore this email.`,
      ].join("\n"),
    }));
  } catch (error) {
    console.error(`invite mail failed: ${error.message}`);
  }
  if (!sent) {
    await pool.query("UPDATE user_invites SET revoked_at = now() WHERE id = $1", [invite.id]);
    return { status: 502, error: "The invite email could not be sent, so the invite was cancelled. Check the mail settings or add the user with a password." };
  }
  return { status: 201, id: Number(invite.id) };
}

export async function revokeInvite(orgId, actorId, inviteId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const done = await client.query(
      "UPDATE user_invites SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email",
      [inviteId, orgId],
    );
    if (!done.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await insertAudit(client, orgId, actorId, "user.invite_revoke", "invite", inviteId, { email: done.rows[0].email });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function inviteByToken(db, token, { lock = false } = {}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const result = await db.query(
    `SELECT i.*, o.name AS org_name
     FROM user_invites i JOIN orgs o ON o.id = i.org_id
     WHERE i.token_hash = $1${lock ? " FOR UPDATE OF i" : ""}`,
    [sha256(token)],
  );
  return result.rows[0] || null;
}

function inviteState(row) {
  if (!row || row.revoked_at) return "invalid";
  if (row.accepted_at) return "used";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "open";
}

export async function handleInvites(req, res, url, actor, h) {
  const tokenMatch = url.pathname.match(/^\/v1\/invites\/([A-Za-z0-9_-]+)(\/accept)?$/);
  if (tokenMatch) {
    if (req.method === "GET" && !tokenMatch[2]) {
      const row = await inviteByToken(pool, tokenMatch[1]);
      const state = inviteState(row);
      if (state === "invalid") return h.send(res, 404, { error: "This invite link is not valid." }), true;
      h.send(res, 200, { state, orgName: row.org_name, name: row.name, email: row.email });
      return true;
    }
    if (req.method === "POST" && tokenMatch[2]) {
      const body = await h.readJson(req);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 200) return h.send(res, 400, { error: "Use at least 8 characters." }), true;
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
      const passwordHash = await h.hashPassword(password);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await inviteByToken(client, tokenMatch[1], { lock: true });
        const state = inviteState(row);
        if (state !== "open") {
          await client.query("ROLLBACK");
          const message = state === "expired" ? "This invite has expired. Ask for a new one." : state === "used" ? "This invite was already used. Sign in instead." : "This invite link is not valid.";
          return h.send(res, state === "invalid" ? 404 : 410, { error: message }), true;
        }
        await client.query("SELECT id FROM licenses WHERE org_id = $1 FOR UPDATE", [row.org_id]);
        if ((await h.seatsLeft(client, row.org_id)) < 1) {
          await client.query("ROLLBACK");
          return h.send(res, 409, { error: "All seats on this organisation's license are in use. Ask your admin to free a seat." }), true;
        }
        const user = await client.query(
          `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin)
           VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [row.org_id, row.email, name || row.name, passwordHash],
        );
        const userId = user.rows[0].id;
        await h.setUserRole(client, row.org_id, userId, row.role);
        await client.query("UPDATE user_invites SET accepted_at = now(), accepted_user_id = $2 WHERE id = $1", [row.id, userId]);
        await insertAudit(client, row.org_id, userId, "user.invite_accept", "user", userId, { inviteId: String(row.id), role: row.role });
        await client.query("COMMIT");
        h.send(res, 201, { ok: true, email: row.email });
        return true;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error.code === "23505") return h.send(res, 409, { error: "That email already has a login. Sign in instead." }), true;
        throw error;
      } finally {
        client.release();
      }
    }
    return false;
  }

  const platformMatch = url.pathname.match(/^\/v1\/platform\/tenants\/(\d+)\/invites$/);
  if (platformMatch) {
    if (!h.requirePlatform(actor, res)) return true;
    const orgId = Number(platformMatch[1]);
    if (req.method === "GET") return h.send(res, 200, { invites: await listInvites(orgId) }), true;
    if (req.method === "POST") {
      const parsed = parseInvite(await h.readJson(req));
      if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
      const result = await createInvite(h, { orgId, actor, input: parsed.value });
      h.send(res, result.status, result.error ? { error: result.error } : { id: result.id });
      return true;
    }
    return false;
  }
  const platformRevoke = url.pathname.match(/^\/v1\/platform\/tenants\/(\d+)\/invites\/(\d+)$/);
  if (platformRevoke && req.method === "DELETE") {
    if (!h.requirePlatform(actor, res)) return true;
    const ok = await revokeInvite(Number(platformRevoke[1]), actor.id, Number(platformRevoke[2]));
    h.send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "That invite is not open." });
    return true;
  }

  if (url.pathname === "/v1/users/invites" || /^\/v1\/users\/invites\/\d+$/.test(url.pathname)) {
    if (!actor) return h.send(res, 401, { error: "Login required." }), true;
    if (!actor.org_id) return h.send(res, 400, { error: "This login is not linked to an organisation." }), true;
    if (!h.canOperate(actor)) return h.send(res, 403, { error: "Only an owner or admin can invite people." }), true;
    if (req.method === "GET" && url.pathname === "/v1/users/invites") {
      return h.send(res, 200, { invites: await listInvites(actor.org_id) }), true;
    }
    if (req.method === "POST" && url.pathname === "/v1/users/invites") {
      const parsed = parseInvite(await h.readJson(req));
      if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
      if (parsed.value.role === "owner" && !actor.roles.includes("owner")) {
        return h.send(res, 403, { error: "Only an owner can invite another owner." }), true;
      }
      const result = await createInvite(h, { orgId: actor.org_id, actor, input: parsed.value });
      h.send(res, result.status, result.error ? { error: result.error } : { id: result.id });
      return true;
    }
    if (req.method === "DELETE") {
      const ok = await revokeInvite(actor.org_id, actor.id, Number(url.pathname.split("/").pop()));
      h.send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "That invite is not open." });
      return true;
    }
    h.send(res, 405, { error: "Method not allowed." });
    return true;
  }
  return false;
}
