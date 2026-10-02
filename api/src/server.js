import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import { pool } from "./db.js";
import { sendMail } from "./mail.js";
import { verifyPassword } from "./passwords.js";

const MODULES = ["core", "remote_desktop", "ticketing", "monitoring", "patch", "reporting"];
const TICKET_STATUSES = new Set(["open", "pending", "resolved"]);
const TICKET_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const EXPORT_HISTORY_LIMIT = 30;
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
  const actor = result.rows[0];
  if (!actor) return null;
  const roles = await pool.query(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [actor.id],
  );
  actor.roles = roles.rows.map((row) => row.name);
  return actor;
}

function canOperate(actor) {
  const roles = actor?.roles || [];
  return roles.includes("owner") || roles.includes("admin");
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

function ticketingReason(row) {
  if (licenseExpired(row)) return "expired";
  if (row?.modules?.ticketing !== true) return "module";
  return null;
}

function metricsFrom(body) {
  const raw = body?.metrics;
  if (!raw || typeof raw !== "object") return null;
  const cpuPercent = boundedCount(raw.cpuPercent, 100);
  const memoryPercent = boundedCount(raw.memoryPercent, 100);
  const diskPercent = boundedCount(raw.diskPercent, 100);
  const memoryUsedBytes = boundedCount(raw.memoryUsedBytes, Number.MAX_SAFE_INTEGER);
  const memoryTotalBytes = boundedCount(raw.memoryTotalBytes, Number.MAX_SAFE_INTEGER);
  const diskUsedBytes = boundedCount(raw.diskUsedBytes, Number.MAX_SAFE_INTEGER);
  const diskTotalBytes = boundedCount(raw.diskTotalBytes, Number.MAX_SAFE_INTEGER);
  const uptimeSeconds = boundedCount(raw.uptimeSeconds, 60 * 60 * 24 * 365 * 30);
  const values = [cpuPercent, memoryPercent, diskPercent, memoryUsedBytes, memoryTotalBytes, diskUsedBytes, diskTotalBytes, uptimeSeconds];
  if (values.some((value) => value == null) || memoryTotalBytes === 0 || diskTotalBytes === 0) return null;
  return { cpuPercent, memoryPercent, memoryUsedBytes, memoryTotalBytes, diskPercent, diskUsedBytes, diskTotalBytes, uptimeSeconds };
}

function cleanAssetText(value, max) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\u0000", "").trim().slice(0, max);
}

function assetFrom(body) {
  const raw = body?.asset;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const make = cleanAssetText(raw.make, 200);
  const model = cleanAssetText(raw.model, 200);
  const serial = cleanAssetText(raw.serial, 200);
  if (!Array.isArray(raw.software)) return { make, model, serial, software: null };
  const software = [];
  for (const item of raw.software) {
    if (!item || typeof item !== "object") continue;
    const name = cleanAssetText(item.name, 200);
    if (!name) continue;
    software.push({ name, version: cleanAssetText(item.version, 120) });
    if (software.length >= 4000) break;
  }
  return { make, model, serial, software };
}

function installedVersion(software, name) {
  if (!Array.isArray(software)) return null;
  for (const item of software) {
    if (item && item.name === name) return typeof item.version === "string" ? item.version : "";
  }
  return null;
}

function updatesFrom(body) {
  if (!Object.hasOwn(body, "updates") || !Array.isArray(body.updates)) return null;
  const items = [];
  for (const raw of body.updates) {
    if (!raw || typeof raw !== "object") continue;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 200) : "";
    if (!name) continue;
    const currentVersion = typeof raw.currentVersion === "string" ? raw.currentVersion.trim().slice(0, 120) : "";
    const availableVersion = typeof raw.availableVersion === "string" ? raw.availableVersion.trim().slice(0, 120) : "";
    items.push({ name, currentVersion, availableVersion });
    if (items.length >= 200) break;
  }
  return items;
}

function boundedCount(value, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) return null;
  return number;
}

function ticketingAllowed(row) {
  return ticketingReason(row) == null && Boolean(row);
}

function patchReason(row) {
  if (licenseExpired(row)) return "expired";
  if (row?.modules?.patch !== true) return "module";
  return null;
}

function patchAllowed(row) {
  return patchReason(row) == null && Boolean(row);
}

async function requirePatch(actor, res, options = {}) {
  if (!requireActor(actor, res)) return false;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return false;
  }
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [actor.org_id],
  );
  const reason = patchReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "patch.deny", "org", String(actor.org_id), { reason });
    }
    send(res, 403, {
      error: reason === "expired" ? "This license has expired." : "Patch management is not included on this license.",
    });
    return false;
  }
  return true;
}

function reportingReason(row) {
  if (licenseExpired(row)) return "expired";
  if (row?.modules?.reporting !== true) return "module";
  return null;
}

function reportingAllowed(row) {
  return reportingReason(row) == null && Boolean(row);
}

async function requireReporting(actor, res, options = {}) {
  if (!requireActor(actor, res)) return false;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return false;
  }
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [actor.org_id],
  );
  const reason = reportingReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "reporting.deny", "org", String(actor.org_id), { reason });
    }
    send(res, 403, {
      error: reason === "expired" ? "This license has expired." : "Reporting is not included on this license.",
    });
    return false;
  }
  return true;
}

function patchState(updates, software, succeededNames) {
  const patched = [...succeededNames];
  const installed = new Set(patched);
  const missing = [];
  const inventory = Array.isArray(updates) ? updates : [];
  for (const item of inventory) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name || installed.has(name)) continue;
    const available = typeof item?.availableVersion === "string" ? item.availableVersion.trim() : "";
    const version = installedVersion(software, name);
    if (version != null && available && version === available) {
      patched.push(name);
      installed.add(name);
      continue;
    }
    missing.push(name);
  }
  return { patched, missing };
}

function complianceFrom(devices, succeeded) {
  const patchedByDevice = new Map();
  for (const row of succeeded) {
    const key = String(row.device_id);
    const names = patchedByDevice.get(key) || [];
    names.push(row.package_name);
    patchedByDevice.set(key, names);
  }
  const groups = new Map();
  for (const device of devices) {
    const customerId = device.customer_id == null ? 0 : Number(device.customer_id);
    if (!groups.has(customerId)) {
      groups.set(customerId, {
        id: customerId,
        name: device.customer_name || "No customer",
        devices: [],
      });
    }
    const state = patchState(device.updates, device.software, patchedByDevice.get(String(device.id)) || []);
    groups.get(customerId).devices.push({
      hostname: device.hostname,
      patched: state.patched,
      missing: state.missing,
    });
  }
  return [...groups.values()];
}

function monitoringReason(row) {
  if (licenseExpired(row)) return "expired";
  if (row?.modules?.monitoring !== true) return "module";
  return null;
}

function monitoringAllowed(row) {
  return monitoringReason(row) == null && Boolean(row);
}

const ALERT_METRICS = { cpu: "cpuPercent", memory: "memoryPercent", disk: "diskPercent" };

const ALERT_LABELS = { cpu: "CPU", memory: "Memory", disk: "Disk" };

async function requireMonitoring(actor, res, options = {}) {
  if (!requireActor(actor, res)) return false;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return false;
  }
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [actor.org_id],
  );
  const reason = monitoringReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "monitoring.deny", "org", String(actor.org_id), { reason });
    }
    const message = reason === "expired"
      ? "This license has expired."
      : "Monitoring is not included on this license.";
    send(res, 403, { error: message });
    return false;
  }
  return true;
}

async function openWorkTicket(orgId, customerId, deviceId, subject, detail) {
  const created = await pool.query(
    `INSERT INTO tickets (org_id, customer_id, device_id, subject, status, priority)
     SELECT $1, $2, $3, $4, 'open', 'normal'
     WHERE NOT EXISTS (
       SELECT 1 FROM tickets
       WHERE org_id = $1 AND device_id = $3 AND subject = $4 AND status <> 'resolved'
     )
     RETURNING id`,
    [orgId, customerId, deviceId, subject],
  );
  if (!created.rows[0]) return null;
  await writeAudit(orgId, null, "ticket.create", "ticket", String(created.rows[0].id), {
    customerId: Number(customerId),
    deviceId: Number(deviceId),
    status: "open",
    priority: "normal",
    ...detail,
  });
  await notifyNewTicket(orgId, created.rows[0].id, subject);
  return Number(created.rows[0].id);
}

async function notifyNewTicket(orgId, ticketId, subject) {
  const to = String(process.env.MAIL_TO || "").trim();
  if (!to) return;
  try {
    const sent = await sendMail({
      to,
      subject,
      text: `A new ticket is open: ${subject}\nhttps://rmm.digitalfingers.co.za/tickets/${ticketId}\n`,
    });
    if (!sent) return;
    await writeAudit(orgId, null, "ticket.mail", "ticket", String(ticketId), {});
  } catch {
    console.error("ticket mail failed");
  }
}

function missingSubject(name, hostname) {
  return `Missing ${name} on ${hostname}`.slice(0, 200);
}

function missingNote(name) {
  return `Missing ${name}.`;
}

async function attachMissingTickets(deviceId) {
  const device = await pool.query(
    `SELECT d.id, d.org_id, d.hostname, d.updates, d.software, s.customer_id
     FROM devices d
     LEFT JOIN sites s ON s.id = d.site_id
     WHERE d.id = $1`,
    [deviceId],
  );
  const row = device.rows[0];
  if (!row || row.customer_id == null) return;
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [row.org_id],
  );
  if (!ticketingAllowed(license.rows[0]) || !patchAllowed(license.rows[0])) return;
  const succeeded = await pool.query(
    "SELECT package_name FROM patch_deploys WHERE device_id = $1 AND status = 'succeeded'",
    [deviceId],
  );
  const { missing } = patchState(
    row.updates,
    row.software,
    succeeded.rows.map((item) => item.package_name),
  );
  if (missing.length === 0) return;
  const open = await pool.query(
    `SELECT id, subject FROM tickets
     WHERE org_id = $1 AND customer_id = $2 AND device_id = $3
       AND status <> 'resolved' AND subject LIKE 'Missing %'
     ORDER BY id ASC`,
    [row.org_id, row.customer_id, row.id],
  );
  const notes = open.rows.length
    ? await pool.query(
      "SELECT body FROM ticket_comments WHERE ticket_id = ANY($1::bigint[])",
      [open.rows.map((item) => Number(item.id))],
    )
    : { rows: [] };
  const covered = new Set([
    ...open.rows.map((item) => item.subject),
    ...notes.rows.map((item) => item.body),
  ]);
  const fresh = missing.filter((name) => {
    return !covered.has(missingSubject(name, row.hostname)) && !covered.has(missingNote(name));
  });
  if (fresh.length === 0) return;
  let ticketId = open.rows[0] ? Number(open.rows[0].id) : null;
  if (!ticketId) {
    ticketId = await openWorkTicket(
      row.org_id,
      row.customer_id,
      row.id,
      `Missing updates on ${row.hostname}`.slice(0, 200),
      { reason: "missing" },
    );
  }
  if (!ticketId) return;
  for (const name of fresh) {
    await pool.query(
      `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body)
       VALUES ($1, $2, NULL, $3)`,
      [row.org_id, ticketId, missingNote(name)],
    );
    await writeAudit(row.org_id, null, "ticket.comment", "ticket", String(ticketId), {
      reason: "missing",
      packageName: name,
    });
  }
}

async function clearOfflineTicket(deviceId) {
  const device = await pool.query(
    "SELECT id, org_id, hostname FROM devices WHERE id = $1",
    [deviceId],
  );
  const row = device.rows[0];
  if (!row) return;
  const subject = `Offline on ${row.hostname}`.slice(0, 200);
  const updated = await pool.query(
    `UPDATE tickets
     SET status = 'resolved', updated_at = now()
     WHERE org_id = $1 AND device_id = $2 AND subject = $3 AND status <> 'resolved'
     RETURNING id`,
    [row.org_id, row.id, subject],
  );
  for (const ticket of updated.rows) {
    await writeAudit(row.org_id, null, "ticket.update", "ticket", String(ticket.id), {
      status: "resolved",
      reason: "online",
    });
  }
}

let offlineSweepRunning = false;

async function sweepOffline() {
  if (offlineSweepRunning) return;
  offlineSweepRunning = true;
  try {
    const devices = await pool.query(
      `SELECT d.id, d.org_id, d.hostname, s.customer_id
       FROM devices d
       JOIN sites s ON s.id = d.site_id
       JOIN licenses l ON l.org_id = d.org_id
       WHERE d.last_seen_at IS NOT NULL
         AND d.last_seen_at < now() - interval '60 seconds'
         AND l.modules->>'ticketing' = 'true'
         AND (l.expires_at IS NULL OR l.expires_at > now())`,
    );
    for (const row of devices.rows) {
      const subject = `Offline on ${row.hostname}`.slice(0, 200);
      await openWorkTicket(row.org_id, row.customer_id, row.id, subject, { reason: "offline" });
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    offlineSweepRunning = false;
  }
}

async function breachBaseline() {
  const existing = await pool.query(
    "SELECT target_id FROM audit_events WHERE action = 'breach.baseline' ORDER BY id ASC LIMIT 1",
  );
  if (existing.rows[0]) return Number(existing.rows[0].target_id);
  const max = await pool.query("SELECT COALESCE(MAX(id), 0)::text AS id FROM tickets");
  const inserted = await pool.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     SELECT NULL, NULL, 'breach.baseline', 'ticket', $1, '{}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action = 'breach.baseline')
     RETURNING target_id`,
    [max.rows[0].id],
  );
  if (inserted.rows[0]) return Number(inserted.rows[0].target_id);
  const again = await pool.query(
    "SELECT target_id FROM audit_events WHERE action = 'breach.baseline' ORDER BY id ASC LIMIT 1",
  );
  return Number(again.rows[0].target_id);
}

async function notifyBreach(orgId, ticketId, subject) {
  const to = String(process.env.MAIL_TO || "").trim();
  if (!to) return;
  try {
    const sent = await sendMail({
      to,
      subject: `SLA breach: ${subject}`,
      text: `A ticket is past its SLA: ${subject}\nhttps://rmm.digitalfingers.co.za/tickets/${ticketId}\n`,
    });
    if (!sent) return;
    await writeAudit(orgId, null, "ticket.breach", "ticket", String(ticketId), {});
  } catch {
    console.error("ticket mail failed");
  }
}

let breachSweepRunning = false;

async function sweepBreaches() {
  if (breachSweepRunning) return;
  breachSweepRunning = true;
  try {
    const afterId = await breachBaseline();
    const tickets = await pool.query(
      `SELECT t.id, t.org_id, t.subject, t.status, t.created_at, t.updated_at,
              ${TICKET_CLOCK_SQL}
       FROM tickets t
       JOIN licenses l ON l.org_id = t.org_id
       WHERE t.id > $1
         AND t.status <> 'resolved'
         AND l.modules->>'ticketing' = 'true'
         AND (l.expires_at IS NULL OR l.expires_at > now())
         AND NOT EXISTS (
           SELECT 1 FROM audit_events e
           WHERE e.action = 'ticket.breach'
             AND e.target_type = 'ticket'
             AND e.target_id = t.id::text
         )`,
      [afterId],
    );
    const now = new Date();
    for (const ticket of tickets.rows) {
      const sla = await orgSla(ticket.org_id);
      const clock = slaClock(ticket, sla, now);
      if (!clock) continue;
      const responseLate = clock.responseElapsed > clock.responseMinutes;
      const resolveLate = clock.resolveElapsed > clock.resolveMinutes;
      if (!responseLate && !resolveLate) continue;
      await notifyBreach(ticket.org_id, ticket.id, ticket.subject);
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    breachSweepRunning = false;
  }
}

async function evaluateAlerts(deviceId) {
  const rules = await pool.query(
    `SELECT r.id, r.org_id, r.device_id, r.metric, r.threshold, d.metrics
     FROM alert_rules r
     JOIN devices d ON d.id = r.device_id
     WHERE r.device_id = $1`,
    [deviceId],
  );
  for (const rule of rules.rows) {
    const value = rule.metrics?.[ALERT_METRICS[rule.metric]];
    if (!Number.isInteger(value) || value < rule.threshold) continue;
    const existing = await pool.query("SELECT id FROM alerts WHERE rule_id = $1", [rule.id]);
    if (existing.rows[0]) continue;
    const created = await pool.query(
      `INSERT INTO alerts (org_id, rule_id, device_id, metric, value, threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [rule.org_id, rule.id, rule.device_id, rule.metric, value, rule.threshold],
    );
    await writeAudit(rule.org_id, null, "alert.fire", "alert", String(created.rows[0].id), {
      ruleId: Number(rule.id),
      deviceId: Number(rule.device_id),
      metric: rule.metric,
      value,
      threshold: rule.threshold,
    });
  }
}

async function requireTicketing(actor, res, options = {}) {
  if (!requireActor(actor, res)) return false;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return false;
  }
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [actor.org_id],
  );
  const reason = ticketingReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "ticket.deny", "org", String(actor.org_id), { reason });
    }
    const message = reason === "expired"
      ? "This license has expired."
      : "Ticketing is not included on this license.";
    send(res, 403, { error: message });
    return false;
  }
  return true;
}

function ticketView(row) {
  return {
    id: Number(row.id),
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    customer: { id: Number(row.customer_id), name: row.customer_name },
    device: { id: Number(row.device_id), hostname: row.device_hostname },
    assignee: row.assignee_user_id
      ? { id: Number(row.assignee_user_id), name: row.assignee_name, email: row.assignee_email }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function linkDeviceToCustomer(client, orgId, customerId, deviceId) {
  const customer = await client.query(
    "SELECT id FROM customers WHERE id = $1 AND org_id = $2",
    [customerId, orgId],
  );
  if (!customer.rows[0]) return { status: 400, error: "Choose a customer in this organisation." };
  const site = await client.query(
    "SELECT id FROM sites WHERE customer_id = $1 AND org_id = $2 ORDER BY id LIMIT 1",
    [customerId, orgId],
  );
  if (!site.rows[0]) return { status: 400, error: "That customer has no site." };
  const device = await client.query(
    `SELECT d.id, d.site_id, s.customer_id
     FROM devices d
     LEFT JOIN sites s ON s.id = d.site_id
     WHERE d.id = $1 AND d.org_id = $2
     FOR UPDATE OF d`,
    [deviceId, orgId],
  );
  if (!device.rows[0]) return { status: 400, error: "Choose a device in this organisation." };
  const currentCustomer = device.rows[0].customer_id;
  if (currentCustomer != null && Number(currentCustomer) !== customerId) {
    return { status: 409, error: "That device already belongs to another customer." };
  }
  if (device.rows[0].site_id == null) {
    await client.query("UPDATE devices SET site_id = $1 WHERE id = $2", [site.rows[0].id, deviceId]);
    return { linked: true, siteId: Number(site.rows[0].id) };
  }
  return { linked: false, siteId: Number(site.rows[0].id) };
}

function slaMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200) return null;
  return minutes;
}

async function orgSla(orgId) {
  const row = await pool.query(
    "SELECT response_minutes, resolve_minutes FROM org_slas WHERE org_id = $1",
    [orgId],
  );
  if (!row.rows[0]) return null;
  return {
    responseMinutes: row.rows[0].response_minutes,
    resolveMinutes: row.rows[0].resolve_minutes,
  };
}

function elapsedMinutes(from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 60000);
}

function slaClock(row, targets, now) {
  if (!targets || !row?.created_at) return null;
  const responseStop = row.first_response_at ? new Date(row.first_response_at) : now;
  const resolveStop = row.status === "resolved" ? new Date(row.resolved_at || row.updated_at) : now;
  return {
    responseMinutes: targets.responseMinutes,
    resolveMinutes: targets.resolveMinutes,
    responseElapsed: elapsedMinutes(row.created_at, responseStop),
    resolveElapsed: elapsedMinutes(row.created_at, resolveStop),
  };
}

const TICKET_CLOCK_SQL = `
  (
    SELECT MIN(tc.created_at)
    FROM ticket_comments tc
    JOIN users u ON u.id = tc.author_user_id AND u.org_id = t.org_id
    WHERE tc.ticket_id = t.id
  ) AS first_response_at,
  (
    SELECT MIN(e.created_at)
    FROM audit_events e
    WHERE e.action = 'ticket.update'
      AND e.target_type = 'ticket'
      AND e.target_id = t.id::text
      AND e.detail->>'status' = 'resolved'
  ) AS resolved_at`;

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

async function dashboardSnapshot(orgId) {
  const license = await pool.query(
    "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
    [orgId],
  );
  const row = license.rows[0];
  const [org, devices, tickets] = await Promise.all([
    pool.query("SELECT id, name FROM orgs WHERE id = $1", [orgId]),
    pool.query(
      `SELECT d.hostname, d.last_seen_at, d.metrics, c.name AS customer_name
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE d.org_id = $1
       ORDER BY d.hostname`,
      [orgId],
    ),
    pool.query(
      `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, ${TICKET_CLOCK_SQL}
       FROM tickets t
       WHERE t.org_id = $1 AND t.status = 'open'
       ORDER BY t.id`,
      [orgId],
    ),
  ]);
  const monitor = monitoringAllowed(row);
  const patch = patchAllowed(row);
  let compliance = [];
  if (patch) {
    const [fleet, succeeded] = await Promise.all([
      pool.query(
        `SELECT d.id, d.hostname, d.updates, d.software, c.id AS customer_id, c.name AS customer_name
         FROM devices d
         LEFT JOIN sites s ON s.id = d.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE d.org_id = $1
         ORDER BY c.name NULLS LAST, d.hostname`,
        [orgId],
      ),
      pool.query(
        `SELECT device_id, package_name
         FROM patch_deploys
         WHERE org_id = $1 AND status = 'succeeded'
         ORDER BY id`,
        [orgId],
      ),
    ]);
    compliance = complianceFrom(fleet.rows, succeeded.rows);
  }
  const freshAfter = Date.now() - 3 * 60 * 1000;
  const now = new Date();
  const sla = await orgSla(orgId);
  return {
    org: org.rows[0] || null,
    canTicket: ticketingAllowed(row),
    canMonitor: monitor,
    canPatch: patch,
    canReport: reportingAllowed(row),
    deviceCount: devices.rows.length,
    devices: devices.rows.map((device) => ({
      hostname: device.hostname,
      customerName: device.customer_name || null,
      reporting: device.last_seen_at != null && new Date(device.last_seen_at).getTime() >= freshAfter,
      cpuPercent: monitor && device.metrics ? device.metrics.cpuPercent : null,
      memoryPercent: monitor && device.metrics ? device.metrics.memoryPercent : null,
      diskPercent: monitor && device.metrics ? device.metrics.diskPercent : null,
    })),
    openTickets: tickets.rows.map((ticket) => ({
      id: Number(ticket.id),
      subject: ticket.subject,
      status: ticket.status,
      clock: slaClock(ticket, sla, now),
    })),
    sla,
    compliance,
  };
}

function dashboardCsv(snapshot) {
  let patched = 0;
  let missing = 0;
  const complianceLines = [];
  for (const group of snapshot.compliance) {
    for (const device of group.devices) {
      patched += device.patched.length;
      missing += device.missing.length;
      complianceLines.push([
        "compliance",
        csvCell(group.name),
        csvCell(device.hostname),
        device.patched.length,
        device.missing.length,
      ].join(","));
    }
  }
  const reporting = snapshot.devices.filter((device) => device.reporting).length;
  const lines = [
    ["org", csvCell(snapshot.org?.name || "")].join(","),
    ["devices", snapshot.deviceCount].join(","),
    ["open_tickets", snapshot.openTickets.length].join(","),
    ["reporting", reporting].join(","),
    ["sla_response_minutes", snapshot.sla ? snapshot.sla.responseMinutes : ""].join(","),
    ["sla_resolve_minutes", snapshot.sla ? snapshot.sla.resolveMinutes : ""].join(","),
    ["patched", patched].join(","),
    ["missing", missing].join(","),
    ...snapshot.devices.map((device) => ["device", csvCell(device.hostname)].join(",")),
    ...snapshot.openTickets.map((ticket) => [
      "ticket",
      csvCell(ticket.subject),
      "response_elapsed",
      ticket.clock ? ticket.clock.responseElapsed : "",
      "response_minutes",
      ticket.clock ? ticket.clock.responseMinutes : "",
      "resolve_elapsed",
      ticket.clock ? ticket.clock.resolveElapsed : "",
      "resolve_minutes",
      ticket.clock ? ticket.clock.resolveMinutes : "",
    ].join(",")),
    ...complianceLines,
  ];
  return {
    csv: `${lines.join("\n")}\n`,
    patched,
    missing,
  };
}

async function latestExport(orgId) {
  const result = await pool.query(
    `SELECT s.interval_minutes, s.next_run_at,
            r.id, r.produced_at, r.device_count, r.open_ticket_count,
            r.response_minutes, r.resolve_minutes, r.patched_count, r.missing_count, r.csv
     FROM report_schedules s
     LEFT JOIN LATERAL (
       SELECT id, produced_at, device_count, open_ticket_count,
              response_minutes, resolve_minutes, patched_count, missing_count, csv
       FROM report_runs
       WHERE schedule_id = s.id
       ORDER BY id DESC
       LIMIT 1
     ) r ON true
     WHERE s.org_id = $1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    intervalMinutes: row.interval_minutes,
    nextInHours: Math.max(0, Math.floor((new Date(row.next_run_at).getTime() - Date.now()) / 3600000)),
    latest: row.id == null ? null : {
      id: Number(row.id),
      producedAt: row.produced_at,
      deviceCount: row.device_count,
      openTicketCount: row.open_ticket_count,
      responseMinutes: row.response_minutes,
      resolveMinutes: row.resolve_minutes,
      patchedCount: row.patched_count,
      missingCount: row.missing_count,
      csv: row.csv,
    },
  };
}

let exportTickRunning = false;

async function runDueExports() {
  if (exportTickRunning) return;
  exportTickRunning = true;
  try {
    const due = await pool.query(
      `SELECT id, org_id, interval_minutes
       FROM report_schedules
       WHERE next_run_at <= now()
       ORDER BY id
       LIMIT 5`,
    );
    for (const schedule of due.rows) {
      const license = await pool.query(
        "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
        [schedule.org_id],
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `UPDATE report_schedules
           SET next_run_at = now() + ($2::int * interval '1 minute')
           WHERE id = $1 AND next_run_at <= now()
           RETURNING id`,
          [schedule.id, schedule.interval_minutes],
        );
        if (!claimed.rows[0]) {
          await client.query("ROLLBACK");
          continue;
        }
        if (!reportingAllowed(license.rows[0])) {
          await client.query("COMMIT");
          continue;
        }
        const snapshot = await dashboardSnapshot(schedule.org_id);
        const built = dashboardCsv(snapshot);
        const run = await client.query(
          `INSERT INTO report_runs (
             org_id, schedule_id, csv, device_count, open_ticket_count,
             response_minutes, resolve_minutes, patched_count, missing_count
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            schedule.org_id,
            schedule.id,
            built.csv,
            snapshot.deviceCount,
            snapshot.openTickets.length,
            snapshot.sla ? snapshot.sla.responseMinutes : null,
            snapshot.sla ? snapshot.sla.resolveMinutes : null,
            built.patched,
            built.missing,
          ],
        );
        await client.query(
          `DELETE FROM report_runs
           WHERE id IN (
             SELECT id FROM report_runs
             WHERE org_id = $1
             ORDER BY id DESC
             OFFSET $2
           )`,
          [schedule.org_id, EXPORT_HISTORY_LIMIT],
        );
        await client.query("COMMIT");
        await writeAudit(schedule.org_id, null, "report.export", "report_run", String(run.rows[0].id), {
          deviceCount: snapshot.deviceCount,
          openTicketCount: snapshot.openTickets.length,
          patchedCount: built.patched,
          missingCount: built.missing,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(error.message);
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    exportTickRunning = false;
  }
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
      if (!actor.is_platform_admin && String(actor.org_id || "") !== orgMatch[1]) {
        return send(res, 404, { error: "Org not found." });
      }
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
      const orgId = actor.is_platform_admin ? null : actor.org_id || 0;
      const result = await pool.query(
        `SELECT o.id, o.name, o.slug, l.device_cap, l.modules
         FROM orgs o
         JOIN licenses l ON l.org_id = o.id
         WHERE ($1::bigint IS NULL OR o.id = $1)
           AND ($2::text IS NULL OR o.slug = $2)
         ORDER BY o.id`,
        [orgId, slug],
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
      const metrics = metricsFrom(body);
      const updates = updatesFrom(body);
      const asset = assetFrom(body);
      await pool.query(
        `UPDATE devices
         SET last_seen_at = now(),
             hostname = COALESCE(NULLIF($2, ''), hostname),
             os_name = COALESCE(NULLIF($3, ''), os_name),
             metrics = COALESCE($4::jsonb, metrics),
             updates = CASE WHEN $5::boolean THEN $6::jsonb ELSE updates END,
             make = COALESCE(NULLIF($7, ''), make),
             model = COALESCE(NULLIF($8, ''), model),
             serial = COALESCE(NULLIF($9, ''), serial),
             software = CASE WHEN $10::boolean THEN $11::jsonb ELSE software END
         WHERE id = $1`,
        [
          device.id,
          hostname.slice(0, 200),
          osName.slice(0, 200),
          metrics ? JSON.stringify(metrics) : null,
          updates != null,
          updates ? JSON.stringify(updates) : "[]",
          asset?.make || "",
          asset?.model || "",
          asset?.serial || "",
          asset?.software != null,
          asset?.software ? JSON.stringify(asset.software) : "[]",
        ],
      );
      if (metrics) await evaluateAlerts(device.id);
      await clearOfflineTicket(device.id);
      await attachMissingTickets(device.id);
      const jobs = await pool.query(
        `UPDATE jobs
         SET status = 'running'
         WHERE device_id = $1 AND status = 'queued'
         RETURNING id, command`,
        [device.id],
      );
      const deploys = await pool.query(
        `UPDATE patch_deploys
         SET status = 'running'
         WHERE id = (
           SELECT id FROM patch_deploys
           WHERE device_id = $1 AND status = 'queued'
           ORDER BY id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, package_name`,
        [device.id],
      );
      return send(res, 200, {
        jobs: jobs.rows.map((row) => ({ id: Number(row.id), command: row.command })),
        deploys: deploys.rows.map((row) => ({ id: Number(row.id), packageName: row.package_name })),
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

    const deployResultMatch = url.pathname.match(/^\/v1\/agent\/deploys\/(\d+)\/result$/);
    if (req.method === "POST" && deployResultMatch) {
      const device = await deviceFrom(req);
      if (!device) return send(res, 401, { error: "Device login required." });
      const body = await readJson(req);
      const succeeded = body.ok === true;
      const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 2000) : "";
      const updated = await pool.query(
        `UPDATE patch_deploys
         SET status = $1, detail = $2, finished_at = now()
         WHERE id = $3 AND device_id = $4 AND status = 'running'
         RETURNING id, package_name`,
        [succeeded ? "succeeded" : "failed", detail, deployResultMatch[1], device.id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Deploy not found." });
      await writeAudit(device.org_id, null, "patch.deploy", "patch_deploy", String(updated.rows[0].id), {
        deviceId: Number(device.id),
        packageName: updated.rows[0].package_name,
        status: succeeded ? "succeeded" : "failed",
      });
      return send(res, 200, { id: Number(updated.rows[0].id), status: succeeded ? "succeeded" : "failed" });
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
        `SELECT d.id, d.hostname, d.os_name, d.last_seen_at, d.metrics, d.updates,
                d.make, d.model, d.serial, d.software, c.name AS customer_name
         FROM devices d
         LEFT JOIN sites s ON s.id = d.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE d.org_id = $1
         ORDER BY d.hostname`,
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
        canTicket: ticketingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        remoteReason: access.remoteReason,
        deviceCount: result.rows.length,
        devices: result.rows.map((row) => {
          const job = latest.get(String(row.id));
          return {
            id: row.id,
            hostname: row.hostname,
            customerName: row.customer_name || null,
            osName: row.os_name,
            make: row.make,
            model: row.model,
            serial: row.serial,
            software: row.software,
            lastSeenAt: row.last_seen_at,
            metrics: monitoringAllowed(license.rows[0]) ? row.metrics : null,
            updates: patchAllowed(license.rows[0]) ? row.updates : null,
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
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "job.deny", "device", deviceJobMatch[1], { reason: "role" });
        return send(res, 403, { error: "A technician cannot run a shell." });
      }
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
      const ticketId = body.ticketId == null || body.ticketId === "" ? null : Number(body.ticketId);
      if (ticketId != null) {
        if (!Number.isInteger(ticketId)) return send(res, 404, { error: "Ticket not found." });
        const ticket = await pool.query(
          "SELECT id FROM tickets WHERE id = $1 AND org_id = $2 AND device_id = $3",
          [ticketId, actor.org_id, device.rows[0].id],
        );
        if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      }
      const job = await pool.query(
        `INSERT INTO jobs (org_id, device_id, command, created_by, ticket_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [actor.org_id, device.rows[0].id, command, actor.id, ticketId],
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
      const body = await readJson(req);
      const ticketId = body.ticketId == null || body.ticketId === "" ? null : Number(body.ticketId);
      if (ticketId != null) {
        if (!Number.isInteger(ticketId)) return send(res, 404, { error: "Ticket not found." });
        const ticket = await pool.query(
          "SELECT id FROM tickets WHERE id = $1 AND org_id = $2 AND device_id = $3",
          [ticketId, actor.org_id, device.rows[0].id],
        );
        if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      }
      const url = await meshDesktopUrl(
        device.rows[0].mesh_node_id,
        `df-${device.rows[0].id}-${Date.now()}`,
        device.rows[0].os_name,
      );
      await pool.query(
        `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
         VALUES ($1, $2, 'remote.launch', 'device', $3, $4::jsonb)`,
        [
          actor.org_id,
          actor.id,
          String(device.rows[0].id),
          JSON.stringify(ticketId == null ? {} : { ticketId }),
        ],
      );
      return send(res, 200, { url });
    }

    if (req.method === "POST" && url.pathname === "/v1/customers") {
      if (!(await requireTicketing(actor, res))) return;
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 200) return send(res, 400, { error: "Enter a customer name." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const customer = await client.query(
          "INSERT INTO customers (org_id, name) VALUES ($1, $2) RETURNING id, name",
          [actor.org_id, name],
        );
        const site = await client.query(
          "INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Primary') RETURNING id",
          [actor.org_id, customer.rows[0].id],
        );
        await client.query("COMMIT");
        await writeAudit(actor.org_id, actor.id, "customer.create", "customer", String(customer.rows[0].id), {
          name,
          siteId: String(site.rows[0].id),
        });
        return send(res, 201, {
          id: Number(customer.rows[0].id),
          name: customer.rows[0].name,
          siteId: Number(site.rows[0].id),
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The transaction was already closed.
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "PUT" && url.pathname === "/v1/sla") {
      if (!(await requireTicketing(actor, res))) return;
      const body = await readJson(req);
      const responseMinutes = slaMinutes(body.responseMinutes);
      const resolveMinutes = slaMinutes(body.resolveMinutes);
      if (responseMinutes == null || resolveMinutes == null) {
        return send(res, 400, { error: "Enter response and resolve targets in minutes." });
      }
      await pool.query(
        `INSERT INTO org_slas (org_id, response_minutes, resolve_minutes)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id) DO UPDATE
         SET response_minutes = EXCLUDED.response_minutes,
             resolve_minutes = EXCLUDED.resolve_minutes,
             updated_at = now()`,
        [actor.org_id, responseMinutes, resolveMinutes],
      );
      await writeAudit(actor.org_id, actor.id, "sla.update", "org", String(actor.org_id), {
        responseMinutes,
        resolveMinutes,
      });
      return send(res, 200, { responseMinutes, resolveMinutes });
    }

    if (req.method === "GET" && url.pathname === "/v1/alerts") {
      if (!(await requireMonitoring(actor, res))) return;
      const [alerts, devices, license] = await Promise.all([
        pool.query(
          `SELECT a.id, a.metric, a.value, a.threshold, a.ticket_id, a.created_at, d.hostname
           FROM alerts a
           JOIN devices d ON d.id = a.device_id
           WHERE a.org_id = $1
           ORDER BY a.id DESC`,
          [actor.org_id],
        ),
        pool.query(
          "SELECT id, hostname FROM devices WHERE org_id = $1 ORDER BY hostname",
          [actor.org_id],
        ),
        pool.query("SELECT expires_at, modules FROM licenses WHERE org_id = $1", [actor.org_id]),
      ]);
      return send(res, 200, {
        canTicket: ticketingAllowed(license.rows[0]),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        alerts: alerts.rows.map((row) => ({
          id: Number(row.id),
          metric: row.metric,
          value: row.value,
          threshold: row.threshold,
          ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
          hostname: row.hostname,
          createdAt: row.created_at,
        })),
        devices: devices.rows.map((row) => ({ id: Number(row.id), hostname: row.hostname })),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/alert-rules") {
      if (!(await requireMonitoring(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const deviceId = Number(body.deviceId);
      const metric = typeof body.metric === "string" ? body.metric : "";
      const threshold = Number(body.threshold);
      if (!Number.isInteger(deviceId)) return send(res, 400, { error: "Choose a device." });
      if (!Object.hasOwn(ALERT_METRICS, metric)) return send(res, 400, { error: "Choose a metric." });
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
        return send(res, 400, { error: "Enter a threshold from 1 to 100." });
      }
      const device = await pool.query(
        "SELECT id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceId, actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const rule = await pool.query(
        `INSERT INTO alert_rules (org_id, device_id, metric, threshold, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [actor.org_id, deviceId, metric, threshold, actor.id],
      );
      await writeAudit(actor.org_id, actor.id, "alert.rule", "alert_rule", String(rule.rows[0].id), {
        deviceId,
        metric,
        threshold,
      });
      await evaluateAlerts(deviceId);
      return send(res, 201, { id: Number(rule.rows[0].id) });
    }

    const alertTicketMatch = url.pathname.match(/^\/v1\/alerts\/(\d+)\/ticket$/);
    if (req.method === "POST" && alertTicketMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const alert = await pool.query(
        `SELECT a.id, a.device_id, a.metric, a.value, a.ticket_id, d.hostname, s.customer_id
         FROM alerts a
         JOIN devices d ON d.id = a.device_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE a.id = $1 AND a.org_id = $2`,
        [alertTicketMatch[1], actor.org_id],
      );
      if (!alert.rows[0]) return send(res, 404, { error: "Alert not found." });
      if (alert.rows[0].ticket_id != null) {
        return send(res, 200, { id: Number(alert.rows[0].ticket_id) });
      }
      const customerId = alert.rows[0].customer_id == null ? null : Number(alert.rows[0].customer_id);
      if (customerId == null) return send(res, 409, { error: "That device is not linked to a customer." });
      const label = ALERT_LABELS[alert.rows[0].metric] || alert.rows[0].metric;
      const subject = `${label} ${alert.rows[0].value}% on ${alert.rows[0].hostname}`.slice(0, 200);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ticket = await client.query(
          `INSERT INTO tickets (org_id, customer_id, device_id, assignee_user_id, subject, status, priority, created_by)
           VALUES ($1, $2, $3, $4, $5, 'open', 'high', $4)
           RETURNING id`,
          [actor.org_id, customerId, alert.rows[0].device_id, actor.id, subject],
        );
        await client.query("UPDATE alerts SET ticket_id = $1 WHERE id = $2", [ticket.rows[0].id, alert.rows[0].id]);
        await client.query("COMMIT");
        await writeAudit(actor.org_id, actor.id, "ticket.create", "ticket", String(ticket.rows[0].id), {
          alertId: Number(alert.rows[0].id),
          customerId,
          deviceId: Number(alert.rows[0].device_id),
          status: "open",
          priority: "high",
        });
        await notifyNewTicket(actor.org_id, ticket.rows[0].id, subject);
        return send(res, 201, { id: Number(ticket.rows[0].id) });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The transaction was already closed.
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/license-usage") {
      if (!requireActor(actor, res)) return;
      if (!actor.is_platform_admin) {
        if (!(await requireReporting(actor, res))) return;
        const org = await pool.query("SELECT slug FROM orgs WHERE id = $1", [actor.org_id]);
        if (org.rows[0]?.slug !== "digital-fingers") {
          return send(res, 403, { error: "License usage is not included on this license." });
        }
      }
      const license = actor.org_id
        ? await pool.query("SELECT expires_at, modules FROM licenses WHERE org_id = $1", [actor.org_id])
        : { rows: [] };
      const row = license.rows[0];
      const scopeOrgId = actor.is_platform_admin || canOperate(actor) ? null : actor.org_id;
      const usage = await pool.query(
        `SELECT o.id, o.name, l.seats, l.device_cap,
                (SELECT count(*)::int FROM devices d WHERE d.org_id = o.id) AS device_count
         FROM orgs o
         JOIN licenses l ON l.org_id = o.id
         WHERE ($1::bigint IS NULL OR o.id = $1)
         ORDER BY o.id`,
        [scopeOrgId],
      );
      return send(res, 200, {
        canTicket: ticketingAllowed(row),
        canMonitor: monitoringAllowed(row),
        canPatch: patchAllowed(row),
        canReport: actor.is_platform_admin || reportingAllowed(row),
        orgs: usage.rows.map((item) => ({
          id: Number(item.id),
          name: item.name,
          seats: item.seats,
          deviceCap: item.device_cap,
          deviceCount: item.device_count,
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/dashboard") {
      if (!(await requireReporting(actor, res))) return;
      const snapshot = await dashboardSnapshot(actor.org_id);
      return send(res, 200, {
        ...snapshot,
        schedule: await latestExport(actor.org_id),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/report-schedules") {
      if (!(await requireReporting(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const interval = Number(body.intervalMinutes);
      if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
        return send(res, 400, { error: "Choose an interval from 1 to 1440 minutes." });
      }
      try {
        const inserted = await pool.query(
          `INSERT INTO report_schedules (org_id, interval_minutes, next_run_at, created_by)
           VALUES ($1, $2, now(), $3)
           RETURNING id`,
          [actor.org_id, interval, actor.id],
        );
        await writeAudit(actor.org_id, actor.id, "report.schedule", "org", String(actor.org_id), {
          intervalMinutes: interval,
        });
        return send(res, 201, { id: Number(inserted.rows[0].id) });
      } catch (error) {
        if (error.code === "23505") return send(res, 409, { error: "That org already has an export schedule." });
        throw error;
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/report-runs/latest") {
      if (!(await requireReporting(actor, res))) return;
      const run = await pool.query(
        "SELECT csv FROM report_runs WHERE org_id = $1 ORDER BY id DESC LIMIT 1",
        [actor.org_id],
      );
      if (!run.rows[0]) return send(res, 404, { error: "No export has been produced yet." });
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(run.rows[0].csv);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/patches") {
      if (!(await requirePatch(actor, res))) return;
      const [policies, deploys, devices, fleet, succeeded, license] = await Promise.all([
        pool.query(
          `SELECT p.id, p.name, p.mode, p.device_id, d.hostname
           FROM patch_policies p
           JOIN devices d ON d.id = p.device_id
           WHERE p.org_id = $1
           ORDER BY p.id`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT d.id, d.package_name, d.status, d.detail, d.policy_id, p.name AS policy_name, p.mode, dev.hostname
           FROM patch_deploys d
           JOIN patch_policies p ON p.id = d.policy_id
           JOIN devices dev ON dev.id = d.device_id
           WHERE d.org_id = $1
           ORDER BY dev.hostname, d.id`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT id, hostname
           FROM devices
           WHERE org_id = $1
             AND jsonb_typeof(updates) = 'array'
             AND jsonb_array_length(updates) > 0
             AND id NOT IN (SELECT device_id FROM patch_policies WHERE org_id = $1)
           ORDER BY hostname`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT d.id, d.hostname, d.updates, d.software, c.id AS customer_id, c.name AS customer_name
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE d.org_id = $1
           ORDER BY c.name NULLS LAST, d.hostname`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT device_id, package_name
           FROM patch_deploys
           WHERE org_id = $1 AND status = 'succeeded'
           ORDER BY id`,
          [actor.org_id],
        ),
        pool.query("SELECT expires_at, modules FROM licenses WHERE org_id = $1", [actor.org_id]),
      ]);
      return send(res, 200, {
        canTicket: ticketingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        policies: policies.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          mode: row.mode,
          deviceId: Number(row.device_id),
          hostname: row.hostname,
        })),
        deploys: deploys.rows.map((row) => ({
          id: Number(row.id),
          packageName: row.package_name,
          status: row.status,
          detail: row.detail || "",
          policyId: Number(row.policy_id),
          policyName: row.policy_name,
          mode: row.mode,
          hostname: row.hostname,
        })),
        devices: devices.rows.map((row) => ({ id: Number(row.id), hostname: row.hostname })),
        compliance: complianceFrom(fleet.rows, succeeded.rows),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/patch-policies") {
      if (!(await requirePatch(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const deviceId = Number(body.deviceId);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const mode = body.mode === "auto" ? "auto" : body.mode === "approve" ? "approve" : "";
      if (!Number.isInteger(deviceId)) return send(res, 400, { error: "Choose a device." });
      if (!name || name.length > 80) return send(res, 400, { error: "Enter a policy name." });
      if (!mode) return send(res, 400, { error: "Choose a policy." });
      const device = await pool.query(
        "SELECT id, updates FROM devices WHERE id = $1 AND org_id = $2",
        [deviceId, actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const packages = Array.isArray(device.rows[0].updates)
        ? device.rows[0].updates.map((item) => (typeof item?.name === "string" ? item.name.trim() : "")).filter(Boolean)
        : [];
      if (packages.length === 0) return send(res, 409, { error: "That device has no updates waiting." });
      const status = mode === "auto" ? "queued" : "waiting";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const policy = await client.query(
          `INSERT INTO patch_policies (org_id, device_id, name, mode, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [actor.org_id, deviceId, name, mode, actor.id],
        );
        for (const packageName of packages) {
          await client.query(
            `INSERT INTO patch_deploys (org_id, policy_id, device_id, package_name, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [actor.org_id, policy.rows[0].id, deviceId, packageName.slice(0, 200), status, actor.id],
          );
        }
        await client.query("COMMIT");
        await writeAudit(actor.org_id, actor.id, "patch.policy", "patch_policy", String(policy.rows[0].id), {
          deviceId,
          mode,
          status,
          count: packages.length,
        });
        return send(res, 201, { id: Number(policy.rows[0].id) });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The transaction was already closed.
        }
        if (error.code === "23505") return send(res, 409, { error: "That device already has a patch policy." });
        throw error;
      } finally {
        client.release();
      }
    }

    const patchApproveMatch = url.pathname.match(/^\/v1\/patch-deploys\/(\d+)\/approve$/);
    if (req.method === "POST" && patchApproveMatch) {
      if (!(await requirePatch(actor, res))) return;
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "patch.deny", "patch_deploy", patchApproveMatch[1], { reason: "role" });
        return send(res, 403, { error: "A technician cannot approve a patch." });
      }
      const found = await pool.query(
        `SELECT d.id, d.status, d.package_name, d.device_id, p.mode, p.id AS policy_id
         FROM patch_deploys d
         JOIN patch_policies p ON p.id = d.policy_id
         WHERE d.id = $1 AND d.org_id = $2`,
        [patchApproveMatch[1], actor.org_id],
      );
      if (!found.rows[0]) return send(res, 404, { error: "Update not found." });
      if (found.rows[0].mode !== "approve") {
        return send(res, 409, { error: "That policy deploys without approval." });
      }
      if (found.rows[0].status !== "waiting") {
        return send(res, 409, { error: "That update is already queued." });
      }
      const updated = await pool.query(
        `UPDATE patch_deploys
         SET status = 'queued', approved_by = $1
         WHERE id = $2 AND org_id = $3 AND status = 'waiting'
         RETURNING id`,
        [actor.id, found.rows[0].id, actor.org_id],
      );
      if (!updated.rows[0]) return send(res, 409, { error: "That update is already queued." });
      await writeAudit(actor.org_id, actor.id, "patch.approve", "patch_deploy", String(updated.rows[0].id), {
        policyId: Number(found.rows[0].policy_id),
        deviceId: Number(found.rows[0].device_id),
        packageName: found.rows[0].package_name,
      });
      return send(res, 200, { id: Number(updated.rows[0].id), status: "queued" });
    }

    if (req.method === "GET" && url.pathname === "/v1/tickets") {
      if (!(await requireTicketing(actor, res))) return;
      const [tickets, customers, devices, users] = await Promise.all([
        pool.query(
          `SELECT t.id, t.subject, t.status, t.priority, t.customer_id, c.name AS customer_name,
                  t.device_id, d.hostname AS device_hostname, t.assignee_user_id,
                  u.name AS assignee_name, u.email AS assignee_email, t.created_at, t.updated_at,
                  (SELECT count(*)::int FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
           FROM tickets t
           JOIN customers c ON c.id = t.customer_id
           JOIN devices d ON d.id = t.device_id
           LEFT JOIN users u ON u.id = t.assignee_user_id
           WHERE t.org_id = $1
           ORDER BY t.id DESC`,
          [actor.org_id],
        ),
        pool.query("SELECT id, name FROM customers WHERE org_id = $1 ORDER BY name", [actor.org_id]),
        pool.query(
          `SELECT d.id, d.hostname, s.customer_id, c.name AS customer_name
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE d.org_id = $1
           ORDER BY d.hostname`,
          [actor.org_id],
        ),
        pool.query("SELECT id, name, email FROM users WHERE org_id = $1 ORDER BY name", [actor.org_id]),
      ]);
      return send(res, 200, {
        tickets: tickets.rows.map((row) => ({ ...ticketView(row), commentCount: row.comment_count })),
        customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
        devices: devices.rows.map((row) => ({
          id: Number(row.id),
          hostname: row.hostname,
          customerId: row.customer_id == null ? null : Number(row.customer_id),
          customerName: row.customer_name || null,
        })),
        users: users.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })),
        sla: await orgSla(actor.org_id),
        canPatch: patchAllowed((await pool.query(
          "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
          [actor.org_id],
        )).rows[0]),
        canReport: reportingAllowed((await pool.query(
          "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
          [actor.org_id],
        )).rows[0]),
        canMonitor: monitoringAllowed((await pool.query(
          "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
          [actor.org_id],
        )).rows[0]),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/tickets") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const status = body.status || "open";
      const priority = body.priority || "normal";
      const customerId = Number(body.customerId);
      const deviceId = Number(body.deviceId);
      const assigneeUserId = body.assigneeUserId == null || body.assigneeUserId === "" ? null : Number(body.assigneeUserId);
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      if (!subject || subject.length > 200) return send(res, 400, { error: "Enter a subject." });
      if (!TICKET_STATUSES.has(status) || !TICKET_PRIORITIES.has(priority)) {
        return send(res, 400, { error: "Choose a status and priority." });
      }
      if (!Number.isInteger(customerId) || !Number.isInteger(deviceId)) {
        return send(res, 400, { error: "Choose a customer and a device." });
      }
      if (comment.length > 4000) return send(res, 400, { error: "Comment is too long." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const linked = await linkDeviceToCustomer(client, actor.org_id, customerId, deviceId);
        if (linked.error) {
          await client.query("ROLLBACK");
          return send(res, linked.status, { error: linked.error });
        }
        if (assigneeUserId != null) {
          const assignee = await client.query(
            "SELECT id FROM users WHERE id = $1 AND org_id = $2",
            [assigneeUserId, actor.org_id],
          );
          if (!assignee.rows[0]) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "Choose an assignee in this organisation." });
          }
        }
        const ticket = await client.query(
          `INSERT INTO tickets (org_id, customer_id, device_id, assignee_user_id, subject, status, priority, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [actor.org_id, customerId, deviceId, assigneeUserId, subject, status, priority, actor.id],
        );
        if (comment) {
          await client.query(
            `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body)
             VALUES ($1, $2, $3, $4)`,
            [actor.org_id, ticket.rows[0].id, actor.id, comment],
          );
        }
        await client.query("COMMIT");
        if (linked.linked) {
          await writeAudit(actor.org_id, actor.id, "device.link", "device", String(deviceId), {
            customerId,
            siteId: linked.siteId,
          });
        }
        await writeAudit(actor.org_id, actor.id, "ticket.create", "ticket", String(ticket.rows[0].id), {
          customerId,
          deviceId,
          status,
          priority,
          assigneeUserId,
        });
        await notifyNewTicket(actor.org_id, ticket.rows[0].id, subject);
        return send(res, 201, { id: Number(ticket.rows[0].id) });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The transaction was already closed.
        }
        throw error;
      } finally {
        client.release();
      }
    }

    const ticketCommentMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)\/comments$/);
    if (req.method === "POST" && ticketCommentMatch) {
      if (!(await requireTicketing(actor, res))) return;
      const body = await readJson(req);
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text || text.length > 4000) return send(res, 400, { error: "Enter a comment." });
      const ticket = await pool.query(
        "SELECT id FROM tickets WHERE id = $1 AND org_id = $2",
        [ticketCommentMatch[1], actor.org_id],
      );
      if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      const comment = await pool.query(
        `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [actor.org_id, ticket.rows[0].id, actor.id, text],
      );
      await pool.query("UPDATE tickets SET updated_at = now() WHERE id = $1", [ticket.rows[0].id]);
      await writeAudit(actor.org_id, actor.id, "ticket.comment", "ticket", String(ticket.rows[0].id), {
        commentId: String(comment.rows[0].id),
      });
      return send(res, 201, { id: Number(comment.rows[0].id) });
    }

    const ticketMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)$/);
    if (ticketMatch && (req.method === "GET" || req.method === "PATCH")) {
      if (!(await requireTicketing(actor, res))) return;
      if (req.method === "PATCH") {
        const body = await readJson(req);
        const status = body.status;
        const priority = body.priority;
        const assigneeUserId = body.assigneeUserId == null || body.assigneeUserId === "" ? null : Number(body.assigneeUserId);
        if (!TICKET_STATUSES.has(status) || !TICKET_PRIORITIES.has(priority)) {
          return send(res, 400, { error: "Choose a status and priority." });
        }
        if (assigneeUserId != null) {
          const assignee = await pool.query(
            "SELECT id FROM users WHERE id = $1 AND org_id = $2",
            [assigneeUserId, actor.org_id],
          );
          if (!assignee.rows[0]) return send(res, 400, { error: "Choose an assignee in this organisation." });
        }
        const updated = await pool.query(
          `UPDATE tickets
           SET status = $1, priority = $2, assignee_user_id = $3, updated_at = now()
           WHERE id = $4 AND org_id = $5
           RETURNING id`,
          [status, priority, assigneeUserId, ticketMatch[1], actor.org_id],
        );
        if (!updated.rows[0]) return send(res, 404, { error: "Ticket not found." });
        await writeAudit(actor.org_id, actor.id, "ticket.update", "ticket", String(updated.rows[0].id), {
          status,
          priority,
          assigneeUserId,
        });
      }
      const ticket = await pool.query(
        `SELECT t.id, t.subject, t.status, t.priority, t.customer_id, c.name AS customer_name,
                t.device_id, d.hostname AS device_hostname, d.os_name AS device_os_name,
                d.mesh_node_id IS NOT NULL AS device_has_remote,
                t.assignee_user_id, u.name AS assignee_name, u.email AS assignee_email,
                t.created_at, t.updated_at, ${TICKET_CLOCK_SQL}
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         JOIN devices d ON d.id = t.device_id
         LEFT JOIN users u ON u.id = t.assignee_user_id
         WHERE t.id = $1 AND t.org_id = $2`,
        [ticketMatch[1], actor.org_id],
      );
      if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      const license = await pool.query(
        "SELECT expires_at, modules FROM licenses WHERE org_id = $1",
        [actor.org_id],
      );
      const comments = await pool.query(
        `SELECT tc.id, tc.body, tc.created_at, u.name AS author_name
         FROM ticket_comments tc
         LEFT JOIN users u ON u.id = tc.author_user_id
         WHERE tc.ticket_id = $1
         ORDER BY tc.id`,
        [ticket.rows[0].id],
      );
      const users = await pool.query(
        "SELECT id, name, email FROM users WHERE org_id = $1 ORDER BY name",
        [actor.org_id],
      );
      const view = ticketView(ticket.rows[0]);
      const latestJob = await pool.query(
        `SELECT id, command, status, exit_code, output, finished_at
         FROM jobs
         WHERE ticket_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [ticket.rows[0].id],
      );
      const job = latestJob.rows[0];
      const sla = await orgSla(actor.org_id);
      return send(res, 200, {
        canRemote: remoteAccess(license.rows[0]).canRemote,
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        sla,
        clock: slaClock(ticket.rows[0], sla, new Date()),
        ticket: {
          ...view,
          device: {
            ...view.device,
            osName: ticket.rows[0].device_os_name,
            hasRemote: Boolean(ticket.rows[0].device_has_remote),
          },
          latestJob: job
            ? {
                id: Number(job.id),
                command: job.command,
                status: job.status,
                exitCode: job.exit_code,
                output: job.output,
                finishedAt: job.finished_at,
              }
            : null,
          comments: comments.rows.map((row) => ({
            id: Number(row.id),
            body: row.body,
            createdAt: row.created_at,
            authorName: row.author_name || "Unknown",
          })),
        },
        users: users.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/audit") {
      if (!requireActor(actor, res)) return;
      const action = url.searchParams.get("action");
      const orgId = actor.is_platform_admin ? null : actor.org_id || 0;
      const license = actor.org_id
        ? await pool.query("SELECT expires_at, modules FROM licenses WHERE org_id = $1", [actor.org_id])
        : { rows: [] };
      const row = license.rows[0];
      const result = await pool.query(
        `SELECT e.id, e.action, e.target_type, e.target_id, e.created_at,
                u.email AS actor_email, t.subject AS ticket_subject
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
         LEFT JOIN tickets t
           ON e.target_type = 'ticket' AND t.org_id = e.org_id AND t.id::text = e.target_id
         WHERE ($1::bigint IS NULL OR e.org_id = $1)
           AND ($2::text IS NULL OR e.action = $2)
         ORDER BY e.id DESC
         LIMIT 50`,
        [orgId, action],
      );
      return send(res, 200, {
        canTicket: ticketingAllowed(row),
        canMonitor: monitoringAllowed(row),
        canPatch: patchAllowed(row),
        canReport: reportingAllowed(row),
        events: result.rows.map((event) => ({
          id: Number(event.id),
          action: event.action,
          targetType: event.target_type,
          targetId: event.target_id,
          ticketSubject: event.ticket_subject || null,
          actorEmail: event.actor_email || null,
          createdAt: event.created_at,
        })),
      });
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
  setInterval(() => {
    runDueExports();
    sweepOffline();
    sweepBreaches();
  }, 15000);
  runDueExports();
  sweepOffline();
  sweepBreaches();
});
