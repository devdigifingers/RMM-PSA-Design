import { randomBytes } from "node:crypto";
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
    "SELECT id, email, name, is_platform_admin FROM users WHERE id = $1",
    [session.userId],
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
    if (status >= 500) console.error(error);
    send(res, status, { error: status >= 500 ? "Internal error." : error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`df-api listening on 127.0.0.1:${port}`);
});
