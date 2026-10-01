import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import { pool } from "./db.js";
import { verifyPassword } from "./passwords.js";

const MODULES = ["core", "remote_desktop", "ticketing", "monitoring", "patch", "reporting"];
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const port = Number(process.env.PORT || 4000);

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 2,
});

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function actorFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const raw = await redis.get(`session:${token}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  const result = await pool.query(
    "SELECT id, email, name, org_id, is_platform_admin FROM users WHERE id = $1",
    [session.userId],
  );
  return result.rows[0] || null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function meshControl(args) {
  const meshUrl = String(process.env.MESH_URL || "").replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  if (!meshUrl || !process.env.MESH_USER || !process.env.MESH_PASSWORD) {
    throw Object.assign(new Error("Remote service is not configured."), { status: 500 });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/local/bin/node",
      [
        "/opt/meshcentral/node_modules/meshcentral/meshctrl.js",
        ...args,
        "--url",
        meshUrl,
        "--loginuser",
        process.env.MESH_USER,
        "--loginpass",
        process.env.MESH_PASSWORD,
      ],
      { cwd: "/opt/meshcentral" },
    );
    const out = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

function remoteView(osName) {
  return /windows/i.test(osName || "") ? "11" : "12";
}

async function meshDesktopUrl(nodeId, tokenName, osName) {
  const text = await meshControl(["LoginTokens", "--add", tokenName, "--expire", "10"]);
  let user = "";
  let pass = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("Username: ")) user = line.slice("Username: ".length).trim();
    if (line.startsWith("Password: ")) pass = line.slice("Password: ".length).trim();
  }
  if (!user || !pass) {
    throw Object.assign(new Error("Remote service did not answer."), { status: 502 });
  }
  const page = new URL(String(process.env.MESH_URL || "").replace(/^wss:/, "https:"));
  page.search = "";
  page.searchParams.set("user", user);
  page.searchParams.set("pass", pass);
  page.searchParams.set("viewmode", remoteView(osName));
  // Left admin menu, panel title, and back buttons. Mesh's own page switch puts the device tabs back,
  // so the technician stays on this device without My Devices, My Account, or My Server.
  page.searchParams.set("hide", "56");
  const marker = "node//";
  const suffix = nodeId.includes(marker) ? nodeId.slice(nodeId.indexOf(marker) + marker.length) : nodeId;
  // Mesh drops any query value that contains "%". Node ids use "@", which URL.toString() would encode.
  return `${page.origin}${page.pathname}?${page.searchParams.toString()}&gotonode=${suffix}`;
}

async function deviceFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Device ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const result = await pool.query(
    "SELECT id, org_id, hostname FROM devices WHERE agent_token_hash = $1",
    [sha256(token)],
  );
  return result.rows[0] || null;
}

function requireActor(actor, res) {
  if (actor) return true;
  send(res, 401, { error: "Login required." });
  return false;
}

function licenseView(row) {
  return {
    plan: row.plan,
    seats: row.seats,
    deviceCap: row.device_cap,
    expiresAt: row.expires_at,
    modules: row.modules,
  };
}

function licenseExpired(row) {
  return Boolean(row?.expires_at && new Date(row.expires_at).getTime() < Date.now());
}

function remoteAccess(row) {
  if (licenseExpired(row)) return { canRemote: false, remoteReason: "expired" };
  if (row?.modules?.remote_desktop !== true) return { canRemote: false, remoteReason: "module" };
  return { canRemote: true, remoteReason: null };
}

async function writeAudit(orgId, actorId, action, targetType, targetId, detail) {
  await pool.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, actorId, action, targetType, targetId, JSON.stringify(detail || {})],
  );
}

async function createOrg(client, input, actor) {
  const org = await client.query(
    "INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at",
    [input.name, input.slug],
  );
  const license = await client.query(
    `INSERT INTO licenses (org_id, plan, seats, device_cap, expires_at, modules)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING plan, seats, device_cap, expires_at, modules`,
    [org.rows[0].id, input.plan, input.seats, input.deviceCap, input.expiresAt, JSON.stringify(input.modules)],
  );
  await client.query(
    "INSERT INTO roles (org_id, name) VALUES ($1, 'owner'), ($1, 'admin'), ($1, 'tech')",
    [org.rows[0].id],
  );
  const audit = await client.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, 'org.create', 'org', $3, $4::jsonb)
     RETURNING id, actor_user_id, action, target_type, target_id, created_at`,
    [
      org.rows[0].id,
      actor.id,
      String(org.rows[0].id),
      JSON.stringify({
        name: input.name,
        slug: input.slug,
        deviceCap: input.deviceCap,
        modules: input.modules,
      }),
    ],
  );
  return { org: org.rows[0], license: licenseView(license.rows[0]), audit: audit.rows[0] };
}

function parseOrgInput(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const plan = typeof body.plan === "string" ? body.plan.trim() : "";
  const seats = body.seats;
  const deviceCap = body.deviceCap;
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !plan) {
    return { error: "name, slug, and plan are required. slug uses lowercase letters, numbers, and hyphens." };
  }
  if (!Number.isInteger(seats) || seats < 1 || !Number.isInteger(deviceCap) || deviceCap < 0) {
    return { error: "seats must be a positive integer and deviceCap must be zero or greater." };
  }
  if (body.modules == null || typeof body.modules !== "object" || Array.isArray(body.modules)) {
    return { error: "modules must be an object of feature flags." };
  }
  const modules = {};
  for (const key of MODULES) {
    if (typeof body.modules[key] !== "boolean") {
      return { error: `modules.${key} must be true or false.` };
    }
    modules[key] = body.modules[key];
  }
  let expiresAt = null;
  if (body.expiresAt != null) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) return { error: "expiresAt must be an ISO date." };
    expiresAt = parsed.toISOString();
  }
  return { value: { name, slug, plan, seats, deviceCap, expiresAt, modules } };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      await redis.ping();
      return send(res, 200, { ok: true, postgres: true, redis: true });
    }

    if (req.method === "POST" && url.pathname === "/v1/login") {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const found = await pool.query(
        "SELECT id, email, name, password_hash, is_platform_admin FROM users WHERE email = $1",
        [email],
      );
      const user = found.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return send(res, 401, { error: "Invalid email or password." });
      }
      const token = randomBytes(32).toString("base64url");
      await redis.set(`session:${token}`, JSON.stringify({ userId: user.id }), "EX", SESSION_TTL_SECONDS);
      return send(res, 200, {
        token,
        user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.is_platform_admin },
      });
    }

    const actor = await actorFrom(req);

    if (req.method === "POST" && url.pathname === "/v1/orgs") {
      if (!requireActor(actor, res)) return;
      if (!actor.is_platform_admin) return send(res, 403, { error: "Only a platform admin can create an org." });
      const parsed = parseOrgInput(await readJson(req));
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const created = await createOrg(client, parsed.value, actor);
        await client.query("COMMIT");
        return send(res, 201, created);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") return send(res, 409, { error: "An org with that slug already exists." });
        throw error;
      } finally {
        client.release();
      }
    }

    const orgMatch = url.pathname.match(/^\/v1\/orgs\/(\d+)$/);
    if (req.method === "GET" && orgMatch) {
      if (!requireActor(actor, res)) return;
      const result = await pool.query(
        `SELECT o.id, o.name, o.slug, o.created_at, l.plan, l.seats, l.device_cap, l.expires_at, l.modules
         FROM orgs o
         JOIN licenses l ON l.org_id = o.id
         WHERE o.id = $1`,
        [orgMatch[1]],
      );
      if (!result.rows[0]) return send(res, 404, { error: "Org not found." });
      const row = result.rows[0];
      return send(res, 200, {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.created_at,
        license: licenseView(row),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/orgs") {
      if (!requireActor(actor, res)) return;
      const slug = url.searchParams.get("slug");
      const result = await pool.query(
        `SELECT o.id, o.name, o.slug, l.device_cap, l.modules
         FROM orgs o
         JOIN licenses l ON l.org_id = o.id
         WHERE ($1::text IS NULL OR o.slug = $1)
         ORDER BY o.id`,
        [slug],
      );
      return send(res, 200, {
        orgs: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          deviceCap: row.device_cap,
          modules: row.modules,
        })),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/enroll-tokens") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO enroll_tokens (org_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [actor.org_id, sha256(token), actor.id, expiresAt.toISOString()],
      );
      return send(res, 201, { token, expiresAt: expiresAt.toISOString() });
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/enroll") {
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
      const osName = typeof body.osName === "string" ? body.osName.trim() : "";
      if (!token || !hostname || hostname.length > 200 || osName.length > 200) {
        return send(res, 400, { error: "Hostname and enroll token are required." });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tokenRow = await client.query(
          `SELECT id, org_id, created_by, expires_at, used_at
           FROM enroll_tokens
           WHERE token_hash = $1
           FOR UPDATE`,
          [sha256(token)],
        );
        const invite = tokenRow.rows[0];
        if (!invite || invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) {
          await client.query("ROLLBACK");
          return send(res, 401, { error: "Enroll token is not valid." });
        }
        const license = await client.query(
          "SELECT device_cap, expires_at, modules FROM licenses WHERE org_id = $1 FOR UPDATE",
          [invite.org_id],
        );
        const current = license.rows[0];
        const denyEnroll = async (reason, message) => {
          await client.query("ROLLBACK");
          await writeAudit(invite.org_id, invite.created_by, "enroll.deny", "org", String(invite.org_id), { reason });
          return send(res, 403, { error: message });
        };
        if (!current || current.modules?.core !== true) {
          return await denyEnroll("core", "This org cannot enroll devices.");
        }
        if (licenseExpired(current)) {
          return await denyEnroll("expired", "This license has expired.");
        }
        const count = await client.query(
          "SELECT count(*)::int AS total FROM devices WHERE org_id = $1",
          [invite.org_id],
        );
        if (count.rows[0].total >= current.device_cap) {
          return await denyEnroll("device_cap", "Device cap reached.");
        }
        const deviceToken = randomBytes(32).toString("base64url");
        const device = await client.query(
          `INSERT INTO devices (org_id, hostname, os_name, last_seen_at, agent_token_hash)
           VALUES ($1, $2, $3, now(), $4)
           RETURNING id`,
          [invite.org_id, hostname, osName || null, sha256(deviceToken)],
        );
        await client.query("UPDATE enroll_tokens SET used_at = now() WHERE id = $1", [invite.id]);
        await client.query(
          `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
           VALUES ($1, $2, 'device.enroll', 'device', $3, $4::jsonb)`,
          [
            invite.org_id,
            invite.created_by,
            String(device.rows[0].id),
            JSON.stringify({ hostname, osName }),
          ],
        );
        await client.query("COMMIT");
        return send(res, 201, {
          deviceId: Number(device.rows[0].id),
          deviceToken,
          deviceCount: count.rows[0].total + 1,
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The denial path already rolled this transaction back.
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/heartbeat") {
      const device = await deviceFrom(req);
      if (!device) return send(res, 401, { error: "Device login required." });
      const body = await readJson(req);
      const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
      const osName = typeof body.osName === "string" ? body.osName.trim() : "";
      await pool.query(
        `UPDATE devices
         SET last_seen_at = now(),
             hostname = COALESCE(NULLIF($2, ''), hostname),
             os_name = COALESCE(NULLIF($3, ''), os_name)
         WHERE id = $1`,
        [device.id, hostname.slice(0, 200), osName.slice(0, 200)],
      );
      const jobs = await pool.query(
        `UPDATE jobs
         SET status = 'running'
         WHERE device_id = $1 AND status = 'queued'
         RETURNING id, command`,
        [device.id],
      );
      return send(res, 200, {
        jobs: jobs.rows.map((row) => ({ id: Number(row.id), command: row.command })),
      });
    }

    const jobResultMatch = url.pathname.match(/^\/v1\/agent\/jobs\/(\d+)\/result$/);
    if (req.method === "POST" && jobResultMatch) {
      const device = await deviceFrom(req);
      if (!device) return send(res, 401, { error: "Device login required." });
      const body = await readJson(req);
      const exitCode = Number.isInteger(body.exitCode) ? body.exitCode : 1;
      const output = typeof body.output === "string" ? body.output.slice(0, 8000) : "";
      const updated = await pool.query(
        `UPDATE jobs
         SET status = 'finished', exit_code = $1, output = $2, finished_at = now()
         WHERE id = $3 AND device_id = $4 AND status = 'running'
         RETURNING id`,
        [exitCode, output, jobResultMatch[1], device.id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Job not found." });
      return send(res, 200, { id: Number(updated.rows[0].id), status: "finished" });
    }

    if (req.method === "GET" && url.pathname === "/v1/devices") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const org = await pool.query("SELECT id, name FROM orgs WHERE id = $1", [actor.org_id]);
      const license = await pool.query(
        "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
        [actor.org_id],
      );
      const access = remoteAccess(license.rows[0]);
      const result = await pool.query(
        `SELECT id, hostname, os_name, last_seen_at
         FROM devices
         WHERE org_id = $1
         ORDER BY hostname`,
        [actor.org_id],
      );
      const jobs = await pool.query(
        `SELECT DISTINCT ON (device_id)
           device_id, id, command, status, exit_code, output, finished_at
         FROM jobs
         WHERE org_id = $1
         ORDER BY device_id, id DESC`,
        [actor.org_id],
      );
      const latest = new Map(jobs.rows.map((row) => [String(row.device_id), row]));
      return send(res, 200, {
        org: org.rows[0] || null,
        canRemote: access.canRemote,
        remoteReason: access.remoteReason,
        deviceCount: result.rows.length,
        devices: result.rows.map((row) => {
          const job = latest.get(String(row.id));
          return {
            id: row.id,
            hostname: row.hostname,
            osName: row.os_name,
            lastSeenAt: row.last_seen_at,
            latestJob: job
              ? {
                  id: job.id,
                  command: job.command,
                  status: job.status,
                  exitCode: job.exit_code,
                  output: job.output,
                  finishedAt: job.finished_at,
                }
              : null,
          };
        }),
      });
    }

    const deviceJobMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/jobs$/);
    if (req.method === "POST" && deviceJobMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const body = await readJson(req);
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!command || command.length > 400 || command.includes("\n") || command.includes("\0")) {
        return send(res, 400, { error: "Enter one command line." });
      }
      const device = await pool.query(
        "SELECT id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceJobMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const job = await pool.query(
        `INSERT INTO jobs (org_id, device_id, command, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [actor.org_id, device.rows[0].id, command, actor.id],
      );
      await pool.query(
        `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
         VALUES ($1, $2, 'job.create', 'job', $3, $4::jsonb)`,
        [actor.org_id, actor.id, String(job.rows[0].id), JSON.stringify({ deviceId: device.rows[0].id })],
      );
      return send(res, 201, { id: Number(job.rows[0].id), status: "queued" });
    }

    const deviceRemoteMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/remote$/);
    if (req.method === "POST" && deviceRemoteMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = await pool.query(
        "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
        [actor.org_id],
      );
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        await writeAudit(actor.org_id, actor.id, "remote.deny", "device", deviceRemoteMatch[1], {
          reason: access.remoteReason,
        });
        const message = access.remoteReason === "expired"
          ? "This license has expired."
          : "Remote desktop is not included on this license.";
        return send(res, 403, { error: message });
      }
      const device = await pool.query(
        "SELECT id, mesh_node_id, os_name FROM devices WHERE id = $1 AND org_id = $2",
        [deviceRemoteMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      if (!device.rows[0].mesh_node_id) {
        return send(res, 409, { error: "This device has no remote agent yet." });
      }
      const url = await meshDesktopUrl(
        device.rows[0].mesh_node_id,
        `df-${device.rows[0].id}-${Date.now()}`,
        device.rows[0].os_name,
      );
      await pool.query(
        `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
         VALUES ($1, $2, 'remote.launch', 'device', $3, '{}'::jsonb)`,
        [actor.org_id, actor.id, String(device.rows[0].id)],
      );
      return send(res, 200, { url });
    }

    if (req.method === "GET" && url.pathname === "/v1/audit") {
      if (!requireActor(actor, res)) return;
      const action = url.searchParams.get("action");
      const result = await pool.query(
        `SELECT e.id, e.org_id, e.actor_user_id, u.email AS actor_email, e.action, e.target_type, e.target_id, e.detail, e.created_at
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
         WHERE ($1::text IS NULL OR e.action = $1)
         ORDER BY e.id DESC
         LIMIT 50`,
        [action],
      );
      return send(res, 200, { events: result.rows });
    }

    send(res, 404, { error: "Not found." });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error.message);
    send(res, status, { error: status >= 500 ? "Internal error." : error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`df-api listening on 127.0.0.1:${port}`);
});
