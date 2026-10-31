import { pool } from "./db.js";
import { insertAudit } from "./audit.js";
import { JOB_BODY_LIMIT, parseJobInput, scriptProblem } from "./job-input.js";
import {
  CALLS_PER_MINUTE,
  MAX_ACTIVE_TOKENS,
  hashToken,
  newToken,
  parseTokenRequest,
  tokenFromHeader,
  tokenHint,
  tokenProblem,
  tokenView,
} from "./api-token-rules.js";

function reply(h, res, status, body) {
  h.send(res, status, body);
  return true;
}

const LIST_SQL = `SELECT t.id, t.name, t.hint, t.scopes, t.allowed_ips, t.created_at, t.expires_at, t.last_used_at,
         t.last_used_ip, t.revoked_at, u.name AS created_by_name,
         (SELECT COALESCE(json_agg(json_build_object('id', d.id, 'name', COALESCE(d.display_name, d.hostname)) ORDER BY d.hostname), '[]')
          FROM devices d WHERE d.id = ANY(t.device_ids) AND d.org_id = t.org_id) AS devices
  FROM api_tokens t LEFT JOIN users u ON u.id = t.created_by
  WHERE t.org_id = $1`;

// Organisation settings → Security → API tokens (owners and admins).
export async function handleApiTokens(req, res, url, actor, h) {
  if (!url.pathname.startsWith("/v1/org/api-tokens")) return false;
  if (!h.requireActor(actor, res)) return true;
  if (!actor.org_id) return reply(h, res, 403, { error: "This account is not in an org." });
  if (!h.canOperate(actor)) return reply(h, res, 403, { error: "Only an owner or admin can manage API tokens." });

  if (req.method === "GET" && url.pathname === "/v1/org/api-tokens") {
    const [tokens, devices] = await Promise.all([
      pool.query(`${LIST_SQL} ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC LIMIT 200`, [actor.org_id]),
      pool.query("SELECT id, hostname, display_name, os_name FROM devices WHERE org_id = $1 ORDER BY hostname", [actor.org_id]),
    ]);
    return reply(h, res, 200, {
      tokens: tokens.rows.map(tokenView),
      devices: devices.rows.map((row) => ({ id: Number(row.id), name: row.display_name || row.hostname, hostname: row.hostname, osName: row.os_name })),
      canCreate: Boolean(actor.mfa_enabled_at) && !actor.impersonating,
      yourAddress: h.clientAddress(req),
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/org/api-tokens") {
    if (actor.impersonating) return reply(h, res, 403, { error: "API tokens cannot be created while viewing as a tenant." });
    if (!actor.mfa_enabled_at) return reply(h, res, 403, { error: "Turn on MFA for your account before creating API tokens." });
    const parsed = parseTokenRequest(await h.readJson(req), h.parseAllowlist);
    if (parsed.error) return reply(h, res, 400, { error: parsed.error });
    const input = parsed.value;
    const owned = await pool.query("SELECT id FROM devices WHERE org_id = $1 AND id = ANY($2::bigint[])", [actor.org_id, input.deviceIds]);
    if (owned.rows.length !== input.deviceIds.length) return reply(h, res, 400, { error: "One of the chosen devices is not in this organisation." });
    const license = await h.licenseQuery(actor.org_id);
    if (!h.hasApp(license.rows[0]?.entitlements, "remote")) {
      return reply(h, res, 403, { error: "Running commands needs Remote Desk.", code: "app_not_entitled", app: "remote" });
    }
    const active = await pool.query(
      "SELECT count(*)::int AS n FROM api_tokens WHERE org_id = $1 AND revoked_at IS NULL AND expires_at > now()",
      [actor.org_id],
    );
    if (active.rows[0].n >= MAX_ACTIVE_TOKENS) return reply(h, res, 409, { error: `Revoke an old token first; at most ${MAX_ACTIVE_TOKENS} can be active.` });
    const token = newToken();
    const saved = await pool.query(
      `INSERT INTO api_tokens (org_id, name, token_hash, hint, scopes, device_ids, allowed_ips, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9))
       RETURNING id, expires_at`,
      [actor.org_id, input.name, hashToken(token), tokenHint(token), input.scopes, input.deviceIds, input.allowedIps, actor.id, input.expiresInDays],
    );
    await insertAudit(pool, actor.org_id, actor.id, "api_token.create", "api_token", String(saved.rows[0].id), {
      name: input.name,
      devices: input.deviceIds.length,
      expiresInDays: input.expiresInDays,
      ipLimited: input.allowedIps.length > 0,
    });
    return reply(h, res, 201, { id: Number(saved.rows[0].id), token, expiresAt: saved.rows[0].expires_at });
  }

  const revokeMatch = url.pathname.match(/^\/v1\/org\/api-tokens\/(\d+)$/);
  if (req.method === "DELETE" && revokeMatch) {
    const revoked = await pool.query(
      "UPDATE api_tokens SET revoked_at = now(), revoked_by = $3 WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL RETURNING name",
      [revokeMatch[1], actor.org_id, actor.id],
    );
    if (!revoked.rows[0]) return reply(h, res, 404, { error: "Token not found or already revoked." });
    await insertAudit(pool, actor.org_id, actor.id, "api_token.revoke", "api_token", revokeMatch[1], { name: revoked.rows[0].name });
    return reply(h, res, 200, { ok: true });
  }

  return reply(h, res, 404, { error: "Not found." });
}

async function tokenFrom(req, res, h) {
  const token = tokenFromHeader(req.headers.authorization);
  if (!token) {
    h.send(res, 401, { error: "Send the API token as: Authorization: Bearer dfk_…" });
    return null;
  }
  const found = await pool.query(
    `SELECT t.*, cu.disabled_at AS creator_disabled_at,
            (cu.org_id = t.org_id AND EXISTS (
              SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = cu.id AND r.name IN ('owner', 'admin'))) AS creator_manages
     FROM api_tokens t JOIN users cu ON cu.id = t.created_by
     WHERE t.token_hash = $1`,
    [hashToken(token)],
  );
  const row = found.rows[0];
  const address = h.clientAddress(req);
  const problem = tokenProblem(row, { address, addressAllowed: h.addressAllowed });
  if (problem) {
    if (row && problem.status === 403) {
      await insertAudit(pool, row.org_id, null, "api_token.deny", "api_token", String(row.id), { name: row.name, reason: "address" });
    }
    h.send(res, problem.status, { error: problem.error });
    return null;
  }
  const minute = Math.floor(Date.now() / 60000);
  const key = `api-token-rate:${row.id}:${minute}`;
  const calls = await h.redis.incr(key);
  if (calls === 1) await h.redis.expire(key, 120);
  if (calls > CALLS_PER_MINUTE) {
    h.send(res, 429, { error: `Too many requests; at most ${CALLS_PER_MINUTE} a minute.` });
    return null;
  }
  await pool.query("UPDATE api_tokens SET last_used_at = now(), last_used_ip = $2 WHERE id = $1", [row.id, address]);
  return row;
}

function jobView(row) {
  return {
    id: Number(row.id),
    deviceId: Number(row.device_id),
    kind: row.kind,
    command: row.kind === "script" ? row.command.slice(0, 200) : row.command,
    status: row.status,
    exitCode: row.exit_code,
    output: row.output,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

// The API that tokens call: /v1/token/…, authenticated with "Authorization: Bearer dfk_…".
export async function handleTokenApi(req, res, url, h) {
  if (!url.pathname.startsWith("/v1/token/")) return false;
  const token = await tokenFrom(req, res, h);
  if (!token) return true;
  const deviceIds = (token.device_ids || []).map(Number);

  if (req.method === "GET" && url.pathname === "/v1/token/devices") {
    const devices = await pool.query(
      `SELECT id, hostname, display_name, os_name, last_seen_at, last_seen_at > now() - interval '60 seconds' AS online
       FROM devices WHERE org_id = $1 AND id = ANY($2::bigint[]) ORDER BY hostname`,
      [token.org_id, deviceIds],
    );
    return reply(h, res, 200, {
      devices: devices.rows.map((row) => ({
        id: Number(row.id),
        hostname: row.hostname,
        name: row.display_name || row.hostname,
        osName: row.os_name,
        online: row.online === true,
        lastSeenAt: row.last_seen_at,
      })),
    });
  }

  const jobMatch = url.pathname.match(/^\/v1\/token\/devices\/(\d+)\/jobs$/);
  if (req.method === "POST" && jobMatch) {
    const deviceId = Number(jobMatch[1]);
    if (!deviceIds.includes(deviceId)) {
      await insertAudit(pool, token.org_id, null, "api_token.deny", "device", String(deviceId), { name: token.name, reason: "device" });
      return reply(h, res, 403, { error: "This token is not allowed to use that device." });
    }
    const license = await h.licenseQuery(token.org_id);
    if (!h.hasApp(license.rows[0]?.entitlements, "remote")) {
      return reply(h, res, 403, { error: "Running commands needs Remote Desk.", code: "app_not_entitled", app: "remote" });
    }
    const parsed = parseJobInput(await h.readJson(req, JOB_BODY_LIMIT));
    if (parsed.error) return reply(h, res, 400, { error: parsed.error });
    const device = await pool.query("SELECT id, os_name, agent_version FROM devices WHERE id = $1 AND org_id = $2", [deviceId, token.org_id]);
    if (!device.rows[0]) return reply(h, res, 404, { error: "Device not found." });
    const { kind, text } = parsed.value;
    const unsupported = kind === "script" ? scriptProblem(device.rows[0]) : null;
    if (unsupported) return reply(h, res, 400, { error: unsupported });
    const job = await pool.query(
      `INSERT INTO jobs (org_id, device_id, command, kind, created_by, api_token_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [token.org_id, deviceId, text, kind, token.created_by, token.id],
    );
    await insertAudit(pool, token.org_id, token.created_by, "job.create", "job", String(job.rows[0].id), {
      deviceId,
      apiToken: token.name,
      kind,
      command: text.slice(0, 200),
      ...(kind === "script" ? { length: text.length } : {}),
    });
    return reply(h, res, 201, { id: Number(job.rows[0].id), status: "queued" });
  }

  const readMatch = url.pathname.match(/^\/v1\/token\/jobs\/(\d+)$/);
  if (req.method === "GET" && readMatch) {
    const job = await pool.query(
      `SELECT id, device_id, command, kind, status, exit_code, output, created_at, finished_at
       FROM jobs WHERE id = $1 AND org_id = $2 AND api_token_id = $3`,
      [readMatch[1], token.org_id, token.id],
    );
    if (!job.rows[0]) return reply(h, res, 404, { error: "Job not found." });
    return reply(h, res, 200, jobView(job.rows[0]));
  }

  return reply(h, res, 404, { error: "Not found." });
}
