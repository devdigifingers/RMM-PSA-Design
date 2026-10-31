import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { BlockList, isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import { pool } from "./db.js";
import { enterRequest, insertAudit, setRequestRole } from "./audit.js";
import { sendMail } from "./mail.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { loadAllLicenses, loadLicense } from "./license-store.js";
import { hasApp, hasFeature } from "./licensing.js";
import { dateOnly, isOverdue, listFields, resolveCustomerView, slaFor, ticketDue, viewScope } from "./customer-views.js";
import { calendarFrom, parsePercent, percentFrom, ticketClock } from "./sla-engine.js";
import { handlePlatformAdmin } from "./platform-admin.js";
import { handleInvites } from "./invites.js";
import { handlePlatformTeam } from "./platform-team.js";
import { mfaSetupNeeded, supportBlocked } from "./platform-team-rules.js";
import { deskNotify, deskSetup, handleDeskSettings, notifyWatchers } from "./desk-settings.js";
import { autoCloseSweep, deskOptions, handleDeskFlow, runAutomations } from "./desk-flow.js";
import { emailAgentReply, emailResolved, handleDeskMail, pollMailboxes } from "./desk-mail.js";
import { handleCsat } from "./desk-csat.js";
import { handleMigrations, migrationTick, platformWaiting, recoverMigrations, tenantWaiting } from "./migrations.js";
import { customerInsights } from "./customer-insights.js";
import { remoteAgentChange, remoteAgentFrom, remoteAgentOffer, remoteAgentView } from "./remote-agent.js";
import { handleApiTokens, handleTokenApi } from "./api-tokens.js";
import { COMMAND_MAX, scriptProblem } from "./job-input.js";
import {
  ACTIVITY_GROUPS,
  activityFromTicketEvent,
  recordActivity,
  recordActivitySafely,
  ticketActor,
  ticketTimelineQuery,
  timelineQuery,
  timelineView,
} from "./activity.js";
import { fleetVersions } from "./system-view.js";
import { geoLocator, ipApiLocator, parseIp } from "./geoip.js";
import { dailyStats, fillDays, osFamily } from "./daily-stats.js";
import { reportPdf } from "./pdf.js";
import { REPORTS, buildReport, localDay, previousMonth, reportByKey, reportCsv, reportJson, reportRange } from "./reports.js";
import { deviceFacts, deviceFilterFrom, deviceMatches, overviewFrom } from "./dashboard-overview.js";
import {
  ATTACHMENT_LIMIT,
  attachmentIds,
  commentAuthor,
  contentDisposition,
  imageType,
  safeFileName as attachmentName,
  storedContentType,
  ticketChanges,
  timeInput,
  timelineItem,
  timerMinutes,
  timeTotals,
} from "./ticket-events.js";
import {
  cleanCategory,
  cleanColumns,
  cleanTags,
  cleanViewQuery,
  csvCell,
  DEFAULT_COLUMNS,
  EXPORT_LIMIT,
  filterTickets,
  LIST_COLUMNS,
  PAGE_SIZE,
  pageOf,
  parseListQuery,
  slaState,
  sortTickets,
  ticketsCsv,
  viewCounts,
} from "./ticket-list.js";
import { parseCc, parseChannel, parseDueAt, parseStatusId, similarTickets } from "./ticket-input.js";

const TICKET_STATUSES = new Set(["open", "pending", "resolved"]);
const TICKET_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const EXPORT_HISTORY_LIMIT = 30;
const port = Number(process.env.PORT || 4000);
const downloadTickets = new Map();
const DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const UPLOAD_LIMIT = 8 * 1024 * 1024 * 1024;
const UPLOAD_MS = 6 * 60 * 60 * 1000;
const fileUploads = new Map();

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

function headerNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number;
}

function pipeBody(req, file, max, already) {
  return new Promise((resolve, reject) => {
    let size = already;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      file.destroy();
      req.destroy();
      reject(error);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        fail(Object.assign(new Error("That file is larger than 8 GB."), { status: 413 }));
        return;
      }
      if (!file.write(chunk)) req.pause();
    });
    file.on("drain", () => req.resume());
    req.on("end", () => {
      if (failed) return;
      file.end(() => resolve(size));
    });
    req.on("error", fail);
    file.on("error", fail);
  });
}

function readBytes(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error("That file is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function filePathValue(value) {
  const path = String(value || "").replace(/\\/g, "/").trim();
  if (path.length > 400 || path.includes("\0") || path.split("/").includes("..")) return null;
  return path;
}

function fileNameValue(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 120 || name === "." || name === ".." || /[\\/\0:*?"<>|]/.test(name)) return "";
  return name;
}

function readJson(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
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

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_IP_LIMIT = 20;
const LOGIN_EMAIL_LIMIT = 8;
let dummyHash = null;

function dummyPasswordHash() {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString("base64url"));
  return dummyHash;
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().toLowerCase();
  return /^[0-9a-f.:]{3,45}$/.test(forwarded) ? forwarded : "unknown";
}

const MFA_ISSUER = "Digital Fingers RMM";
const MFA_PENDING_SECONDS = 300;
const MFA_MAX_TRIES = 5;
const MFA_SETUP_PATHS = new Set(["/v1/account", "/v1/logout", "/v1/account/mfa/setup", "/v1/account/mfa/enable"]);
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

function base32Decode(text) {
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Bad base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, "0");
}

function mfaKey() {
  if (!process.env.MFA_KEY) throw Object.assign(new Error("MFA is not configured on the server."), { status: 500 });
  return createHash("sha256").update(process.env.MFA_KEY).digest();
}

function sealSecret(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaKey(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

function openSecret(sealed) {
  const [version, iv, tag, body] = String(sealed || "").split(":");
  if (version !== "v1") throw new Error("Unknown MFA secret format");
  const decipher = createDecipheriv("aes-256-gcm", mfaKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function totpValid(userId, secret, code) {
  const clean = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    if (!sameText(totpCode(secret, step), clean)) continue;
    const fresh = await redis.set(`mfa-used:${userId}:${step}`, "1", "EX", 120, "NX");
    return fresh === "OK";
  }
  return false;
}

function recoveryHash(code) {
  return createHash("sha256").update(String(code).toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
}

function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const raw = randomBytes(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(recoveryHash) };
}

async function mfaCheck(user, code) {
  if (await totpValid(user.id, openSecret(user.mfa_secret), code)) return { ok: true };
  const hash = recoveryHash(code);
  const left = Array.isArray(user.mfa_recovery) ? user.mfa_recovery : [];
  if (String(code || "").replace(/[^a-z0-9]/gi, "").length === 10 && left.includes(hash)) {
    await pool.query("UPDATE users SET mfa_recovery = $2::jsonb WHERE id = $1", [user.id, JSON.stringify(left.filter((item) => item !== hash))]);
    return { ok: true, recovery: true };
  }
  return { ok: false };
}

function normaliseAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.startsWith("::ffff:") && isIP(text.slice(7)) === 4 ? text.slice(7) : text;
}

function parseAllowlist(value) {
  const lines = (Array.isArray(value) ? value : String(value || "").split(/[\s,]+/)).map((item) => String(item).trim()).filter(Boolean);
  if (lines.length > 50) return { error: "Use at most 50 addresses or ranges." };
  const out = [];
  for (const line of lines) {
    const [address, prefixText] = line.split("/");
    const family = isIP(address);
    const max = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!family || !Number.isInteger(prefix) || prefix < (family === 4 ? 8 : 16) || prefix > max) {
      return { error: `"${line.slice(0, 60)}" is not a valid IP address or range.` };
    }
    out.push(prefix === max ? address.toLowerCase() : `${address.toLowerCase()}/${prefix}`);
  }
  return { value: [...new Set(out)] };
}

function addressAllowed(address, list) {
  if (!list || list.length === 0) return true;
  const ip = normaliseAddress(address);
  const family = isIP(ip);
  if (!family) return false;
  const block = new BlockList();
  for (const entry of list) {
    const [net, prefix] = entry.split("/");
    const type = isIP(net) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) block.addAddress(net, type);
    else block.addSubnet(net, Number(prefix), type);
  }
  return block.check(ip, family === 4 ? "ipv4" : "ipv6");
}

const IMPERSONATION_TTL_SECONDS = 60 * 60;

async function issueSession(res, user) {
  const token = randomBytes(32).toString("base64url");
  await redis.multi()
    .set(`session:${token}`, JSON.stringify({ userId: user.id }), "EX", SESSION_TTL_SECONDS)
    .sadd(`user-sessions:${user.id}`, token)
    .expire(`user-sessions:${user.id}`, SESSION_TTL_SECONDS)
    .exec();
  return send(res, 200, {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.is_platform_admin,
      mfaSetupRequired: mfaSetupNeeded(user),
    },
  });
}

async function revokeOrgSessions(orgId, keepUserId) {
  const users = await pool.query("SELECT id FROM users WHERE org_id = $1 AND id <> $2", [orgId, keepUserId]);
  for (const row of users.rows) await revokeUserSessions(row.id, null);
}

function loginLimitKeys(req, email) {
  return {
    ip: `login-fail-ip:${clientAddress(req)}`,
    email: `login-fail-email:${createHash("sha256").update(email).digest("hex")}`,
  };
}

async function revokeUserSessions(userId, keepToken) {
  const key = `user-sessions:${userId}`;
  const tokens = await redis.smembers(key);
  const drop = tokens.filter((token) => token !== keepToken);
  const batch = redis.multi();
  for (const token of drop) batch.del(`session:${token}`);
  if (drop.length) batch.srem(key, ...drop);
  await batch.exec();
}

async function actorFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const raw = await redis.get(`session:${token}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.org_id, u.is_platform_admin, u.account_number, u.mfa_enabled_at,
            u.platform_role, u.platform_mfa_due_at, COALESCE(o.require_mfa, false) AS require_mfa
     FROM users u LEFT JOIN orgs o ON o.id = u.org_id
     WHERE u.id = $1 AND u.disabled_at IS NULL`,
    [session.userId],
  );
  const actor = result.rows[0];
  if (!actor) return null;
  actor.session_token = token;
  if (session.impersonateOrgId) {
    if (!actor.is_platform_admin) return null;
    const org = await pool.query("SELECT id, name FROM orgs WHERE id = $1", [session.impersonateOrgId]);
    if (!org.rows[0]) return null;
    actor.impersonating = { orgId: Number(org.rows[0].id), orgName: org.rows[0].name, startedAt: session.startedAt || null };
    actor.is_platform_admin = false;
    actor.org_id = org.rows[0].id;
    actor.mfa_setup_required = false;
    actor.roles = ["admin"];
    return actor;
  }
  actor.mfa_setup_required = mfaSetupNeeded(actor);
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

function meshControl(args, creds) {
  const meshUrl = String(process.env.MESH_URL || "").replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const loginUser = creds?.user || process.env.MESH_USER;
  const loginPass = creds?.pass || process.env.MESH_PASSWORD;
  if (!meshUrl || !loginUser || !loginPass) {
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
        loginUser,
        "--loginpass",
        loginPass,
      ],
      { cwd: "/opt/meshcentral" },
    );
    const out = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error("Remote service did not answer."), { status: 502 }));
    }, 25000);
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(false, error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      finish(true, Buffer.concat(out).toString("utf8"));
    });
  });
}

function remoteView(osName) {
  return /windows/i.test(osName || "") ? "11" : "12";
}

function meshJson(text) {
  const source = String(text || "");
  const objectAt = source.indexOf("{");
  const listAt = source.indexOf("[");
  const start = objectAt < 0 ? listAt : listAt < 0 ? objectAt : Math.min(objectAt, listAt);
  if (start < 0) return null;
  const end = source.lastIndexOf(source[start] === "[" ? "]" : "}");
  if (end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SUPPORT_GROUP_NAME = "Digital Fingers Support";

function supportMeshRow(row) {
  return String(row?.groupname || "").startsWith(SUPPORT_GROUP_NAME);
}

function meshNodeMatch(rows, hostname, displayName) {
  if (!Array.isArray(rows)) return null;
  const host = String(hostname || "").trim().toLowerCase();
  const display = String(displayName || "").trim().toLowerCase();
  let best = null;
  for (const row of rows) {
    if (supportMeshRow(row)) continue;
    const names = [row?.name, row?.rname, row?.host]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    let score = 0;
    if (host && names.includes(host)) score = 2;
    else if (display && display !== host && names.includes(display)) score = 1;
    if (!score || !row?._id) continue;
    const hostnameMatch = score >= 2;
    if ((Number(row.conn) || 0) & 1) score += 2;
    if (!best || score > best.score) {
      best = {
        score,
        hostnameMatch,
        id: String(row._id),
        group: String(row.groupname || ""),
        online: ((Number(row.conn) || 0) & 1) === 1,
      };
    }
  }
  return best;
}

const MESH_STAGING_GROUP = "Digital Fingers";
const MESH_TENANT_CONSENT = 71;
const MESH_SITE_RIGHTS = "nonewgroups,locksettings,nonewdevices";
// Group rights set through scripts/mesh-group-rights.cjs, since meshctrl has no flag for remote
// commands (0x20000). Admins: manage devices, remote control, agent console, wake, notes, chat
// notify and remote commands, which the session window needs for Display Resolution and the launch
// tools. Technicians: remote control and chat notify only, with no terminal, files, registry,
// software, AMT or full event log.
const MESH_GROUP_RIGHT_BITS = {
  admin: 4 | 8 | 16 | 64 | 128 | 16384 | 0x20000,
  tech: 8 | 16384 | 512 | 1024 | 4194304 | 8388608 | 2048 | 8192,
};
const MESH_RIGHTS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "mesh-group-rights.cjs");

function linkMeshLogin(groupId, userName, role) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/node", [MESH_RIGHTS_SCRIPT, groupId, `user//${userName}`, String(MESH_GROUP_RIGHT_BITS[role])], {
      env: { MESH_URL: process.env.MESH_URL || "", MESH_USER: process.env.MESH_USER || "", MESH_PASSWORD: process.env.MESH_PASSWORD || "" },
    });
    const out = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

function meshOk(text) {
  return /(^|\n)\s*ok\b/i.test(String(text || ""));
}

function meshLinked(text) {
  return /Added user /.test(String(text || ""));
}

async function ensureTenantMesh(orgId) {
  const load = async () => (await pool.query("SELECT id, name, slug, mesh_group_id, mesh_users FROM orgs WHERE id = $1", [orgId])).rows[0];
  let org = await load();
  if (!org) throw Object.assign(new Error("Organisation not found."), { status: 404 });
  if (org.mesh_group_id && org.mesh_users?.admin && org.mesh_users?.tech) return org;
  const lock = `mesh-tenant-lock:${orgId}`;
  if ((await redis.set(lock, "1", "EX", 120, "NX")) !== "OK") {
    throw Object.assign(new Error("The remote service is being prepared for this organisation. Try again in a moment."), { status: 503 });
  }
  try {
    org = await load();
    let groupId = org.mesh_group_id;
    if (!groupId) {
      const text = await meshControl([
        "AddDeviceGroup", "--name", `${org.name} - Managed`, "--desc", `Digital Fingers tenant ${org.id}`,
        "--consent", String(MESH_TENANT_CONSENT),
      ]);
      groupId = (text.match(/mesh\/\/[A-Za-z0-9@$_-]+/) || [""])[0];
      if (!groupId) throw Object.assign(new Error("The remote service did not create the device group."), { status: 502 });
      await pool.query("UPDATE orgs SET mesh_group_id = $2 WHERE id = $1", [org.id, groupId]);
    }
    const users = { ...(org.mesh_users || {}) };
    for (const role of ["admin", "tech"]) {
      if (users[role]) continue;
      const name = `df-t${org.id}-${role}-${randomBytes(3).toString("hex")}`;
      const pass = randomBytes(24).toString("base64url");
      const added = await meshControl([
        "AddUser", "--user", name, "--pass", pass,
        "--realname", `${org.name} ${role === "admin" ? "admin" : "technician"}`, "--rights", MESH_SITE_RIGHTS,
      ]);
      if (!meshOk(added)) throw Object.assign(new Error("The remote service did not create the tenant login."), { status: 502 });
      const linked = await linkMeshLogin(groupId, name, role);
      if (!meshLinked(linked)) throw Object.assign(new Error("The remote service did not give the tenant login its rights."), { status: 502 });
      users[role] = { user: name, pass: sealSecret(pass) };
      await pool.query("UPDATE orgs SET mesh_users = $2::jsonb WHERE id = $1", [org.id, JSON.stringify(users)]);
    }
    return { ...org, mesh_group_id: groupId, mesh_users: users };
  } finally {
    await redis.del(lock);
  }
}

function tenantMeshCreds(org, role) {
  const entry = org.mesh_users?.[role];
  if (!entry) throw Object.assign(new Error("The remote service is not ready for this organisation."), { status: 503 });
  return { user: entry.user, pass: openSecret(entry.pass) };
}

async function tenantDesktopUrl(orgId, actor, nodeId, tokenName, osName) {
  const org = await ensureTenantMesh(orgId);
  return meshDesktopUrl(nodeId, tokenName, osName, tenantMeshCreds(org, canOperate(actor) ? "admin" : "tech"));
}

async function shareSupportGroup(orgId, groupId) {
  const org = await ensureTenantMesh(orgId);
  for (const role of ["admin", "tech"]) {
    const linked = await linkMeshLogin(groupId, org.mesh_users[role].user, role);
    if (!meshLinked(linked)) throw Object.assign(new Error("The remote service did not share the support session."), { status: 502 });
  }
}

function meshNames(node) {
  return [node?.name, node?.rname, node?.host].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

async function bindMeshNode(row, org, listed) {
  const nodes = Array.isArray(listed) ? listed : [];
  const online = (node) => ((Number(node?.conn) || 0) & 1) === 1;
  const view = (node) => ({ nodeId: String(node._id), online: online(node), group: String(node.groupname || "") });
  const bound = row.mesh_node_id ? nodes.find((node) => String(node?._id) === row.mesh_node_id) : null;
  if (bound && bound.meshid === org.mesh_group_id) {
    if (online(bound)) return view(bound);
    const replaced = await rebindReinstalledNode(row, org, nodes);
    return replaced || view(bound);
  }
  const own = nodes.filter((node) => node?.meshid === org.mesh_group_id);
  const ownMatch = meshNodeMatch(own, row.hostname, row.display_name);
  if (ownMatch?.hostnameMatch) {
    await pool.query("UPDATE devices SET mesh_node_id = $1 WHERE id = $2", [ownMatch.id, row.id]);
    return { nodeId: ownMatch.id, online: ownMatch.online, group: ownMatch.group };
  }
  let candidate = null;
  let legacy = false;
  if (bound && bound.groupname === MESH_STAGING_GROUP) {
    candidate = bound;
    legacy = true;
  } else {
    const host = String(row.hostname || "").trim().toLowerCase();
    const hits = host ? nodes.filter((node) => node?.groupname === MESH_STAGING_GROUP && meshNames(node).includes(host)) : [];
    if (hits.length === 1) candidate = hits[0];
  }
  if (!candidate) return { nodeId: "", online: null, group: "" };
  const nodeId = String(candidate._id);
  const claims = await pool.query(
    legacy
      ? "SELECT id FROM devices WHERE id <> $1 AND mesh_node_id = $2"
      : `SELECT id FROM devices WHERE id <> $1
           AND (mesh_node_id = $2 OR (lower(hostname) = lower($3) AND COALESCE(mesh_node_id, '') = ''))`,
    legacy ? [row.id, nodeId] : [row.id, nodeId, row.hostname],
  );
  if (claims.rows.length) return { nodeId: "", online: null, group: "" };
  const moved = await meshControl(["MoveToDeviceGroup", "--devid", nodeId, "--id", org.mesh_group_id]);
  if (!meshOk(moved)) return { nodeId: "", online: null, group: "" };
  await pool.query("UPDATE devices SET mesh_node_id = $1 WHERE id = $2", [nodeId, row.id]);
  await writeAudit(org.id, null, "device.mesh_bind", "device", String(row.id), { hostname: row.hostname, legacy });
  return { nodeId, online: online(candidate), group: `${org.name} - Managed` };
}

// A reinstalled Mesh agent comes back as a new node in the shared group while the old one sits offline.
async function rebindReinstalledNode(row, org, nodes) {
  const host = String(row.hostname || "").trim().toLowerCase();
  if (!host) return null;
  const hits = nodes.filter((node) => node?.groupname === MESH_STAGING_GROUP
    && ((Number(node.conn) || 0) & 1) === 1 && meshNames(node).includes(host));
  if (hits.length !== 1) return null;
  const nodeId = String(hits[0]._id);
  const others = await pool.query(
    "SELECT id FROM devices WHERE id <> $1 AND (mesh_node_id = $2 OR lower(hostname) = lower($3))",
    [row.id, nodeId, row.hostname],
  );
  if (others.rows.length) return null;
  const moved = await meshControl(["MoveToDeviceGroup", "--devid", nodeId, "--id", org.mesh_group_id]);
  if (!meshOk(moved)) return null;
  await pool.query("UPDATE devices SET mesh_node_id = $1 WHERE id = $2", [nodeId, row.id]);
  await writeAudit(org.id, null, "device.mesh_bind", "device", String(row.id), { hostname: row.hostname, reinstalled: true });
  return { nodeId, online: true, group: `${org.name} - Managed` };
}

async function resolveMeshNode(row, orgId) {
  const org = await ensureTenantMesh(orgId);
  const listed = meshJson(await meshControl(["ListDevices", "--json"]));
  return bindMeshNode(row, org, listed);
}

let meshIsolateRunning = false;

async function isolateTenantMesh() {
  if (meshIsolateRunning) return;
  meshIsolateRunning = true;
  try {
    const orgs = await pool.query("SELECT DISTINCT org_id FROM devices");
    if (!orgs.rows.length) return;
    const listed = meshJson(await meshControl(["ListDevices", "--json"]));
    if (!Array.isArray(listed)) return;
    for (const { org_id: orgId } of orgs.rows) {
      try {
        const org = await ensureTenantMesh(orgId);
        const devices = await pool.query("SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE org_id = $1", [orgId]);
        for (const row of devices.rows) await bindMeshNode(row, org, listed);
      } catch (error) {
        console.error(`mesh isolate org ${orgId}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`mesh isolate: ${error.message}`);
  } finally {
    meshIsolateRunning = false;
  }
}

function meshSoftware(nodeId) {
  return meshScript("mesh-software.cjs", [nodeId]);
}

function meshQuery(nodeId, kind, extra) {
  const args = [nodeId, kind];
  if (extra) args.push(String(extra));
  return meshScript("mesh-query.cjs", args);
}

function meshStartupSet(nodeId, hive, path, name, enabled) {
  return meshScript("mesh-query.cjs", [nodeId, "startup-set", hive, path, name, enabled ? "1" : "0"]);
}

function meshServiceSet(nodeId, action, name) {
  return meshScript("mesh-query.cjs", [nodeId, "service-set", action, name]);
}

function meshRename(nodeId, name) {
  return meshScript("mesh-query.cjs", [nodeId, "rename", name]);
}

async function meshSessionList() {
  const result = meshJson(await meshScript("mesh-sessions.cjs", ["list"], 35000));
  if (!result || result.error) {
    throw Object.assign(new Error(result?.error || "Remote service did not answer."), { status: 502 });
  }
  return result.sessions || {};
}

async function meshSessionsEnd(nodeId) {
  const result = meshJson(await meshScript("mesh-sessions.cjs", ["end", nodeId], 35000));
  if (!result || result.error) {
    throw Object.assign(new Error(result?.error || "Remote service did not answer."), { status: 502 });
  }
  return result;
}

async function meshAgentRestart(nodeId) {
  const result = meshJson(await meshScript("mesh-sessions.cjs", ["restart", nodeId], 90000));
  if (!result || result.error) {
    throw Object.assign(new Error(result?.error || "Remote service did not answer."), { status: 502 });
  }
  return result;
}

function meshFiles(nodeId, action, filePath, name, localFile) {
  const args = [nodeId, action, filePath];
  if (name) args.push(name);
  if (localFile) args.push(localFile);
  return meshScript("mesh-files.cjs", args, action === "upload" ? 120000 : 50000);
}

function meshFilesUpload(nodeId, filePath, name, localFile, onProgress) {
  const script = fileURLToPath(new URL("../mesh-files.cjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/node", [script, nodeId, "upload", filePath, name, localFile], { cwd: "/opt/df-api" });
    const out = [];
    let pending = "";
    let settled = false;
    const started = Date.now();
    let timer = null;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };
    const arm = () => {
      clearTimeout(timer);
      const remain = UPLOAD_MS - (Date.now() - started);
      if (remain <= 0) {
        child.kill("SIGKILL");
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
      }, Math.min(3 * 60 * 1000, remain));
    };
    arm();
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      let split = pending.indexOf("\n");
      while (split >= 0) {
        const line = pending.slice(0, split);
        pending = pending.slice(split + 1);
        const match = /^P (\d+) (\d+)$/.exec(line);
        if (match) {
          arm();
          onProgress(Number(match[1]), Number(match[2]));
        }
        split = pending.indexOf("\n");
      }
    });
    child.on("error", (error) => finish(false, error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      finish(true, Buffer.concat(out).toString("utf8"));
    });
  });
}

function meshFilesDownload(nodeId, filePath, name, kind, localFile, size, onEvent) {
  const script = fileURLToPath(new URL("../mesh-files.cjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/node", [script, nodeId, "download", filePath, name, kind, localFile, String(size || 0)], { cwd: "/opt/df-api" });
    const out = [];
    let pending = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error("Remote service did not answer."), { status: 502 }));
    }, 20 * 60 * 1000 + 15000);
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      let split = pending.indexOf("\n");
      while (split >= 0) {
        const line = pending.slice(0, split);
        pending = pending.slice(split + 1);
        if (line.startsWith("S ")) onEvent({ status: line.slice(2) });
        const zip = /^Z (\d+)$/.exec(line);
        if (zip) onEvent({ status: "Zipping", progress: Number(zip[1]) });
        const match = /^P (\d+) (\d+)$/.exec(line);
        if (match) onEvent({ status: "Downloading", acked: Number(match[1]), size: Number(match[2]) });
        split = pending.indexOf("\n");
      }
    });
    child.on("error", (error) => finish(false, error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      finish(true, Buffer.concat(out).toString("utf8"));
    });
  });
}

function safeFileName(name) {
  const value = String(name || "");
  if (!value || value.length > 120 || value === "." || value === ".." || /[\\/\0:*?"<>|]/.test(value)) return "";
  return value;
}

async function listFolderFiles(nodeId, folderPath, folderName) {
  const files = [];
  const dirs = [];
  let total = 0;
  const pending = [{ path: `${folderPath}/${folderName}`, relative: folderName }];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (seen.has(current.path) || current.relative.split("/").length > 12) {
      throw Object.assign(new Error("That folder could not be packed."), { status: 400 });
    }
    seen.add(current.path);
    dirs.push(current.relative);
    const listed = meshJson(await meshFiles(nodeId, "ls", current.path));
    if (!listed || listed.error) throw Object.assign(new Error(listed?.error || "That folder is not available."), { status: 502 });
    for (const entry of listed.entries || []) {
      const name = safeFileName(entry.name);
      if (!name) continue;
      if (entry.kind === "folder") pending.push({ path: `${current.path}/${name}`, relative: `${current.relative}/${name}` });
      else if (entry.kind === "file") {
        const size = Number(entry.size) || 0;
        total += size;
        if (total > DOWNLOAD_LIMIT || files.length >= 2000) {
          throw Object.assign(new Error("That folder is larger than 256 MB."), { status: 413 });
        }
        files.push({ path: current.path, name, relative: `${current.relative}/${name}`, size });
      }
    }
  }
  return { files, dirs, total };
}

function writeZip(tree, folderName, zipPath) {
  const script = [
    "import sys, zipfile",
    "from pathlib import Path",
    "root = Path(sys.argv[1])",
    "with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as archive:",
    "    wrote = False",
    "    if root.exists():",
    "        for path in sorted(root.rglob('*')):",
    "            rel = path.relative_to(root).as_posix()",
    "            if path.is_dir(): archive.writestr(rel + '/', b'')",
    "            else: archive.write(path, rel)",
    "            wrote = True",
    "    if not wrote: archive.writestr(sys.argv[3].replace('\\\\', '/') + '/', b'')",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", script, tree, zipPath, folderName]);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(Object.assign(new Error("That folder could not be packed."), { status: 502 }));
    }, 60000);
    child.on("error", () => finish(Object.assign(new Error("That folder could not be packed."), { status: 502 })));
    child.on("close", (code) => finish(code === 0 ? null : Object.assign(new Error("That folder could not be packed."), { status: 502 })));
  });
}

async function downloadFolderArchive(nodeId, folderPath, folderName, zipPath, onEvent) {
  const { files, dirs, total } = await listFolderFiles(nodeId, folderPath, folderName);
  onEvent({ status: "Downloading", acked: 0, size: total });
  const tree = join(dirname(zipPath), "tree");
  for (const dir of dirs) await mkdir(join(tree, ...dir.split("/")), { recursive: true });
  let done = 0;
  for (const file of files) {
    const dest = join(tree, ...file.relative.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    const result = meshJson(await meshFilesDownload(nodeId, file.path, file.name, "file", dest, file.size, (event) => {
      if (event.status === "Downloading" && typeof event.acked === "number") {
        onEvent({ status: "Downloading", acked: Math.min(total, done + event.acked), size: total });
      }
    }));
    if (!result?.ok) throw Object.assign(new Error(result?.error || "The file was not downloaded."), { status: 502 });
    done += file.size;
    onEvent({ status: "Downloading", acked: Math.min(total, done), size: total });
  }
  onEvent({ status: "Packing" });
  await writeZip(tree, folderName, zipPath);
  const info = await stat(zipPath);
  return { ok: true, bytes: info.size };
}

const terminalSessions = new Map();

function shellProtocol(osName, shell, runAs) {
  const windows = /windows/i.test(osName || "");
  const asSystem = runAs === "system";
  if (shell === "powershell") return windows ? (asSystem ? 6 : 9) : null;
  return asSystem ? 1 : 8;
}

function openMeshTerminal(nodeId, protocol, cols, rows) {
  const script = fileURLToPath(new URL("../mesh-terminal.cjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/node", [script, nodeId, String(protocol), String(cols), String(rows)], {
      cwd: "/opt/df-api",
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    const session = { child, buffer: [], res: null, closed: false };
    let pending = "";
    let ready = false;
    const finish = (error) => {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(session);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("MeshCentral did not answer."), { status: 502 })), 25000);
    child.stderr.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      let split = pending.indexOf("\n");
      while (split >= 0) {
        const line = pending.slice(0, split);
        pending = pending.slice(split + 1);
        if (line === "READY") finish(null);
        else if (line.startsWith("ERR ")) finish(Object.assign(new Error(line.slice(4) || "MeshCentral did not answer."), { status: 502 }));
        split = pending.indexOf("\n");
      }
    });
    child.stdout.on("data", (chunk) => {
      if (session.res && !session.res.writableEnded) session.res.write(chunk);
      else session.buffer.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", () => {
      session.closed = true;
      if (session.res && !session.res.writableEnded) session.res.end();
      finish(Object.assign(new Error("The shell stopped."), { status: 502 }));
    });
    child.stdio[3].on("error", () => {});
  });
}

function closeTerminal(ticket) {
  const session = terminalSessions.get(ticket);
  if (!session) return;
  terminalSessions.delete(ticket);
  clearTimeout(session.timer);
  try { session.child.kill("SIGKILL"); } catch { /* already gone */ }
  if (session.res && !session.res.writableEnded) session.res.end();
}

function rememberDownload(orgId, deviceId, dir, filePath, downloadName) {
  const ticket = randomBytes(18).toString("hex");
  const timer = setTimeout(() => {
    const item = downloadTickets.get(ticket);
    downloadTickets.delete(ticket);
    if (item) rm(item.dir, { recursive: true, force: true }).catch(() => {});
  }, 120000);
  timer.unref?.();
  downloadTickets.set(ticket, { orgId: String(orgId), deviceId: String(deviceId), dir, filePath, downloadName, timer });
  return ticket;
}

function downloadDisposition(name) {
  const clean = String(name || "download").replace(/[\r\n"]/g, "");
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function meshScript(file, args, timeoutMs = 50000) {
  const script = fileURLToPath(new URL(`../${file}`, import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/node", [script, ...args], { cwd: "/opt/df-api" });
    const out = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error("Remote service did not answer."), { status: 502 }));
    }, timeoutMs);
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(false, error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(false, Object.assign(new Error("Remote service did not answer."), { status: 502 }));
        return;
      }
      finish(true, Buffer.concat(out).toString("utf8"));
    });
  });
}

function installDateLabel(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return text;
  const when = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(when.getTime())) return text;
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", dateStyle: "medium" }).format(when);
}

function softwareSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(2)} GB`;
  if (number >= 1024) return `${(number / 1024).toFixed(2)} MB`;
  return `${Math.round(number)} KB`;
}

function softwareRows(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const apps = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.name || "").trim();
    if (!name) continue;
    apps.push({
      name: name.slice(0, 200),
      version: String(item.version || "").trim().slice(0, 80),
      vendor: String(item.publisher || item.vendor || "").trim().slice(0, 160),
      installed: installDateLabel(item.date),
      location: String(item.location || "").trim().slice(0, 300),
      size: softwareSize(item.size ?? item.estimatedSize),
    });
    if (apps.length >= 4000) break;
  }
  apps.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return apps;
}

function softwareNote(error) {
  const text = String(error || "");
  if (/offline/i.test(text)) return "The Mesh agent is offline, so installed software cannot be read.";
  if (/denied/i.test(text)) return "MeshCentral did not allow the software list.";
  if (/not supported/i.test(text)) return "MeshCentral does not list installed software for this operating system.";
  return "MeshCentral did not return the software list.";
}

const DIAGNOSTIC_KINDS = {
  events: "events",
  accounts: "users",
  printers: "printers",
  groups: "groups",
  shares: "shares",
  tasks: "processes",
  startup: "startup",
  services: "services",
};

const PROTECTED_PROCESSES = new Set([
  "system",
  "idle",
  "registry",
  "[system process]",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "winlogon.exe",
  "meshagent.exe",
  "meshagent",
]);

function recordField(item, name) {
  if (!item || typeof item !== "object") return "";
  if (item[name] != null && item[name] !== "") return item[name];
  const key = Object.keys(item).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key == null || item[key] == null ? "" : item[key];
}

function processLabel(item) {
  const raw = String(recordField(item, "cmd") || recordField(item, "name") || recordField(item, "path") || "").trim();
  if (!raw) return "";
  if (!/[\\/]/.test(raw)) return raw.slice(0, 180);
  const token = raw.split(/\s+/)[0];
  return (token.split(/[/\\]/).filter(Boolean).pop() || raw).slice(0, 180);
}

function protectedProcess(name) {
  return PROTECTED_PROCESSES.has(String(name || "").trim().toLowerCase());
}

function processEntries(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, "processes")
    ? raw.processes
    : raw;
  if (Array.isArray(source)) return source.map((item, index) => [String(recordField(item, "pid") || index), item]);
  if (source && typeof source === "object") return Object.entries(source);
  return [];
}

function perfByPid(raw) {
  const map = new Map();
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (String(recordField(item, "Name") || "") === "_Total") continue;
    const pid = String(recordField(item, "IDProcess") || "").trim();
    if (pid) map.set(pid, item);
  }
  return map;
}

function cpuLabel(value) {
  const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) return { text: "—", value: null };
  return { text: `${number.toFixed(2)}%`, value: number };
}

function memoryLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return { text: "—", value: null };
  return { text: `${(number / (1024 * 1024)).toFixed(2)} MB`, value: number };
}

const STARTUP_SWITCH = /^(?:S-1-5-[0-9-]+\\)?SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\(?:Run|Run32|StartupFolder)$/;

function startupAccount(user) {
  return String(user || "").trim().split("\\").pop().toLowerCase();
}

function startupSwitch(item, users) {
  const name = String(recordField(item, "Name") || "").trim();
  const location = String(recordField(item, "Location") || "").trim();
  const command = String(recordField(item, "Command") || "").trim();
  const user = String(recordField(item, "User") || "").trim();
  const base = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\";
  const file = (command || name).split(/[/\\]/).filter(Boolean).pop() || name;
  if (!name || /[\\/\u0000-\u001f]/.test(name) || /[\\/\u0000-\u001f]/.test(file)) return null;
  if (/^HKLM\\/i.test(location) && /\\Run$/i.test(location)) {
    const leaf = /Wow6432Node/i.test(location) ? "Run32" : "Run";
    return { hive: "HKLM", path: base + leaf, value: name };
  }
  const sid = location.match(/^HKU\\(S-1-5-[^\\]+)\\/i);
  if (sid && /\\Run$/i.test(location)) {
    const leaf = /Wow6432Node/i.test(location) ? "Run32" : "Run";
    return { hive: "HKU", path: `${sid[1]}\\${base}${leaf}`, value: name };
  }
  if (!/startup/i.test(location)) return null;
  if (/common/i.test(location) || /programdata/i.test(command) || /^public$/i.test(user)) {
    return { hive: "HKLM", path: `${base}StartupFolder`, value: file };
  }
  const profile = users && /^S-1-5-[0-9-]+$/.test(String(users[startupAccount(user)] || "")) ? users[startupAccount(user)] : "";
  if (!profile) return null;
  return { hive: "HKU", path: `${profile}\\${base}StartupFolder`, value: file };
}

function startupEnabled(approved, target) {
  if (!target) return true;
  const key = `${target.hive}|${target.path}|${target.value}`;
  const byte = Number(approved?.[key]);
  if (!Number.isFinite(byte)) return true;
  return (byte & 1) === 0;
}

function diagnosticNote(error) {
  const text = String(error || "");
  if (/offline/i.test(text)) return "The Mesh agent is offline, so this list cannot be read.";
  if (/denied/i.test(text)) return "MeshCentral did not allow this list.";
  if (/unknown command|not supported/i.test(text)) return "MeshCentral does not provide this list for this operating system.";
  return "MeshCentral did not return this list.";
}

function byteLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "—";
  if (number === 0) return "0 B";
  if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(2)} GB`;
  if (number >= 1024 ** 2) return `${(number / 1024 ** 2).toFixed(2)} MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(2)} KB`;
  return `${Math.round(number)} B`;
}

function cell(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

const SERVICE_ACTIONS = new Set(["stop", "start", "restart", "pause", "resume", "manual", "auto", "disabled"]);

function serviceState(status) {
  if (status && typeof status === "object") return String(status.state || "").toUpperCase();
  return String(status || "").toUpperCase();
}

function serviceStatusLabel(state) {
  const labels = {
    RUNNING: "Running",
    STOPPED: "Stopped",
    PAUSED: "Paused",
    START_PENDING: "Start Pending",
    STOP_PENDING: "Stop Pending",
    CONTINUE_PENDING: "Continue Pending",
    PAUSE_PENDING: "Pause Pending",
  };
  if (labels[state]) return labels[state];
  if (!state) return "—";
  const lower = state.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function serviceStartLabel(mode) {
  const text = String(mode || "").trim();
  if (/^auto$/i.test(text)) return "Automatic";
  if (/^manual$/i.test(text)) return "Manual";
  if (/^disabled$/i.test(text)) return "Disabled";
  return text || "—";
}

function serviceAccount(value) {
  const text = String(value || "").trim();
  if (/^localsystem$/i.test(text)) return "Local System";
  if (/localservice$/i.test(text)) return "Local Service";
  if (/networkservice$/i.test(text)) return "Network Service";
  return text || "—";
}

function serviceProtected(name, display) {
  const text = `${name || ""} ${display || ""}`.toLowerCase();
  if (/mesh\s*agent/.test(text)) return true;
  return ["rpcss", "dcomlaunch", "samss"].includes(String(name || "").toLowerCase());
}

function serviceRows(raw) {
  const services = Array.isArray(raw) ? raw : Object.values(raw || {});
  return services
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const service = String(item.name || "").trim();
      const name = String(item.displayName || item.name || "").trim();
      if (!service || !name) return null;
      const status = item.status;
      const state = serviceState(status);
      const accepted = status && typeof status === "object" && Array.isArray(status.controlsAccepted) ? status.controlsAccepted : [];
      const pid = Number(status && typeof status === "object" ? status.pid : 0);
      const pidValue = Number.isFinite(pid) && pid > 0 ? pid : 0;
      const description = String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 400);
      const protectedService = serviceProtected(service, name);
      return {
        name: name.slice(0, 180),
        service,
        status: serviceStatusLabel(state),
        statusValue: state === "RUNNING" ? 2 : state === "PAUSED" ? 1 : 0,
        start: serviceStartLabel(item.startMode),
        pid: pidValue ? String(pidValue) : "—",
        pidValue: pidValue || null,
        description: description || "—",
        account: serviceAccount(item.startName),
        location: item.startMode || item.startName ? `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${service}` : "—",
        canStart: !protectedService && state === "STOPPED",
        canStop: !protectedService && accepted.includes("SERVICE_CONTROL_STOP"),
        canPause: !protectedService && state === "RUNNING" && accepted.includes("SERVICE_CONTROL_PAUSE"),
        canResume: !protectedService && (state === "PAUSED" || state === "PAUSE_PENDING") && accepted.includes("SERVICE_CONTROL_CONTINUE"),
        canRestart: !protectedService,
        canConfigure: !protectedService,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .slice(0, 2000);
}

function diagnosticTable(tool, raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw) : [];
  if (tool === "events") {
    const order = ["application", "security", "setup", "system", "forwardedevents"];
    const rows = list
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: cell(item.LogfileName || item.LogFileName),
        type: "Administrative",
        total: item.NumberOfRecords == null ? "—" : String(item.NumberOfRecords),
        size: byteLabel(item.FileSize),
      }))
      .sort((a, b) => {
        const left = order.indexOf(a.name.toLowerCase().replace(/\s/g, ""));
        const right = order.indexOf(b.name.toLowerCase().replace(/\s/g, ""));
        if (left === -1 && right === -1) return a.name.localeCompare(b.name, "en");
        if (left === -1) return 1;
        if (right === -1) return -1;
        return left - right;
      });
    return {
      columns: [
        { key: "name", label: "Display Name" },
        { key: "type", label: "Node Type" },
        { key: "total", label: "Total Events" },
        { key: "size", label: "Size" },
      ],
      rows,
    };
  }
  if (tool === "accounts") {
    const rows = list
      .filter((item) => item && typeof item === "object" && item.Name)
      .map((item) => ({
        name: cell(item.Name),
        full: cell(item.FullName),
        status: item.Disabled === true || String(item.Disabled).toLowerCase() === "true" ? "Disabled" : cell(item.Status || "OK"),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    return {
      columns: [
        { key: "name", label: "Name" },
        { key: "full", label: "Full name" },
        { key: "status", label: "Status" },
      ],
      rows,
    };
  }
  if (tool === "groups") {
    const rows = list
      .filter((item) => item && typeof item === "object" && item.Name)
      .map((item) => ({ name: cell(item.Name), description: cell(item.Description) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    return {
      columns: [
        { key: "name", label: "Name" },
        { key: "description", label: "Description" },
      ],
      rows,
    };
  }
  if (tool === "shares") {
    const rows = list
      .filter((item) => item && typeof item === "object" && item.Name)
      .map((item) => ({ name: cell(item.Name), path: cell(item.Path), description: cell(item.Description) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    return {
      columns: [
        { key: "name", label: "Name" },
        { key: "path", label: "Path" },
        { key: "description", label: "Description" },
      ],
      rows,
    };
  }
  if (tool === "printers") {
    const status = { 1: "Other", 2: "Unknown", 3: "Idle", 4: "Printing", 5: "Warmup", 6: "Stopped", 7: "Offline" };
    const rows = list
      .filter((item) => item && typeof item === "object" && item.Name)
      .map((item) => ({
        name: cell(item.Name),
        port: cell(item.PortName),
        status: status[Number(item.PrinterStatus)] || cell(item.PrinterStatus),
        default: item.Default === true || String(item.Default).toLowerCase() === "true" ? "Yes" : "No",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    return {
      columns: [
        { key: "name", label: "Name" },
        { key: "port", label: "Port" },
        { key: "status", label: "Status" },
        { key: "default", label: "Default" },
      ],
      rows,
    };
  }
  if (tool === "tasks") {
    const usage = perfByPid(raw && raw.perf);
    const rows = processEntries(raw)
      .map(([pid, item]) => {
        if (!item || typeof item !== "object") return null;
        const id = String(recordField(item, "pid") || pid).trim();
        const name = processLabel(item);
        if (!name || !/^\d+$/.test(id)) return null;
        const sample = usage.get(id);
        const cpu = cpuLabel(sample ? recordField(sample, "PercentProcessorTime") : "");
        const memory = memoryLabel(sample ? recordField(sample, "WorkingSet") : "");
        return {
          name,
          pid: id,
          status: "Running",
          user: cell(recordField(item, "user")),
          cpu: cpu.text,
          memory: memory.text,
          pidValue: Number(id),
          cpuValue: cpu.value,
          memValue: memory.value,
          command: String(recordField(item, "cmd") || recordField(item, "path") || name).trim().slice(0, 400),
          endable: !protectedProcess(name),
        };
      })
      .filter(Boolean)
      .slice(0, 2000);
    return {
      columns: [
        { key: "name", label: "Process Name" },
        { key: "pid", label: "PID" },
        { key: "status", label: "Status" },
        { key: "user", label: "User Name" },
        { key: "cpu", label: "CPU" },
        { key: "memory", label: "Memory" },
      ],
      rows,
    };
  }
  if (tool === "startup") {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) && raw.items ? raw.items : raw;
    const approved = raw && typeof raw === "object" && !Array.isArray(raw) && raw.approved ? raw.approved : {};
    const users = raw && typeof raw === "object" && !Array.isArray(raw) && raw.users ? raw.users : {};
    const items = Array.isArray(source)
      ? source
      : source && typeof source === "object"
        ? (recordField(source, "Name") ? [source] : Object.values(source).filter((item) => item && typeof item === "object"))
        : [];
    const rows = items
      .map((item) => {
        const name = String(recordField(item, "Name") || "").trim().slice(0, 180);
        if (!name) return null;
        const locationRaw = String(recordField(item, "Location") || "").trim();
        const command = String(recordField(item, "Command") || "").trim();
        const registry = /^HK/i.test(locationRaw);
        const location = registry || /[\\/]/.test(locationRaw)
          ? locationRaw
          : (/[\\/]/.test(command) ? command : (locationRaw && command ? `${locationRaw}\\${command}` : (command || locationRaw)));
        const target = startupSwitch(item, users);
        const enabled = startupEnabled(approved, target);
        const allowed = Boolean(target && STARTUP_SWITCH.test(target.path));
        return {
          name,
          type: registry ? "Registry" : "Folder",
          location: cell(location).slice(0, 400),
          locationRaw: locationRaw.slice(0, 400),
          user: cell(recordField(item, "User")),
          status: enabled ? "On" : "Off",
          enabled,
          enabledValue: enabled ? 1 : 0,
          canToggle: allowed,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .slice(0, 500);
    return {
      columns: [
        { key: "name", label: "Name" },
        { key: "type", label: "Startup Type" },
        { key: "location", label: "Location" },
        { key: "user", label: "User" },
        { key: "status", label: "Status" },
      ],
      rows,
      warning: raw && raw.approvedError ? String(raw.approvedError).slice(0, 180) : "",
    };
  }
  if (tool === "services") {
    return {
      columns: [
        { key: "name", label: "Display Name" },
        { key: "status", label: "Status" },
        { key: "start", label: "Startup Type" },
        { key: "pid", label: "PID" },
        { key: "description", label: "Description" },
        { key: "account", label: "Log On As" },
        { key: "location", label: "Location" },
      ],
      rows: serviceRows(raw),
    };
  }
  return { columns: [], rows: [] };
}

function detailLine(label, value) {
  const text = value == null ? "" : String(value).trim();
  return { label, value: text || "—" };
}

function seenLabel(value) {
  if (!value) return "—";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(when);
}

function platformFrom(version, osName) {
  const text = `${version || ""} ${osName || ""}`;
  if (/windows/i.test(text)) return "Windows";
  if (/linux|ubuntu|debian/i.test(text)) return "Linux";
  if (/mac/i.test(text)) return "macOS";
  return "";
}

function gpuNames(board) {
  const names = [];
  for (const [key, value] of Object.entries(board || {})) {
    if (/^GPU\d+$/.test(key) && value) names.push(String(value).trim());
  }
  return names.filter(Boolean).join(", ");
}

function memoryTotal(memory) {
  let totalMb = 0;
  let found = false;
  for (const bank of Object.values(memory || {})) {
    if (!bank || typeof bank !== "object") continue;
    const text = String(bank["Capacity/Speed"] || bank.Capacity || "");
    const match = text.match(/(\d+(?:\.\d+)?)\s*Mb/i);
    if (!match) continue;
    totalMb += Number(match[1]);
    found = true;
  }
  if (!found || !Number.isFinite(totalMb)) return "";
  if (totalMb >= 1024) return `${(totalMb / 1024).toFixed(2)} GB`;
  return `${Math.round(totalMb)} MB`;
}

function isLanAddress(ip) {
  const parts = String(ip || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

function layerPart(text, label) {
  const match = String(text || "").match(new RegExp(`${label}:\\s*([^,]+)`, "i"));
  return match ? match[1].trim() : "";
}

function networkCards(networking) {
  const cards = [];
  for (const [name, iface] of Object.entries(networking || {})) {
    if (!iface || typeof iface !== "object" || Array.isArray(iface)) continue;
    const macText = String(iface["MAC Layer"] || "");
    const v4Text = String(iface["IPv4 Layer"] || "");
    const v6Text = String(iface["IPv6 Layer"] || "");
    cards.push({
      name,
      mac: macText.match(/MAC:\s*([0-9A-Fa-f:]{11,17})/)?.[1] || "",
      ip: layerPart(v4Text, "IP"),
      mask: layerPart(v4Text, "Mask"),
      gateway: layerPart(v4Text, "Gateway"),
      v6: layerPart(v6Text, "IP"),
    });
  }
  return cards;
}

function adapterDetails(card) {
  return [
    detailLine("IP Address", card.ip),
    detailLine("IPv6 Address", card.v6),
    detailLine("MAC Address", card.mac),
    detailLine("Gateway", card.gateway),
    detailLine("Subnet Mask", card.mask),
  ].filter((row) => row.value !== "—");
}

function utcOffsetLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "+";
  const abs = Math.abs(Math.trunc(value));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (mins === 0) return `UTC${sign}${hours}`;
  return `UTC${sign}${hours}:${String(mins).padStart(2, "0")}`;
}

function wmiTimeLabel(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const when = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(when.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(when);
}

function osClock(raw) {
  const osinfo = raw?.hardware?.windows?.osinfo || raw?.result?.hardware?.windows?.osinfo || {};
  const bootOffset = String(osinfo.LastBootUpTime || "").match(/([+-]\d+)$/)?.[1];
  const minutes = osinfo.CurrentTimeZone == null || osinfo.CurrentTimeZone === ""
    ? (bootOffset == null ? null : Number(bootOffset))
    : Number(osinfo.CurrentTimeZone);
  return {
    timeZone: utcOffsetLabel(minutes),
    lastBoot: wmiTimeLabel(osinfo.LastBootUpTime),
    productId: String(osinfo.SerialNumber || "").trim(),
  };
}

function flattenBanks(block, prefix) {
  const rows = [];
  for (const [name, value] of Object.entries(block || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [label, inner] of Object.entries(value)) {
        if (inner && typeof inner === "object") continue;
        rows.push(detailLine(`${name} · ${label}`, inner));
      }
    } else {
      rows.push(detailLine(prefix ? `${prefix} ${name}` : name, value));
    }
  }
  return rows;
}

function detailSections(device, info, groupName, clock = {}) {
  const general = info?.General || {};
  const os = info?.["Operating System"] || {};
  const agent = info?.["Mesh Agent"] || {};
  const bios = info?.BIOS || {};
  const board = info?.Motherboard || {};
  const system = info?.System || {};
  const version = os.Version || device.os_name || "";
  const cards = networkCards(info?.Networking);
  const wifi = cards.find((card) => /wi-?fi|wlan|wireless/i.test(card.name));
  const primary = cards.find((card) => isLanAddress(card.ip) && card.ip !== device.ipv4 && /Gateway:/i.test(card.v4Text))
    || cards.find((card) => isLanAddress(card.ip) && card.ip !== device.ipv4)
    || null;
  const privateIp = primary?.ip || "";
  const networkRows = [
    detailLine("Public IP Address", device.public_ip || device.ipv4),
    detailLine("Location", locationLabel(device)),
    detailLine("Private IP Address", privateIp),
    detailLine("MAC Address", primary?.mac || cards.find((card) => card.mac)?.mac),
    detailLine("Network Adapters", cards.length ? String(cards.length) : ""),
  ];
  const adapters = cards
    .map((card) => ({ name: card.name, rows: adapterDetails(card) }))
    .filter((adapter) => adapter.rows.length > 0)
    .sort((a, b) => Number(wifi && b.name === wifi.name) - Number(wifi && a.name === wifi.name));
  const users = Array.isArray(device.users) ? device.users.filter(Boolean) : [];
  const left = [
    {
      key: "device",
      title: "Device Details",
      icon: "device",
      rows: [
        detailLine("Device Name", device.display_name || device.hostname),
        detailLine("Hostname", general.Hostname || device.hostname),
        detailLine("Time Zone", clock.timeZone),
        detailLine("Last Boot Time", clock.lastBoot),
        detailLine("Active Users", users.join(", ")),
        detailLine("Last Seen", seenLabel(device.last_seen_at)),
        detailLine("Customer", device.customer_name),
        detailLine("Site / Branch", device.site_override),
      ],
    },
    {
      key: "os",
      title: "Operating System",
      icon: "os",
      rows: [
        detailLine("Platform", platformFrom(version, device.os_name)),
        detailLine("Version", version),
        detailLine("Architecture", os.Architecture),
        detailLine("Kernel Release", os["Kernel Release"]),
        detailLine("Kernel Build", os["Kernel Build"]),
        detailLine("Product ID", clock.productId),
      ].filter((row) => row.label !== "Kernel Release" && row.label !== "Kernel Build" ? true : row.value !== "—"),
    },
    {
      key: "hardware",
      title: "Hardware Details",
      icon: "hardware",
      rows: [
        detailLine("Manufacturer", system.Manufacturer || device.make),
        detailLine("Model", system["Product Name"] || board.Name || device.model),
        detailLine("Processor Name", board.CPU),
        detailLine("System RAM", memoryTotal(info?.Memory)),
        detailLine("System GPU", gpuNames(board)),
        detailLine("BIOS Version", bios.Version),
        detailLine("Serial Number", system.Serial || bios.Serial || device.serial),
      ],
    },
    {
      key: "bios",
      title: "BIOS",
      icon: "bios",
      rows: [
        detailLine("Vendor", bios.Vendor),
        detailLine("Version", bios.Version),
        detailLine("Serial", bios.Serial),
        detailLine("Mode", bios.Mode),
      ],
    },
    {
      key: "board",
      title: "Motherboard",
      icon: "board",
      rows: [
        detailLine("Vendor", board.Vendor),
        detailLine("Name", board.Name),
        detailLine("Version", board.Version),
        detailLine("Serial", board.Serial),
        detailLine("Identifier", board.Identifier),
      ],
    },
  ];
  const outdated = Boolean(device.latest_agent) && olderAgent(device.agent_version, device.latest_agent);
  const right = [
    {
      key: "dfagent",
      title: "Digital Fingers Agent",
      icon: "agent",
      rows: [
        detailLine("Version", device.agent_version || "1.4.0 or older"),
        detailLine("Latest", device.latest_agent || ""),
        detailLine("Status", device.latest_agent ? (outdated ? "Update available" : "Up to date") : ""),
      ],
    },
    {
      key: "agent",
      title: "Mesh Agent",
      icon: "agent",
      rows: [
        detailLine("Agent Version", agent["Mesh Agent"]),
        detailLine("Agent status", agent["Agent status"]),
        detailLine("Last agent connection", agent["Last agent connection"]),
        detailLine("Last agent address", agent["Last agent address"]),
      ],
    },
    {
      key: "groups",
      title: "Department & Groups",
      icon: "groups",
      rows: [
        detailLine("Department", ""),
        detailLine("Groups", groupName),
      ],
    },
    {
      key: "network",
      title: "Network Details",
      icon: "network",
      rows: networkRows,
      adapters,
    },
  ];
  const memoryRows = flattenBanks(info?.Memory);
  if (memoryRows.length) {
    right.push({ key: "memory", title: "Memory", icon: "memory", rows: memoryRows });
  }
  const storageRows = flattenBanks(info?.Storage);
  if (storageRows.length) {
    right.push({ key: "storage", title: "Storage", icon: "storage", rows: storageRows });
  }
  return { left, right };
}

function locationLabel(device) {
  if (!device.geo_updated_at) return "";
  const place = [device.geo_city, device.geo_region, device.geo_country_name].filter(Boolean).join(", ");
  return place || "Unknown";
}

function blank(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "N/A";
}

function gbFromBytes(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number <= 0) return "";
  const gb = number / (1024 ** 3);
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

function systemType(architecture) {
  const text = String(architecture || "");
  if (/arm/i.test(text) && /64/.test(text)) return "ARM64-based PC";
  if (/64/.test(text)) return "x64-based PC";
  if (/32/.test(text)) return "X86-based PC";
  return "";
}

function pickVolume(volumes) {
  const root = volumes && typeof volumes === "object" ? (volumes.drives || volumes) : {};
  const list = [];
  for (const [letter, disk] of Object.entries(root)) {
    if (!disk || typeof disk !== "object") continue;
    const size = Number(disk.size || disk.Size || 0);
    if (!size) continue;
    list.push({
      letter: String(letter),
      size,
      free: Number(disk.sizeremaining || disk.free || disk.FreeSpace || 0),
      kind: Number(disk.dType || disk.DriveType || 0),
    });
  }
  const fixed = list.filter((item) => item.kind === 0 || item.kind === 3);
  const pool = fixed.length ? fixed : list;
  return pool.find((item) => /^c:?$/i.test(item.letter)) || [...pool].sort((a, b) => b.size - a.size)[0] || null;
}

function storageHeadline(storage) {
  let mb = 0;
  for (const disk of Object.values(storage || {})) {
    const match = String(disk?.Capacity || "").match(/(\d+)/);
    if (match) mb += Number(match[1]);
  }
  if (!mb) return "";
  const gb = mb / 1024;
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function memoryHeadline(memory) {
  const text = memoryTotal(memory);
  const match = text.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (!match) return text;
  return `${Number(match[1]).toFixed(1)} GB`;
}

function experiencePack(osinfo) {
  for (const [key, value] of Object.entries(osinfo || {})) {
    if (/experience/i.test(key) && value) return String(value).trim();
  }
  return "";
}

function deviceOverview(device, info, raw) {
  const os = info?.["Operating System"] || {};
  const board = info?.Motherboard || {};
  const system = info?.System || {};
  const osinfo = raw?.hardware?.windows?.osinfo || raw?.result?.hardware?.windows?.osinfo || {};
  const windows = Boolean(osinfo.Caption || osinfo.Version || /windows/i.test(`${os.Version || ""} ${device.os_name || ""}`));
  const volume = pickVolume(info?.Volumes);
  const used = volume ? Math.max(0, volume.size - volume.free) : 0;
  const storageValue = volume ? gbFromBytes(volume.size) : storageHeadline(info?.Storage);
  const cpu = String(board.CPU || "");
  const speed = cpu.match(/^(.*?)\s+@\s+(.+)$/);
  const architecture = osinfo.OSArchitecture || os.Architecture || "";
  return {
    windows,
    tiles: [
      {
        label: "Storage",
        value: blank(storageValue),
        detail: volume && storageValue ? `${gbFromBytes(used) || "0 GB"} of ${storageValue} used` : "",
      },
      { label: "Graphics Card", value: blank(gpuNames(board)), detail: "" },
      { label: "Installed Memory", value: blank(memoryHeadline(info?.Memory)), detail: "" },
      { label: "Processor", value: blank(speed ? speed[1] : cpu), detail: speed ? speed[2].trim() : "" },
    ],
    device: [
      { label: "Device Name", value: device.display_name || device.hostname || "" },
      { label: "Device ID", value: blank(board.Identifier) },
      { label: "Product ID", value: blank(osinfo.SerialNumber) },
      { label: "Model", value: blank(system["Product Name"] || board.Name || device.model) },
      { label: "Manufacturer", value: blank(system.Manufacturer || device.make) },
      { label: "System type", value: blank(systemType(architecture)) },
      { label: "Service tag", value: blank(system.Serial || info?.BIOS?.Serial || device.serial) },
      { label: "Location", value: blank(locationLabel(device)) },
      { label: "Site / Branch", value: device.site_override || "" },
    ],
    windowsTitle: windows ? "Windows Specifications" : "Operating System",
    windows: [
      { label: "OS Name", value: blank(osinfo.Caption || os.Version || device.os_name) },
      { label: "Version", value: blank(osinfo.Version) },
      { label: "OS Build", value: blank(osinfo.BuildNumber) },
      { label: "Experience Pack", value: blank(experiencePack(osinfo)) },
      { label: "Installed On", value: blank(wmiTimeLabel(osinfo.InstallDate)) },
    ],
  };
}

async function meshDesktopUrl(nodeId, tokenName, osName, creds) {
  if (!creds) throw Object.assign(new Error("Remote links need a tenant login."), { status: 500 });
  const text = await meshControl(["LoginTokens", "--add", tokenName, "--expire", "10"], creds);
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

const AGENT_BIN_DIR = process.env.AGENT_BIN_DIR || "/opt/df-console/agent-bin";
const COMMAND_USES = [1, 5, 10, 25];

function enrollTokenUsable(row) {
  return Boolean(
    row
      && !row.revoked_at
      && row.use_count < row.max_uses
      && new Date(row.expires_at).getTime() > Date.now(),
  );
}
const AGENT_AUTO_UPDATE = process.env.AGENT_AUTO_UPDATE === "on";
const AGENT_OFFER_GAP_MS = 30 * 60000;
let agentReleaseCache = { at: 0, value: null };

async function agentRelease() {
  if (Date.now() - agentReleaseCache.at < 60000) return agentReleaseCache.value;
  let value = null;
  try {
    const raw = JSON.parse(await readFile(join(AGENT_BIN_DIR, "windows.json"), "utf8"));
    if (versionParts(raw.version) && /^[a-f0-9]{64}$/.test(String(raw.sha256))) {
      value = { version: raw.version, sha256: raw.sha256 };
    }
  } catch {
    value = null;
  }
  agentReleaseCache = { at: Date.now(), value };
  return value;
}

let remoteReleaseCache = { at: 0, value: null };

// The remote support (Mesh) agent that Windows device agents install, published by build-windows.sh.
async function remoteRelease() {
  if (Date.now() - remoteReleaseCache.at < 60000) return remoteReleaseCache.value;
  let value = null;
  try {
    const raw = JSON.parse(await readFile(join(AGENT_BIN_DIR, "windows-remote.json"), "utf8"));
    if (/^[a-f0-9]{64}$/.test(String(raw.sha256))) value = { sha256: raw.sha256 };
  } catch {
    value = null;
  }
  remoteReleaseCache = { at: Date.now(), value };
  return value;
}

function versionParts(version) {
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(version || "")) ? version.split(".").map(Number) : null;
}

function olderAgent(current, latest) {
  const want = versionParts(latest);
  if (!want) return false;
  const have = versionParts(current);
  if (!have) return true;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== want[i]) return have[i] < want[i];
  }
  return false;
}

// Agents before 1.5.0 cannot update themselves, so they get one job that fetches the new agent.
// The download runs under WMI so it outlives the job and holds none of the agent's pipes.
// Older agents hand the whole line to cmd.exe as one escaped argument, so it must contain no double quotes.
function legacyUpdateCommand(token, sha256) {
  const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const link = `https://api.digitalfingers.co.za/v1/agent/update/windows?t=${token}`;
  const script = [
    "[Net.ServicePointManager]::SecurityProtocol='Tls12'",
    "$p='C:\\ProgramData\\DigitalFingers\\df-agent-update.exe'",
    `Invoke-WebRequest -UseBasicParsing '${link}' -OutFile $p`,
    `if((Get-FileHash $p -Algorithm SHA256).Hash -eq '${sha256}'){Start-Process $p -ArgumentList 'update'}else{Remove-Item $p}`,
  ].join(";");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const inner = `${powershell} -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  return "set USERPROFILE=C:\\Windows\\System32\\config\\systemprofile&set TEMP=C:\\Windows\\Temp&set TMP=C:\\Windows\\Temp&"
    + "set PSModulePath=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules&"
    + `${powershell} -NoProfile -NonInteractive -Command ([wmiclass]'Win32_Process').Create('${inner}').ReturnValue`;
}

async function offerAgentUpdate(device, row, idle) {
  if (!/windows/i.test(row.os_name || "")) return null;
  const release = await agentRelease();
  if (!release) return null;
  if (!olderAgent(row.agent_version, release.version)) {
    if (row.agent_update_requested_at) {
      await pool.query("UPDATE devices SET agent_update_requested_at = NULL WHERE id = $1", [device.id]);
    }
    return null;
  }
  const requested = row.agent_update_requested_at != null;
  const due = !row.agent_update_offered_at || Date.now() - new Date(row.agent_update_offered_at).getTime() > AGENT_OFFER_GAP_MS;
  if (!requested && !(AGENT_AUTO_UPDATE && due)) return null;
  if (!idle) return null;
  const busy = await pool.query(
    `SELECT 1 FROM patch_deploys WHERE device_id = $1 AND status IN ('queued', 'running')
     UNION ALL SELECT 1 FROM jobs WHERE device_id = $1 AND status IN ('queued', 'running') LIMIT 1`,
    [device.id],
  );
  if (busy.rows[0]) return null;
  await pool.query(
    "UPDATE devices SET agent_update_requested_at = NULL, agent_update_offered_at = now() WHERE id = $1",
    [device.id],
  );
  const from = row.agent_version || "older";
  if (row.agent_version) {
    await writeAudit(device.org_id, null, "agent.update.offer", "device", String(device.id), { from, to: release.version });
    return { version: release.version, sha256: release.sha256 };
  }
  const token = randomBytes(24).toString("base64url");
  await redis.set(`agent-download:${token}`, String(device.id), "EX", 1800);
  await pool.query(
    "INSERT INTO jobs (org_id, device_id, command) VALUES ($1, $2, $3)",
    [device.org_id, device.id, legacyUpdateCommand(token, release.sha256)],
  );
  await writeAudit(device.org_id, null, "agent.update.offer", "device", String(device.id), { from, to: release.version, legacy: true });
  return null;
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

function requirePlatform(actor, res) {
  if (!requireActor(actor, res)) return false;
  if (!actor.is_platform_admin) {
    send(res, 403, { error: "Only the control panel can do this." });
    return false;
  }
  return true;
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
  if (row?.status) return row.status !== "active";
  return Boolean(row?.expires_at && new Date(row.expires_at).getTime() < Date.now());
}

function inactiveMessage(row) {
  return row?.status === "suspended" ? "This license is suspended." : "This license has expired.";
}

function licenseQuery(orgId, db = pool, options = {}) {
  return loadLicense(db, orgId, options).then((row) => ({ rows: row ? [row] : [] }));
}

function licenseDenied(res, row, reason, feature, name) {
  if (reason === "expired") return send(res, 403, { error: inactiveMessage(row), code: "license_inactive", feature });
  return send(res, 403, { error: `${name} is not included on this license.`, code: "feature_not_entitled", feature });
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

function usersFrom(body) {
  if (!body || !Object.hasOwn(body, "users") || !Array.isArray(body.users)) return null;
  const names = [];
  for (const item of body.users) {
    if (typeof item !== "string") continue;
    const name = item.replaceAll("\u0000", "").trim().slice(0, 80);
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (names.length >= 20) break;
  }
  return names;
}

function presenceFrom(lastSeenAt) {
  if (!lastSeenAt) return "offline";
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (age < 60 * 1000) return "online";
  if (age < 5 * 60 * 1000) return "rebooting";
  return "offline";
}

function ipv4From(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(forwarded)) return forwarded;
  return "";
}

const geo = geoLocator(process.env.GEOIP_DB || "/var/lib/GeoIP/GeoLite2-City.mmdb");
const ipApi = process.env.IP_API === "off" ? null : ipApiLocator({ key: process.env.IP_API_KEY || "" });

function publicIpFrom(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return parseIp(forwarded) ? forwarded.toLowerCase() : "";
}

function osField(value) {
  return typeof value === "string" ? value.replace(/[^\w .()-]/g, "").trim().slice(0, 60) : "";
}

// Looks the device up only when its public IP changed, it was never located,
// or the last lookup is older than the monthly database refresh.
async function locateDevice(deviceId, previousIp, current) {
  const local = geo.available();
  if (!current.public_ip || (!local && !ipApi)) return;
  const stale = !current.geo_updated_at || Date.now() - new Date(current.geo_updated_at).getTime() > 35 * 86400000;
  if (current.public_ip === previousIp && !stale) return;
  const place = local ? geo.lookup(current.public_ip) : await ipApi.lookup(current.public_ip);
  if (!place) return;
  await pool.query(
    `UPDATE devices
     SET geo_country = NULLIF($2, ''), geo_country_name = NULLIF($3, ''), geo_region = NULLIF($4, ''),
         geo_city = NULLIF($5, ''), geo_lat = $6, geo_lon = $7, geo_updated_at = now()
     WHERE id = $1`,
    [deviceId, place.country, place.countryName.slice(0, 80), place.region.slice(0, 80),
      place.city.slice(0, 80), place.lat, place.lon],
  );
}

async function storeHealthSample(orgId, deviceId, metrics) {
  await pool.query(
    `INSERT INTO device_samples (org_id, device_id, cpu_percent, memory_percent, disk_percent)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM device_samples
       WHERE device_id = $2 AND sampled_at > now() - interval '60 seconds'
     )`,
    [orgId, deviceId, metrics.cpuPercent, metrics.memoryPercent, metrics.diskPercent],
  );
  await pool.query(
    `DELETE FROM device_samples
     WHERE id IN (
       SELECT id FROM device_samples
       WHERE device_id = $1
       ORDER BY id DESC
       OFFSET 48
     )`,
    [deviceId],
  );
}

function encodedPowerShell(script) {
  return `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

const SAFE_MODE_SCRIPT = `$ProgressPreference = 'SilentlyContinue'
$names = @('df-agent') + @(Get-Service | Where-Object { $_.Name -like '*mesh*' -or $_.DisplayName -like '*mesh*' } | ForEach-Object { $_.Name })
foreach ($name in ($names | Select-Object -Unique)) {
  $key = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SafeBoot\\Network\\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value 'Service'
}
& "$env:SystemRoot\\System32\\bcdedit.exe" /set '{current}' safeboot network | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output 'Could not set safe mode.'; exit 1 }
& "$env:SystemRoot\\System32\\shutdown.exe" /r /t 5 /f
Write-Output 'Restarting in safe mode with networking.'`;

const LEAVE_SAFE_MODE = "C:\\Windows\\System32\\bcdedit.exe /deletevalue {current} safeboot >nul 2>&1 & ";

function powerCommand(action, osName, hostname) {
  const windows = {
    shutdown: `${LEAVE_SAFE_MODE}shutdown /s /t 0 /f`,
    restart: `${LEAVE_SAFE_MODE}shutdown /r /t 5 /f`,
    safemode: encodedPowerShell(SAFE_MODE_SCRIPT),
    logoff: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -EncodedCommand JABQAHIAbwBnAHIAZQBzAHMAUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAJwAKAAoAJAByAGEAdwAgAD0AIAAmACAAIgAkAGUAbgB2ADoAUwB5AHMAdABlAG0AUgBvAG8AdABcAFMAeQBzAHQAZQBtADMAMgBcAHEAdQBlAHIAeQAuAGUAeABlACIAIABzAGUAcwBzAGkAbwBuACAAfAAgAE8AdQB0AC0AUwB0AHIAaQBuAGcACgAkAGYAbwB1AG4AZAAgAD0AIAAkAGYAYQBsAHMAZQAKAGYAbwByAGUAYQBjAGgAIAAoACQAbABpAG4AZQAgAGkAbgAgACgAJAByAGEAdwAgAC0AcwBwAGwAaQB0ACAAIgBgAHIAYABuACIAKQApACAAewAKACAAIABpAGYAIAAoACQAbABpAG4AZQAgAC0AbQBhAHQAYwBoACAAJwBcAHMAKABcAGQAKwApAFwAcwArAEEAYwB0AGkAdgBlACcAKQAgAHsACgAgACAAIAAgACYAIAAiACQAZQBuAHYAOgBTAHkAcwB0AGUAbQBSAG8AbwB0AFwAUwB5AHMAdABlAG0AMwAyAFwAbABvAGcAbwBmAGYALgBlAHgAZQAiACAAJABNAGEAdABjAGgAZQBzAFsAMQBdAAoAIAAgACAAIABpAGYAIAAoACQATABBAFMAVABFAFgASQBUAEMATwBEAEUAIAAtAG4AZQAgADAAKQAgAHsAIABXAHIAaQB0AGUALQBPAHUAdABwAHUAdAAgACIAbABvAGcAbwBmAGYAIAAkACgAJABNAGEAdABjAGgAZQBzAFsAMQBdACkAIABmAGEAaQBsAGUAZAA6ACAAJABMAEEAUwBUAEUAWABJAFQAQwBPAEQARQAiADsAIABlAHgAaQB0ACAAJABMAEEAUwBUAEUAWABJAFQAQwBPAEQARQAgAH0ACgAgACAAIAAgACQAZgBvAHUAbgBkACAAPQAgACQAdAByAHUAZQAKACAAIAB9AAoAfQAKAGkAZgAgACgALQBuAG8AdAAgACQAZgBvAHUAbgBkACkAIAB7ACAAVwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAE4AbwAgAGEAYwB0AGkAdgBlACAAcwBlAHMAcwBpAG8AbgAgAHQAbwAgAGwAbwBnACAAbwBmAGYALgAiADsAIABlAHgAaQB0ACAAMQAgAH0ACgBXAHIAaQB0AGUALQBPAHUAdABwAHUAdAAgACIATABvAGcAZwBlAGQAIABvAGYAZgAuACIA",
    hibernate: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -EncodedCommand JABQAHIAbwBnAHIAZQBzAHMAUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAJwAKAAoAJAB0AGUAeAB0ACAAPQAgACYAIAAiACQAZQBuAHYAOgBTAHkAcwB0AGUAbQBSAG8AbwB0AFwAUwB5AHMAdABlAG0AMwAyAFwAcABvAHcAZQByAGMAZgBnAC4AZQB4AGUAIgAgAC8AYQAgAHwAIABPAHUAdAAtAFMAdAByAGkAbgBnAAoAJABpAG4AIAA9ACAAJABmAGEAbABzAGUACgAkAG8AawAgAD0AIAAkAGYAYQBsAHMAZQAKAGYAbwByAGUAYQBjAGgAIAAoACQAbABpAG4AZQAgAGkAbgAgACgAJAB0AGUAeAB0ACAALQBzAHAAbABpAHQAIAAiAGAAcgBgAG4AIgApACkAIAB7AAoAIAAgAGkAZgAgACgAJABsAGkAbgBlACAALQBsAGkAawBlACAAIgBUAGgAZQAgAGYAbwBsAGwAbwB3AGkAbgBnACAAcwBsAGUAZQBwACAAcwB0AGEAdABlAHMAIABhAHIAZQAgAGEAdgBhAGkAbABhAGIAbABlACoAIgApACAAewAgACQAaQBuACAAPQAgACQAdAByAHUAZQA7ACAAYwBvAG4AdABpAG4AdQBlACAAfQAKACAAIABpAGYAIAAoACQAbABpAG4AZQAgAC0AbABpAGsAZQAgACIAVABoAGUAIABmAG8AbABsAG8AdwBpAG4AZwAgAHMAbABlAGUAcAAgAHMAdABhAHQAZQBzACAAYQByAGUAIABuAG8AdAAgAGEAdgBhAGkAbABhAGIAbABlACoAIgApACAAewAgACQAaQBuACAAPQAgACQAZgBhAGwAcwBlADsAIABjAG8AbgB0AGkAbgB1AGUAIAB9AAoAIAAgAGkAZgAgACgAJABpAG4AIAAtAGEAbgBkACAAJABsAGkAbgBlACAALQBtAGEAdABjAGgAIAAiAEgAaQBiAGUAcgBuAGEAdABlACIAKQAgAHsAIAAkAG8AawAgAD0AIAAkAHQAcgB1AGUAIAB9AAoAfQAKAGkAZgAgACgALQBuAG8AdAAgACQAbwBrACkAIAB7ACAAVwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAEgAaQBiAGUAcgBuAGEAdABlACAAaQBzACAAbgBvAHQAIABhAHYAYQBpAGwAYQBiAGwAZQAgAG8AbgAgAHQAaABpAHMAIABQAEMALgAiADsAIABXAHIAaQB0AGUALQBPAHUAdABwAHUAdAAgACQAdABlAHgAdAA7ACAAZQB4AGkAdAAgADEAIAB9AAoAJgAgACIAJABlAG4AdgA6AFMAeQBzAHQAZQBtAFIAbwBvAHQAXABTAHkAcwB0AGUAbQAzADIAXABzAGgAdQB0AGQAbwB3AG4ALgBlAHgAZQAiACAALwBoACAALwBmAAoAZQB4AGkAdAAgACQATABBAFMAVABFAFgASQBUAEMATwBEAEUA",
    sleep: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -EncodedCommand JABQAHIAbwBnAHIAZQBzAHMAUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAJwAKAAoAJAB0AGUAeAB0ACAAPQAgACYAIAAiACQAZQBuAHYAOgBTAHkAcwB0AGUAbQBSAG8AbwB0AFwAUwB5AHMAdABlAG0AMwAyAFwAcABvAHcAZQByAGMAZgBnAC4AZQB4AGUAIgAgAC8AYQAgAHwAIABPAHUAdAAtAFMAdAByAGkAbgBnAAoAJABpAG4AIAA9ACAAJABmAGEAbABzAGUACgAkAG8AawAgAD0AIAAkAGYAYQBsAHMAZQAKAGYAbwByAGUAYQBjAGgAIAAoACQAbABpAG4AZQAgAGkAbgAgACgAJAB0AGUAeAB0ACAALQBzAHAAbABpAHQAIAAiAGAAcgBgAG4AIgApACkAIAB7AAoAIAAgAGkAZgAgACgAJABsAGkAbgBlACAALQBsAGkAawBlACAAIgBUAGgAZQAgAGYAbwBsAGwAbwB3AGkAbgBnACAAcwBsAGUAZQBwACAAcwB0AGEAdABlAHMAIABhAHIAZQAgAGEAdgBhAGkAbABhAGIAbABlACoAIgApACAAewAgACQAaQBuACAAPQAgACQAdAByAHUAZQA7ACAAYwBvAG4AdABpAG4AdQBlACAAfQAKACAAIABpAGYAIAAoACQAbABpAG4AZQAgAC0AbABpAGsAZQAgACIAVABoAGUAIABmAG8AbABsAG8AdwBpAG4AZwAgAHMAbABlAGUAcAAgAHMAdABhAHQAZQBzACAAYQByAGUAIABuAG8AdAAgAGEAdgBhAGkAbABhAGIAbABlACoAIgApACAAewAgACQAaQBuACAAPQAgACQAZgBhAGwAcwBlADsAIABjAG8AbgB0AGkAbgB1AGUAIAB9AAoAIAAgAGkAZgAgACgAJABpAG4AIAAtAGEAbgBkACAAJABsAGkAbgBlACAALQBtAGEAdABjAGgAIAAiAFMAdABhAG4AZABiAHkAIABcACgAUwAzAFwAKQB8AFMAdABhAG4AZABiAHkAIABcACgAUwAwACIAKQAgAHsAIAAkAG8AawAgAD0AIAAkAHQAcgB1AGUAIAB9AAoAfQAKAGkAZgAgACgALQBuAG8AdAAgACQAbwBrACkAIAB7ACAAVwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAFMAbABlAGUAcAAgAGkAcwAgAG4AbwB0ACAAYQB2AGEAaQBsAGEAYgBsAGUAIABvAG4AIAB0AGgAaQBzACAAUABDAC4AIgA7ACAAVwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAkAHQAZQB4AHQAOwAgAGUAeABpAHQAIAAxACAAfQAKACYAIAAiACQAZQBuAHYAOgBTAHkAcwB0AGUAbQBSAG8AbwB0AFwAUwB5AHMAdABlAG0AMwAyAFwAcgB1AG4AZABsAGwAMwAyAC4AZQB4AGUAIgAgACIAcABvAHcAcgBwAHIAbwBmAC4AZABsAGwALABTAGUAdABTAHUAcwBwAGUAbgBkAFMAdABhAHQAZQAiACAAIgAwACwAMQAsADAAIgA=",
    lock: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -EncodedCommand JABQAHIAbwBnAHIAZQBzAHMAUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAJwAKAEEAZABkAC0AVAB5AHAAZQAgAC0AVAB5AHAAZQBEAGUAZgBpAG4AaQB0AGkAbwBuACAAQAAiAAoAdQBzAGkAbgBnACAAUwB5AHMAdABlAG0AOwAKAHUAcwBpAG4AZwAgAFMAeQBzAHQAZQBtAC4AUgB1AG4AdABpAG0AZQAuAEkAbgB0AGUAcgBvAHAAUwBlAHIAdgBpAGMAZQBzADsACgB1AHMAaQBuAGcAIABTAHkAcwB0AGUAbQAuAFQAZQB4AHQAOwAKAHAAdQBiAGwAaQBjACAAYwBsAGEAcwBzACAARABGAEwAbwBjAGsAIAB7AAoAIAAgAFsARABsAGwASQBtAHAAbwByAHQAKAAiAGsAZQByAG4AZQBsADMAMgAuAGQAbABsACIAKQBdACAAcAB1AGIAbABpAGMAIABzAHQAYQB0AGkAYwAgAGUAeAB0AGUAcgBuACAAdQBpAG4AdAAgAFcAVABTAEcAZQB0AEEAYwB0AGkAdgBlAEMAbwBuAHMAbwBsAGUAUwBlAHMAcwBpAG8AbgBJAGQAKAApADsACgAgACAAWwBEAGwAbABJAG0AcABvAHIAdAAoACIAawBlAHIAbgBlAGwAMwAyAC4AZABsAGwAIgApAF0AIABwAHUAYgBsAGkAYwAgAHMAdABhAHQAaQBjACAAZQB4AHQAZQByAG4AIAB1AGkAbgB0ACAAVwBhAGkAdABGAG8AcgBTAGkAbgBnAGwAZQBPAGIAagBlAGMAdAAoAEkAbgB0AFAAdAByACAAaABhAG4AZABsAGUALAAgAHUAaQBuAHQAIABtAHMAKQA7AAoAIAAgAFsARABsAGwASQBtAHAAbwByAHQAKAAiAHcAdABzAGEAcABpADMAMgAuAGQAbABsACIALAAgAFMAZQB0AEwAYQBzAHQARQByAHIAbwByAD0AdAByAHUAZQApAF0AIABwAHUAYgBsAGkAYwAgAHMAdABhAHQAaQBjACAAZQB4AHQAZQByAG4AIABiAG8AbwBsACAAVwBUAFMAUQB1AGUAcgB5AFUAcwBlAHIAVABvAGsAZQBuACgAdQBpAG4AdAAgAHMAZQBzAHMAaQBvAG4ASQBkACwAIABvAHUAdAAgAEkAbgB0AFAAdAByACAAdABvAGsAZQBuACkAOwAKACAAIABbAEQAbABsAEkAbQBwAG8AcgB0ACgAIgBhAGQAdgBhAHAAaQAzADIALgBkAGwAbAAiACwAIABTAGUAdABMAGEAcwB0AEUAcgByAG8AcgA9AHQAcgB1AGUAKQBdACAAcAB1AGIAbABpAGMAIABzAHQAYQB0AGkAYwAgAGUAeAB0AGUAcgBuACAAYgBvAG8AbAAgAEQAdQBwAGwAaQBjAGEAdABlAFQAbwBrAGUAbgBFAHgAKABJAG4AdABQAHQAcgAgAHQAbwBrAGUAbgAsACAAdQBpAG4AdAAgAGEAYwBjAGUAcwBzACwAIABJAG4AdABQAHQAcgAgAGEAdAB0AHIAcwAsACAAaQBuAHQAIABsAGUAdgBlAGwALAAgAGkAbgB0ACAAdAB5AHAAZQAsACAAbwB1AHQAIABJAG4AdABQAHQAcgAgAGQAdQBwACkAOwAKACAAIABbAEQAbABsAEkAbQBwAG8AcgB0ACgAIgBhAGQAdgBhAHAAaQAzADIALgBkAGwAbAAiACwAIABTAGUAdABMAGEAcwB0AEUAcgByAG8AcgA9AHQAcgB1AGUALAAgAEMAaABhAHIAUwBlAHQAPQBDAGgAYQByAFMAZQB0AC4AVQBuAGkAYwBvAGQAZQApAF0AIABwAHUAYgBsAGkAYwAgAHMAdABhAHQAaQBjACAAZQB4AHQAZQByAG4AIABiAG8AbwBsACAAQwByAGUAYQB0AGUAUAByAG8AYwBlAHMAcwBBAHMAVQBzAGUAcgAoAEkAbgB0AFAAdAByACAAdABvAGsAZQBuACwAIABzAHQAcgBpAG4AZwAgAGEAcABwACwAIABTAHQAcgBpAG4AZwBCAHUAaQBsAGQAZQByACAAYwBtAGQALAAgAEkAbgB0AFAAdAByACAAcABhACwAIABJAG4AdABQAHQAcgAgAHQAYQAsACAAYgBvAG8AbAAgAGkAbgBoAGUAcgBpAHQALAAgAHUAaQBuAHQAIABmAGwAYQBnAHMALAAgAEkAbgB0AFAAdAByACAAZQBuAHYALAAgAHMAdAByAGkAbgBnACAAZABpAHIALAAgAHIAZQBmACAAUwBJACAAcwBpACwAIABvAHUAdAAgAFAASQAgAHAAaQApADsACgAgACAAWwBTAHQAcgB1AGMAdABMAGEAeQBvAHUAdAAoAEwAYQB5AG8AdQB0AEsAaQBuAGQALgBTAGUAcQB1AGUAbgB0AGkAYQBsACwAIABDAGgAYQByAFMAZQB0AD0AQwBoAGEAcgBTAGUAdAAuAFUAbgBpAGMAbwBkAGUAKQBdAAoAIAAgAHAAdQBiAGwAaQBjACAAcwB0AHIAdQBjAHQAIABTAEkAIAB7AAoAIAAgACAAIABwAHUAYgBsAGkAYwAgAGkAbgB0ACAAYwBiADsAIABwAHUAYgBsAGkAYwAgAHMAdAByAGkAbgBnACAAcgBlAHMAZQByAHYAZQBkADsAIABwAHUAYgBsAGkAYwAgAHMAdAByAGkAbgBnACAAZABlAHMAawB0AG8AcAA7ACAAcAB1AGIAbABpAGMAIABzAHQAcgBpAG4AZwAgAHQAaQB0AGwAZQA7AAoAIAAgACAAIABwAHUAYgBsAGkAYwAgAGkAbgB0ACAAeAAsACAAeQAsACAAeABTAGkAegBlACwAIAB5AFMAaQB6AGUALAAgAHgAQwBvAHUAbgB0ACwAIAB5AEMAbwB1AG4AdAAsACAAZgBpAGwAbAAsACAAZgBsAGEAZwBzADsACgAgACAAIAAgAHAAdQBiAGwAaQBjACAAcwBoAG8AcgB0ACAAcwBoAG8AdwBXAGkAbgBkAG8AdwAsACAAcgBlAHMAZQByAHYAZQBkADIAOwAgAHAAdQBiAGwAaQBjACAASQBuAHQAUAB0AHIAIAByAGUAcwBlAHIAdgBlAGQAMwAsACAAcwB0AGQASQBuACwAIABzAHQAZABPAHUAdAAsACAAcwB0AGQARQByAHIAOwAKACAAIAB9AAoAIAAgAFsAUwB0AHIAdQBjAHQATABhAHkAbwB1AHQAKABMAGEAeQBvAHUAdABLAGkAbgBkAC4AUwBlAHEAdQBlAG4AdABpAGEAbAApAF0ACgAgACAAcAB1AGIAbABpAGMAIABzAHQAcgB1AGMAdAAgAFAASQAgAHsAIABwAHUAYgBsAGkAYwAgAEkAbgB0AFAAdAByACAAcAByAG8AYwBlAHMAcwAsACAAdABoAHIAZQBhAGQAOwAgAHAAdQBiAGwAaQBjACAAaQBuAHQAIABwAHIAbwBjAGUAcwBzAEkAZAAsACAAdABoAHIAZQBhAGQASQBkADsAIAB9AAoAIAAgAHAAdQBiAGwAaQBjACAAcwB0AGEAdABpAGMAIAB2AG8AaQBkACAATABhAHUAbgBjAGgAKABzAHQAcgBpAG4AZwAgAGMAbwBtAG0AYQBuAGQAKQAgAHsACgAgACAAIAAgAHUAaQBuAHQAIABzAGUAcwBzAGkAbwBuACAAPQAgAFcAVABTAEcAZQB0AEEAYwB0AGkAdgBlAEMAbwBuAHMAbwBsAGUAUwBlAHMAcwBpAG8AbgBJAGQAKAApADsACgAgACAAIAAgAEkAbgB0AFAAdAByACAAdABvAGsAZQBuACAAPQAgAEkAbgB0AFAAdAByAC4AWgBlAHIAbwA7AAoAIAAgACAAIABiAG8AbwBsACAAbwBwAGUAbgBlAGQAIAA9ACAAcwBlAHMAcwBpAG8AbgAgACEAPQAgADAAeABGAEYARgBGAEYARgBGAEYAIAAmACYAIABXAFQAUwBRAHUAZQByAHkAVQBzAGUAcgBUAG8AawBlAG4AKABzAGUAcwBzAGkAbwBuACwAIABvAHUAdAAgAHQAbwBrAGUAbgApADsACgAgACAAIAAgAGkAZgAgACgAIQBvAHAAZQBuAGUAZAApACAAewAKACAAIAAgACAAIAAgAEMAbwBuAHMAbwBsAGUALgBXAHIAaQB0AGUATABpAG4AZQAoACIAQwBvAHUAbABkACAAbgBvAHQAIABvAHAAZQBuACAAdABoAGUAIABzAGkAZwBuAGUAZAAtAGkAbgAgAHMAZQBzAHMAaQBvAG4ALgAgACIAIAArACAATQBhAHIAcwBoAGEAbAAuAEcAZQB0AEwAYQBzAHQAVwBpAG4AMwAyAEUAcgByAG8AcgAoACkAKQA7AAoAIAAgACAAIAAgACAARQBuAHYAaQByAG8AbgBtAGUAbgB0AC4ARQB4AGkAdAAoADEAKQA7AAoAIAAgACAAIAB9AAoAIAAgACAAIABJAG4AdABQAHQAcgAgAGQAdQBwACAAPQAgAEkAbgB0AFAAdAByAC4AWgBlAHIAbwA7AAoAIAAgACAAIABpAGYAIAAoACEARAB1AHAAbABpAGMAYQB0AGUAVABvAGsAZQBuAEUAeAAoAHQAbwBrAGUAbgAsACAAMAB4ADAAMgAwADAAMAAwADAAMAAsACAASQBuAHQAUAB0AHIALgBaAGUAcgBvACwAIAAyACwAIAAxACwAIABvAHUAdAAgAGQAdQBwACkAKQAgAHsACgAgACAAIAAgACAAIABDAG8AbgBzAG8AbABlAC4AVwByAGkAdABlAEwAaQBuAGUAKAAiAEMAbwB1AGwAZAAgAG4AbwB0ACAAdQBzAGUAIAB0AGgAZQAgAHMAaQBnAG4AZQBkAC0AaQBuACAAcwBlAHMAcwBpAG8AbgAuACAAIgAgACsAIABNAGEAcgBzAGgAYQBsAC4ARwBlAHQATABhAHMAdABXAGkAbgAzADIARQByAHIAbwByACgAKQApADsACgAgACAAIAAgACAAIABFAG4AdgBpAHIAbwBuAG0AZQBuAHQALgBFAHgAaQB0ACgAMQApADsACgAgACAAIAAgAH0ACgAgACAAIAAgAFMASQAgAHMAaQAgAD0AIABuAGUAdwAgAFMASQAoACkAOwAKACAAIAAgACAAcwBpAC4AYwBiACAAPQAgAE0AYQByAHMAaABhAGwALgBTAGkAegBlAE8AZgAoAHQAeQBwAGUAbwBmACgAUwBJACkAKQA7AAoAIAAgACAAIABzAGkALgBkAGUAcwBrAHQAbwBwACAAPQAgACIAdwBpAG4AcwB0AGEAMABcAFwAZABlAGYAYQB1AGwAdAAiADsACgAgACAAIAAgAFAASQAgAHAAaQAgAD0AIABuAGUAdwAgAFAASQAoACkAOwAKACAAIAAgACAAdgBhAHIAIABjAG0AZAAgAD0AIABuAGUAdwAgAFMAdAByAGkAbgBnAEIAdQBpAGwAZABlAHIAKABjAG8AbQBtAGEAbgBkACkAOwAKACAAIAAgACAAaQBmACAAKAAhAEMAcgBlAGEAdABlAFAAcgBvAGMAZQBzAHMAQQBzAFUAcwBlAHIAKABkAHUAcAAsACAAbgB1AGwAbAAsACAAYwBtAGQALAAgAEkAbgB0AFAAdAByAC4AWgBlAHIAbwAsACAASQBuAHQAUAB0AHIALgBaAGUAcgBvACwAIABmAGEAbABzAGUALAAgADAALAAgAEkAbgB0AFAAdAByAC4AWgBlAHIAbwAsACAAbgB1AGwAbAAsACAAcgBlAGYAIABzAGkALAAgAG8AdQB0ACAAcABpACkAKQAgAHsACgAgACAAIAAgACAAIABDAG8AbgBzAG8AbABlAC4AVwByAGkAdABlAEwAaQBuAGUAKAAiAEMAbwB1AGwAZAAgAG4AbwB0ACAAbABvAGMAawAgAHQAaABlACAAZABlAHMAawB0AG8AcAAuACAAIgAgACsAIABNAGEAcgBzAGgAYQBsAC4ARwBlAHQATABhAHMAdABXAGkAbgAzADIARQByAHIAbwByACgAKQApADsACgAgACAAIAAgACAAIABFAG4AdgBpAHIAbwBuAG0AZQBuAHQALgBFAHgAaQB0ACgAMQApADsACgAgACAAIAAgAH0ACgAgACAAIAAgAFcAYQBpAHQARgBvAHIAUwBpAG4AZwBsAGUATwBiAGoAZQBjAHQAKABwAGkALgBwAHIAbwBjAGUAcwBzACwAIAA4ADAAMAAwACkAOwAKACAAIAAgACAAQwBvAG4AcwBvAGwAZQAuAFcAcgBpAHQAZQBMAGkAbgBlACgAIgBMAG8AYwBrAGUAZAAuACIAKQA7AAoAIAAgAH0ACgB9AAoAIgBAAAoAWwBEAEYATABvAGMAawBdADoAOgBMAGEAdQBuAGMAaAAoACIAQwA6AFwAVwBpAG4AZABvAHcAcwBcAFMAeQBzAHQAZQBtADMAMgBcAHIAdQBuAGQAbABsADMAMgAuAGUAeABlACAAdQBzAGUAcgAzADIALgBkAGwAbAAsAEwAbwBjAGsAVwBvAHIAawBTAHQAYQB0AGkAbwBuACIAKQA=",
  };
  const linux = {
    shutdown: "sudo -n /bin/systemctl poweroff",
    restart: "sudo -n /bin/systemctl reboot",
    logoff: "sudo -n /bin/loginctl terminate-user \"$(/usr/bin/who | /usr/bin/awk 'NR==1{print $1}')\"",
    hibernate: "sudo -n /bin/systemctl hibernate",
    sleep: "sudo -n /bin/systemctl suspend",
    lock: "sudo -n /bin/loginctl lock-sessions",
  };
  const table = /windows/i.test(osName || "") ? windows : linux;
  const command = table[action] || "";
  if (!command || !/windows/i.test(osName || "")) return command;
  const name = String(hostname || "").replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
  return `set COMPUTERNAME=${name}& ${command}`;
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
    const kb = typeof raw.kb === "string" && /^KB\d{1,10}$/i.test(raw.kb.trim()) ? raw.kb.trim().toUpperCase() : "";
    const category = updateCategory(raw.categoryId, raw.category);
    const severity = UPDATE_SEVERITIES.includes(raw.severity) ? raw.severity : "";
    const sizeBytes = Number.isSafeInteger(raw.sizeBytes) && raw.sizeBytes > 0 ? raw.sizeBytes : 0;
    const restart = raw.restart === true;
    items.push({ name, currentVersion, availableVersion, kb, category, severity, sizeBytes, restart });
    if (items.length >= 200) break;
  }
  return items;
}

const UPDATE_SEVERITIES = ["Critical", "Important", "Moderate", "Low"];

const UPDATE_CATEGORY_IDS = {
  "0fa1201d-4330-4fa8-8ae9-b877473b6441": "Security",
  "e6cf1350-c01b-414d-a61f-263d14d133b4": "Critical",
  "e0789628-ce08-4437-be74-2495b842f43b": "Definition",
  "ebfc1fc5-71a4-4f7b-9aca-3b9a503104a0": "Driver",
  "b54e7d24-7add-428f-8b75-90a396fa584f": "Feature",
  "68c5b0a3-d1a6-4553-ae49-01d3a7827828": "Service pack",
  "b4832bd8-e735-4761-8daf-37f882276dab": "Tool",
  "28bc880e-0592-4cbf-8f95-c79b17911d5f": "Rollup",
  "cd5ffd1e-e932-4e3a-bf74-18bf0b1bbd83": "Update",
  "3689bdc8-b205-4af4-8d4a-a63924c5e9d5": "Upgrade",
};

const UPDATE_CATEGORY_NAMES = {
  "security updates": "Security",
  security: "Security",
  "critical updates": "Critical",
  "definition updates": "Definition",
  drivers: "Driver",
  "feature packs": "Feature",
  "service packs": "Service pack",
  tools: "Tool",
  "update rollups": "Rollup",
  updates: "Update",
  update: "Update",
  upgrades: "Upgrade",
};

function updateCategory(id, name) {
  const byId = typeof id === "string" ? UPDATE_CATEGORY_IDS[id.trim().toLowerCase()] : null;
  if (byId) return byId;
  const byName = typeof name === "string" ? UPDATE_CATEGORY_NAMES[name.trim().toLowerCase()] : null;
  return byName || "Update";
}

function pushNow(item) {
  return item?.severity === "Critical" && item?.category === "Security";
}

const RESTART_WARNING = "Digital Fingers Support installed updates. This computer will restart in 5 minutes. Please save your work.";
const RESTART_REQUEST = "Your remote administrator has applied updates to your computer. Please restart it at your earliest convenience.";

function isServerOs(osName) {
  return /server/i.test(osName || "");
}

function updateRestartCommand(device) {
  if (!/windows/i.test(device.os_name || "")) return powerCommand("restart", device.os_name, device.hostname);
  const name = String(device.hostname || "").replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
  const wait = Array.isArray(device.users) && device.users.length > 0 ? 300 : 5;
  return `set COMPUTERNAME=${name}& ${LEAVE_SAFE_MODE}shutdown /r /t ${wait} /f /d p:2:17 /c "${RESTART_WARNING}"`;
}

async function restartAfterUpdates(device, mode, actorId) {
  if (mode === "ask") {
    const { nodeId } = await resolveMeshNode(device, device.org_id);
    if (!nodeId) throw Object.assign(new Error("This computer is not linked to the remote service."), { status: 409 });
    await meshControl(["DeviceMessage", "--id", nodeId, "--title", "Digital Fingers Support", "--msg", RESTART_REQUEST]);
    await writeAudit(device.org_id, actorId, "patch.restart.ask", "device", String(device.id), {});
    return { asked: true };
  }
  const command = updateRestartCommand(device);
  if (!command) throw Object.assign(new Error("This computer cannot be restarted from here."), { status: 400 });
  const job = await pool.query(
    `INSERT INTO jobs (org_id, device_id, command, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [device.org_id, device.id, command, actorId],
  );
  await writeAudit(device.org_id, actorId, "patch.restart", "device", String(device.id), {
    jobId: Number(job.rows[0].id),
    warned: Array.isArray(device.users) && device.users.length > 0,
  });
  return { jobId: Number(job.rows[0].id) };
}

async function finishUpdateBatch(deviceId) {
  const busy = await pool.query(
    "SELECT 1 FROM patch_deploys WHERE device_id = $1 AND status IN ('queued', 'running') LIMIT 1",
    [deviceId],
  );
  if (busy.rows[0]) return;
  const batch = await pool.query(
    `UPDATE patch_deploys
     SET restart_handled_at = now()
     WHERE device_id = $1 AND status IN ('succeeded', 'failed')
       AND restart_mode IS NOT NULL AND restart_handled_at IS NULL
     RETURNING restart_mode, restart_required, pushed_by`,
    [deviceId],
  );
  if (!batch.rows.some((row) => row.restart_required)) return;
  const modes = new Set(batch.rows.map((row) => row.restart_mode));
  const mode = modes.has("auto") ? "auto" : modes.has("ask") ? "ask" : "later";
  if (mode === "later") return;
  const found = await pool.query(
    "SELECT id, org_id, hostname, display_name, mesh_node_id, os_name, users FROM devices WHERE id = $1",
    [deviceId],
  );
  if (!found.rows[0]) return;
  const pusher = batch.rows.find((row) => row.pushed_by != null)?.pushed_by ?? null;
  try {
    await restartAfterUpdates(found.rows[0], mode, pusher);
  } catch (error) {
    await writeAudit(found.rows[0].org_id, pusher, "patch.restart.fail", "device", String(deviceId), {
      mode,
      error: String(error.message || "failed").slice(0, 200),
    });
  }
}

const PATCH_RULE_CATEGORIES = [...new Set(Object.values(UPDATE_CATEGORY_IDS))];

async function approveUpdates(device, items, actorId, { skipRecent = false } = {}) {
  const approved = [];
  for (const item of items) {
    const name = typeof item?.name === "string" ? item.name : "";
    if (!name) continue;
    const waiting = await pool.query(
      `UPDATE patch_deploys
       SET status = 'approved', approved_by = $1, approved_at = now()
       WHERE device_id = $2 AND package_name = $3 AND status = 'waiting'
       RETURNING id`,
      [actorId, device.id, name],
    );
    if (waiting.rows[0]) {
      approved.push(name);
      continue;
    }
    const inserted = await pool.query(
      `INSERT INTO patch_deploys (org_id, device_id, package_name, status, created_by, approved_by, approved_at,
                                  kb, severity, category)
       SELECT $1, $2, $3, 'approved', $4, $4, now(), $5, $6, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM patch_deploys
         WHERE device_id = $2 AND package_name = $3
           AND (status IN ('approved', 'queued', 'running')
                OR ($8 AND status = 'succeeded' AND finished_at > now() - interval '1 day'))
       )
       RETURNING id`,
      [device.org_id, device.id, name, actorId, item.kb || null, item.severity || null, item.category || null, skipRecent],
    );
    if (inserted.rows[0]) approved.push(name);
  }
  return approved;
}

async function autoApproveUpdates(device) {
  const updates = Array.isArray(device.updates) ? device.updates : [];
  if (updates.length === 0) return;
  const rules = await pool.query("SELECT category, created_by FROM patch_rules WHERE org_id = $1", [device.org_id]);
  for (const rule of rules.rows) {
    const items = updates.filter((item) => item?.category === rule.category);
    if (items.length === 0) continue;
    const approved = await approveUpdates(device, items, rule.created_by, { skipRecent: true });
    if (approved.length) {
      await writeAudit(device.org_id, rule.created_by, "patch.approve", "device", String(device.id), {
        rule: rule.category,
        count: approved.length,
        names: approved.slice(0, 20),
      });
    }
  }
}

function deployFields(row) {
  if (!row) return { status: "available", detail: "", restartRequired: false, finishedAt: null };
  return {
    status: row.status,
    detail: row.detail || "",
    restartRequired: row.restart_required === true,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

function boundedCount(value, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) return null;
  return number;
}

async function remoteAppAllowed(orgId) {
  const license = await licenseQuery(orgId);
  return hasApp(license.rows[0]?.entitlements, "remote");
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
  const license = await licenseQuery(actor.org_id);
  const reason = patchReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "patch.deny", "org", String(actor.org_id), { reason });
    }
    licenseDenied(res, license.rows[0], reason, "patching", "Patch management");
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
  const license = await licenseQuery(actor.org_id);
  const reason = reportingReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "reporting.deny", "org", String(actor.org_id), { reason });
    }
    licenseDenied(res, license.rows[0], reason, "reporting", "Reporting");
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
  const license = await licenseQuery(actor.org_id);
  const reason = monitoringReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "monitoring.deny", "org", String(actor.org_id), { reason });
    }
    licenseDenied(res, license.rows[0], reason, "monitoring", "Monitoring");
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
  await ticketEvent(orgId, created.rows[0].id, "created", {
    label: AUTOMATION_LABELS[detail?.reason] || null,
    detail: { status: "open", priority: "normal" },
  });
  await notifyNewTicket(orgId, created.rows[0].id, subject);
  return Number(created.rows[0].id);
}

const AUTOMATION_LABELS = { offline: "Offline monitor", missing: "Patch monitor", online: "Offline monitor" };

async function notifyNewTicket(orgId, ticketId, subject, options = {}) {
  await deskNotify(deskHelpers(), {
    orgId,
    event: "new_ticket",
    ticketId,
    subject,
    userIds: options.assigneeId ? [options.assigneeId] : [],
    actorId: options.actorId ?? null,
  });
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
  const license = await licenseQuery(row.org_id);
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
    const comment = await pool.query(
      `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body, kind, author_label)
       VALUES ($1, $2, NULL, $3, 'note', $4)
       RETURNING id`,
      [row.org_id, ticketId, missingNote(name), AUTOMATION_LABELS.missing],
    );
    await ticketEvent(row.org_id, ticketId, "note", {
      label: AUTOMATION_LABELS.missing,
      detail: { commentId: Number(comment.rows[0].id) },
    });
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
    `WITH old AS (
       SELECT id, status FROM tickets
       WHERE org_id = $1 AND device_id = $2 AND subject = $3 AND status <> 'resolved'
       FOR UPDATE
     )
     UPDATE tickets t
     SET status = 'resolved', updated_at = now()
     FROM old
     WHERE t.id = old.id
     RETURNING t.id, old.status AS old_status`,
    [row.org_id, row.id, subject],
  );
  for (const ticket of updated.rows) {
    await writeAudit(row.org_id, null, "ticket.update", "ticket", String(ticket.id), {
      status: "resolved",
      reason: "online",
    });
    await ticketEvent(row.org_id, ticket.id, "status", {
      label: AUTOMATION_LABELS.online,
      detail: { from: ticket.old_status, to: "resolved" },
    });
  }
}

let offlineSweepRunning = false;

async function orgsWithFeature(feature) {
  const licenses = await loadAllLicenses(pool);
  return [...licenses].filter(([, row]) => hasFeature(row.entitlements, feature)).map(([orgId]) => orgId);
}

async function sweepOffline() {
  if (offlineSweepRunning) return;
  offlineSweepRunning = true;
  try {
    const devices = await pool.query(
      `SELECT d.id, d.org_id, d.hostname, s.customer_id
       FROM devices d
       JOIN sites s ON s.id = d.site_id
       WHERE d.last_seen_at IS NOT NULL
         AND d.last_seen_at < now() - interval '60 seconds'
         AND d.org_id = ANY($1::bigint[])`,
      [await orgsWithFeature("ticketing")],
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

async function notifySla(event, ticket) {
  await deskNotify(deskHelpers(), {
    orgId: ticket.org_id,
    event,
    ticketId: ticket.id,
    subject: ticket.subject,
    userIds: ticket.assignee_user_id ? [ticket.assignee_user_id] : [],
  });
}

let breachSweepRunning = false;

async function sweepBreaches() {
  if (breachSweepRunning) return;
  breachSweepRunning = true;
  try {
    const afterId = await breachBaseline();
    const tickets = await pool.query(
      `SELECT t.id, t.org_id, t.subject, t.status, t.created_at, t.updated_at, c.sla_plan_id,
              t.assignee_user_id, t.sla_warned, ${TICKET_CLOCK_SQL}
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.id > $1
         AND t.status <> 'resolved'
         AND t.migration_lock IS NULL
         AND t.org_id = ANY($2::bigint[])
         AND NOT EXISTS (
           SELECT 1 FROM audit_events e
           WHERE e.action = 'ticket.breach'
             AND e.target_type = 'ticket'
             AND e.target_id = t.id::text
         )
         AND NOT EXISTS (SELECT 1 FROM activity_events te WHERE te.org_id = t.org_id AND te.ticket_id = t.id AND te.type = 'ticket.sla_breach')`,
      [afterId, await orgsWithFeature("ticketing")],
    );
    const now = new Date();
    const books = new Map();
    for (const ticket of tickets.rows) {
      const key = String(ticket.org_id);
      if (!books.has(key)) books.set(key, await slaBook(ticket.org_id));
      const state = slaState(ticket, slaFor(books.get(key), ticket.sla_plan_id), now);
      if (state.state === "breached") {
        await ticketEvent(ticket.org_id, ticket.id, "sla_breach", {
          label: "SLA monitor",
          detail: { target: state.target },
        });
        await notifySla("sla_breach", ticket);
        continue;
      }
      if (state.state !== "soon" || (ticket.sla_warned || []).includes(state.target)) continue;
      const marked = await pool.query(
        `UPDATE tickets SET sla_warned = array_append(COALESCE(sla_warned, '{}'), $2::text)
         WHERE id = $1 AND NOT ($2::text = ANY(COALESCE(sla_warned, '{}')))
         RETURNING id`,
        [ticket.id, state.target],
      );
      if (!marked.rows[0]) continue;
      await ticketEvent(ticket.org_id, ticket.id, "sla_warning", {
        label: "SLA monitor",
        detail: { target: state.target, minutesLeft: state.minutesLeft, dueAt: state.dueAt },
      });
      await notifySla("sla_warning", ticket);
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
    try {
      const license = (await licenseQuery(rule.org_id)).rows[0];
      if (ticketingAllowed(license) && hasApp(license?.entitlements, "remote") && (await deskOptions(rule.org_id)).alertTickets) {
        await createAlertTicket(rule.org_id, created.rows[0].id, null);
      }
    } catch (error) {
      console.error("alert ticket failed", error.message);
    }
  }
}

// actorId is null when the Service Desk option raised the ticket on its own.
async function createAlertTicket(orgId, alertId, actorId) {
  const alert = await pool.query(
    `SELECT a.id, a.device_id, a.metric, a.value, a.ticket_id, d.hostname, s.customer_id
     FROM alerts a
     JOIN devices d ON d.id = a.device_id
     LEFT JOIN sites s ON s.id = d.site_id
     WHERE a.id = $1 AND a.org_id = $2`,
    [alertId, orgId],
  );
  const row = alert.rows[0];
  if (!row) return { status: 404, error: "Alert not found." };
  if (row.ticket_id != null) return { id: Number(row.ticket_id), created: false };
  const customerId = row.customer_id == null ? null : Number(row.customer_id);
  if (customerId == null) return { status: 409, error: "That device is not linked to a customer." };
  const label = ALERT_LABELS[row.metric] || row.metric;
  const subject = `${label} ${row.value}% on ${row.hostname}`.slice(0, 200);
  const ticketId = await inTransaction(async (client) => {
    const ticket = await client.query(
      `INSERT INTO tickets (org_id, customer_id, device_id, assignee_user_id, subject, status, priority, created_by, channel)
       VALUES ($1, $2, $3, $4, $5, 'open', 'high', $4, 'alert')
       RETURNING id`,
      [orgId, customerId, row.device_id, actorId, subject],
    );
    const id = Number(ticket.rows[0].id);
    await client.query("UPDATE alerts SET ticket_id = $1 WHERE id = $2", [id, row.id]);
    await ticketEvent(orgId, id, "created", {
      actorId,
      label: actorId == null ? "Alert monitor" : null,
      detail: { status: "open", priority: "high", alertId: Number(row.id) },
      db: client,
    });
    return id;
  });
  await writeAudit(orgId, actorId, "ticket.create", "ticket", String(ticketId), {
    alertId: Number(row.id),
    customerId,
    deviceId: Number(row.device_id),
    status: "open",
    priority: "high",
    channel: "alert",
  });
  await runAutomations(deskHelpers(), orgId, ticketId, "created");
  await notifyNewTicket(orgId, ticketId, subject, { actorId });
  return { id: ticketId, created: true };
}

async function requireTicketing(actor, res, options = {}) {
  if (!requireActor(actor, res)) return false;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return false;
  }
  const license = await licenseQuery(actor.org_id);
  const reason = ticketingReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "ticket.deny", "org", String(actor.org_id), { reason });
    }
    licenseDenied(res, license.rows[0], reason, "ticketing", "Ticketing");
    return false;
  }
  return true;
}

async function customerNameTaken(db, orgId, name, exceptId) {
  const found = await db.query(
    "SELECT 1 FROM customers WHERE org_id = $1 AND lower(name) = lower($2) AND id <> COALESCE($3, 0)",
    [orgId, name, exceptId],
  );
  return Boolean(found.rows[0]);
}

// Customers belong to every package. An inactive license keeps them readable but blocks changes.
async function customerAccess(actor, res, { write = false } = {}) {
  if (!requireActor(actor, res)) return null;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return null;
  }
  const row = (await licenseQuery(actor.org_id)).rows[0];
  const ent = row?.entitlements;
  const active = ent?.active === true;
  if (write && !active) {
    licenseDenied(res, row, "expired", "customers", "Customers");
    return null;
  }
  // App views follow the package, not the licence state, so an expired tenant can still read its customers.
  const packaged = Array.isArray(ent?.apps) ? ent.apps : [];
  return {
    row,
    active,
    remote: packaged.includes("remote"),
    service: packaged.includes("servicedesk"),
    reporting: hasFeature(ent, "reporting"),
  };
}

function customerView(url, access, res) {
  const resolved = resolveCustomerView(url.searchParams.get("view"), access);
  if (resolved.status) {
    send(res, resolved.status, resolved.body);
    return null;
  }
  return resolved.view;
}

function customerFlags(access, actor) {
  return {
    apps: { remote: access.remote, servicedesk: access.service, reporting: access.reporting },
    readOnly: !access.active,
    canDelete: access.active && canOperate(actor),
    canMonitor: monitoringAllowed(access.row),
    canPatch: patchAllowed(access.row),
    canReport: access.reporting,
  };
}

function ticketView(row) {
  return {
    id: Number(row.id),
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    customer: {
      id: Number(row.customer_id),
      name: row.customer_name,
      contactId: row.contact_id == null ? null : Number(row.contact_id),
      contactName: row.contact_name || null,
      contactEmail: row.contact_email || null,
    },
    device: row.device_id == null ? null : { id: Number(row.device_id), hostname: row.device_hostname },
    assignee: row.assignee_user_id
      ? { id: Number(row.assignee_user_id), name: row.assignee_name, email: row.assignee_email }
      : null,
    statusId: row.status_id == null ? null : Number(row.status_id),
    statusLabel: row.status_label || null,
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

async function accountOnly(client, orgId, customerId) {
  const customer = await client.query("SELECT id FROM customers WHERE id = $1 AND org_id = $2", [customerId, orgId]);
  if (!customer.rows[0]) return { status: 400, error: "Choose an account in this organisation." };
  return { linked: false };
}

const TICKET_CONTACT_JOIN = `LEFT JOIN contacts ct ON ct.id = COALESCE(
  t.contact_id,
  (SELECT p.id FROM contacts p WHERE p.customer_id = t.customer_id AND p.is_primary LIMIT 1)
)`;

const ACCOUNT_KINDS = new Set(["company", "sole_proprietor", "other"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textField(body, key, max) {
  const raw = body?.[key];
  if (raw == null) return { value: null };
  if (typeof raw !== "string") return { error: true };
  const value = raw.trim();
  if (value.length > max) return { error: true };
  return { value: value || null };
}

function accountInput(body) {
  const fields = {
    name: textField(body, "name", 200),
    website: textField(body, "website", 200),
    email: textField(body, "email", 200),
    phone: textField(body, "phone", 40),
    altPhone: textField(body, "altPhone", 40),
    address: textField(body, "address", 500),
    registrationNumber: textField(body, "registrationNumber", 60),
    vatNumber: textField(body, "vatNumber", 60),
    notes: textField(body, "notes", 4000),
  };
  if (!fields.name.value || fields.name.error) return { error: "Enter an account name." };
  const kind = body?.kind || "company";
  if (!ACCOUNT_KINDS.has(kind)) return { error: "Choose an account type." };
  const bad = Object.entries(fields).find(([, field]) => field.error);
  if (bad) return { error: `Check the ${bad[0]} field.` };
  const email = fields.email.value?.toLowerCase() || null;
  if (email && !EMAIL_PATTERN.test(email)) return { error: "Enter a valid email address." };
  return {
    values: {
      name: fields.name.value,
      kind,
      website: fields.website.value,
      email,
      phone: fields.phone.value,
      altPhone: fields.altPhone.value,
      address: fields.address.value,
      registrationNumber: fields.registrationNumber.value,
      vatNumber: fields.vatNumber.value,
      notes: fields.notes.value,
    },
  };
}

function contactInput(body) {
  const fields = {
    name: textField(body, "name", 200),
    email: textField(body, "email", 200),
    phone: textField(body, "phone", 40),
    altPhone: textField(body, "altPhone", 40),
    jobTitle: textField(body, "jobTitle", 120),
  };
  if (!fields.name.value || fields.name.error) return { error: "Enter a contact name." };
  const bad = Object.entries(fields).find(([, field]) => field.error);
  if (bad) return { error: `Check the ${bad[0]} field.` };
  const email = fields.email.value?.toLowerCase() || null;
  if (email && !EMAIL_PATTERN.test(email)) return { error: "Enter a valid contact email." };
  return {
    values: {
      name: fields.name.value,
      email,
      phone: fields.phone.value,
      altPhone: fields.altPhone.value,
      jobTitle: fields.jobTitle.value,
      primary: body?.primary === true,
    },
  };
}

function accountView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    kind: row.kind,
    website: row.website || null,
    email: row.email || null,
    phone: row.phone || null,
    altPhone: row.alt_phone || null,
    address: row.address || null,
    registrationNumber: row.registration_number || null,
    vatNumber: row.vat_number || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    movedAway: row.migration_lock != null,
  };
}

function contactView(row) {
  return {
    id: Number(row.id),
    accountId: Number(row.customer_id),
    accountName: row.customer_name || null,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    altPhone: row.alt_phone || null,
    jobTitle: row.job_title || null,
    primary: row.is_primary === true,
  };
}

function deviceChoice(row) {
  return {
    id: Number(row.id),
    hostname: row.display_name || row.hostname,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: row.customer_name || null,
    contactId: row.contact_id == null ? null : Number(row.contact_id),
  };
}

function loginKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function contactKeys(contact) {
  const words = String(contact.name || "").toLowerCase().split(/\s+/).filter(Boolean);
  const keys = new Set();
  const local = String(contact.email || "").split("@")[0];
  if (local) keys.add(loginKey(local));
  if (words.length) {
    keys.add(loginKey(words.join("")));
    keys.add(loginKey(words[0]));
    if (words.length > 1) {
      const last = words[words.length - 1];
      keys.add(loginKey(`${words[0][0]}${last}`));
      keys.add(loginKey(`${words[0]}${last[0]}`));
    }
  }
  return [...keys].filter((key) => key.length >= 3);
}

function suggestContact(users, contacts) {
  const logins = (Array.isArray(users) ? users : [])
    .map((user) => loginKey(String(user).split("\\").pop().split("@")[0]))
    .filter((key) => key.length >= 3);
  if (!logins.length) return null;
  const matches = contacts.filter((contact) => contactKeys(contact).some((key) => logins.includes(key)));
  return matches.length === 1 ? matches[0] : null;
}

function assetsAllowed(row) {
  return ticketingAllowed(row) && remoteAccess(row).canRemote;
}

async function licenseFlags(orgId) {
  const license = await licenseQuery(orgId);
  const row = license.rows[0];
  return {
    row,
    canAssets: assetsAllowed(row),
    canMonitor: monitoringAllowed(row),
    canPatch: patchAllowed(row),
    canReport: reportingAllowed(row),
  };
}

async function setPrimaryContact(client, customerId, contactId) {
  await client.query("UPDATE contacts SET is_primary = false WHERE customer_id = $1 AND is_primary AND id <> $2", [customerId, contactId]);
  await client.query("UPDATE contacts SET is_primary = true, updated_at = now() WHERE id = $1", [contactId]);
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query(result?.rollback ? "ROLLBACK" : "COMMIT");
    return result;
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

function slaMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200) return null;
  return minutes;
}

async function orgSla(orgId, calendar = null) {
  const row = await pool.query(
    "SELECT response_minutes, resolve_minutes, priority_percent FROM org_slas WHERE org_id = $1",
    [orgId],
  );
  if (!row.rows[0]) return null;
  return withCalendar({
    responseMinutes: row.rows[0].response_minutes,
    resolveMinutes: row.rows[0].resolve_minutes,
    priorityPercent: percentFrom(row.rows[0].priority_percent),
  }, calendar);
}

// Non-enumerable so SLA targets sent to the console do not carry the calendar.
function withCalendar(targets, calendar) {
  return Object.defineProperty(targets, "calendar", { value: calendar, enumerable: false });
}

// null when business hours are off, so SLA clocks run around the clock.
async function deskCalendar(orgId) {
  const [hours, holidays] = await Promise.all([
    pool.query("SELECT enabled, hours FROM desk_business_hours WHERE org_id = $1", [orgId]),
    pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM desk_holidays WHERE org_id = $1", [orgId]),
  ]);
  const row = hours.rows[0];
  if (!row?.enabled) return null;
  return calendarFrom(row.hours, holidays.rows.map((item) => item.day));
}

async function slaBook(orgId) {
  const calendar = await deskCalendar(orgId);
  const [base, plans] = await Promise.all([
    orgSla(orgId, calendar),
    pool.query(
      "SELECT id, name, response_minutes, resolve_minutes, priority_percent FROM sla_plans WHERE org_id = $1 ORDER BY lower(name)",
      [orgId],
    ),
  ]);
  return {
    base,
    calendar,
    plans: new Map(plans.rows.map((row) => [String(row.id), withCalendar({
      id: Number(row.id),
      name: row.name,
      responseMinutes: row.response_minutes,
      resolveMinutes: row.resolve_minutes,
      priorityPercent: percentFrom(row.priority_percent),
    }, calendar)])),
  };
}

function slaClock(row, targets, now) {
  return ticketClock(row, targets, now);
}

// Columns the SLA engine reads from a ticket row (alias t).
const TICKET_SLA_COLUMNS = "t.priority, t.due_at, t.sla_paused_at, t.sla_pauses";

const TICKET_CLOCK_SQL = `
  ${TICKET_SLA_COLUMNS},
  (
    SELECT MIN(tc.created_at)
    FROM ticket_comments tc
    JOIN users u ON u.id = tc.author_user_id AND u.org_id = t.org_id
    WHERE tc.ticket_id = t.id AND tc.kind = 'reply'
  ) AS first_response_at,
  (
    SELECT MIN(e.created_at)
    FROM audit_events e
    WHERE e.action = 'ticket.update'
      AND e.target_type = 'ticket'
      AND e.target_id = t.id::text
      AND e.detail->>'status' = 'resolved'
  ) AS resolved_at`;

let linuxReleaseCache = { at: 0, value: null };
const LINUX_ARCHES = ["amd64", "arm64"];

async function linuxRelease() {
  if (Date.now() - linuxReleaseCache.at < 60000) return linuxReleaseCache.value;
  let value = null;
  try {
    const raw = JSON.parse(await readFile(join(AGENT_BIN_DIR, "linux", "linux.json"), "utf8"));
    if (versionParts(raw.version)) {
      const sha256 = {};
      for (const arch of LINUX_ARCHES) {
        const data = await readFile(join(AGENT_BIN_DIR, "linux", `df-agent-${arch}`)).catch(() => null);
        if (data) sha256[arch] = createHash("sha256").update(data).digest("hex");
      }
      value = { version: raw.version, sha256 };
    }
  } catch {
    value = null;
  }
  linuxReleaseCache = { at: Date.now(), value };
  return value;
}

async function agentReleases() {
  const [windows, linux] = await Promise.all([agentRelease(), linuxRelease()]);
  return { windows: windows?.version || "", linux: linux?.version || "" };
}

function platformOf(osName) {
  if (/windows/i.test(osName || "")) return "windows";
  return osFamily(osName) === "Linux" ? "linux" : "";
}

async function releaseFor(osName) {
  const platform = platformOf(osName);
  if (platform === "windows") return agentRelease();
  if (platform === "linux") return linuxRelease();
  return null;
}

// Linux agents run unprivileged and cannot replace themselves, so the update runs as root through
// the remote desktop agent. The script fetches the binary with a one-time ticket and checks its hash.
function linuxUpdateScript(ticket, release, units) {
  const link = `https://api.digitalfingers.co.za/v1/agent/update/linux?t=${ticket}&arch=`;
  const unit = (name) => Buffer.from(units[name]).toString("base64");
  return [
    "set -e",
    `case "$(uname -m)" in x86_64|amd64) a=amd64; h=${release.sha256.amd64 || "none"};; aarch64|arm64) a=arm64; h=${release.sha256.arm64 || "none"};; *) echo unsupported; exit 1;; esac`,
    "f=$(mktemp /usr/local/bin/.df-agent.XXXXXX)",
    `trap 'rm -f "$f"' EXIT`,
    `if command -v curl >/dev/null 2>&1; then curl -fsS -o "$f" "${link}$a"; else wget -qO "$f" "${link}$a"; fi`,
    `echo "$h  $f" | sha256sum -c --status`,
    `chmod 755 "$f"; chown root:root "$f"; mv -f "$f" /usr/local/bin/df-agent`,
    "getent group dfagent >/dev/null 2>&1 || groupadd --system dfagent",
    "id dfagent >/dev/null 2>&1 || useradd --system --gid dfagent --no-create-home --home-dir /var/lib/df-agent --shell /usr/sbin/nologin dfagent",
    "install -d -m 700 -o dfagent -g dfagent /var/lib/df-agent; chown -R dfagent:dfagent /var/lib/df-agent",
    "[ -f /etc/df-agent.env ] || printf 'DF_API_URL=https://api.digitalfingers.co.za\\n' > /etc/df-agent.env",
    "chown root:dfagent /etc/df-agent.env; chmod 640 /etc/df-agent.env",
    `echo ${unit("df-agent.service")} | base64 -d > /etc/systemd/system/df-agent.service`,
    `echo ${unit("df-patch-helper.service")} | base64 -d > /etc/systemd/system/df-patch-helper.service`,
    "rm -f /usr/local/sbin/df-patch-helper.py",
    "if command -v restorecon >/dev/null 2>&1; then restorecon -F /usr/local/bin/df-agent /etc/df-agent.env /etc/systemd/system/df-agent.service /etc/systemd/system/df-patch-helper.service || true; fi",
    "systemctl daemon-reload",
    "systemctl enable df-patch-helper df-agent >/dev/null 2>&1 || true",
    "systemctl restart df-patch-helper df-agent",
  ].join("\n");
}

async function fileDate(...parts) {
  const info = await stat(join(...parts)).catch(() => null);
  return info?.isFile() ? info.mtime.toISOString() : null;
}

// The control panel's System page: agent releases, the fleet across every tenant, and service health.
async function systemOverview() {
  const [windows, linux, devices, offers, recent, pending] = await Promise.all([
    agentRelease(),
    linuxRelease(),
    pool.query("SELECT os_name, agent_version, last_seen_at FROM devices"),
    pool.query(
      `SELECT count(*)::int AS count, max(created_at) AS last FROM audit_events
       WHERE action = 'agent.update.offer' AND created_at > now() - interval '24 hours'`,
    ),
    pool.query(
      `SELECT e.action, e.detail, e.created_at, o.name AS org_name, d.hostname, u.email AS actor
       FROM audit_events e
       LEFT JOIN orgs o ON o.id = e.org_id
       LEFT JOIN devices d ON e.target_type = 'device' AND d.id::text = e.target_id
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.action LIKE 'agent.update.%'
       ORDER BY e.created_at DESC LIMIT 15`,
    ),
    pool.query("SELECT count(*)::int AS count FROM devices WHERE agent_update_requested_at IS NOT NULL"),
  ]);
  const staged = await stat(join(AGENT_BIN_DIR, "next", "DigitalFingersAgent.exe")).catch(() => null);
  const redisOk = await redis.ping().then((reply) => reply === "PONG").catch(() => false);
  const geoPath = process.env.GEOIP_DB || "/var/lib/GeoIP/GeoLite2-City.mmdb";
  const releases = { windows: windows?.version || "", linux: linux?.version || "" };
  const online = devices.rows.filter((row) => row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 60000).length;
  return {
    releases: {
      windows: windows
        ? { version: windows.version, publishedAt: await fileDate(AGENT_BIN_DIR, "windows.json"), sha256: windows.sha256 }
        : null,
      windowsStaged: staged?.isFile() ? { stagedAt: staged.mtime.toISOString(), bytes: staged.size } : null,
      linux: linux
        ? {
            version: linux.version,
            publishedAt: await fileDate(AGENT_BIN_DIR, "linux", "linux.json"),
            arches: LINUX_ARCHES.filter((arch) => linux.sha256?.[arch]),
          }
        : null,
    },
    fleet: {
      total: devices.rows.length,
      online,
      platforms: fleetVersions(devices.rows.map((row) => ({ platform: platformOf(row.os_name), agent_version: row.agent_version })), releases),
    },
    updates: {
      autoUpdate: AGENT_AUTO_UPDATE,
      offersToday: offers.rows[0]?.count || 0,
      lastOfferAt: offers.rows[0]?.last || null,
      waiting: pending.rows[0]?.count || 0,
      recent: recent.rows.map((row) => ({
        action: row.action.replace("agent.update.", ""),
        at: row.created_at,
        org: row.org_name || "",
        device: row.hostname || "",
        actor: row.actor || "",
        from: row.detail?.from || "",
        to: row.detail?.to || row.detail?.toLinux || "",
        platform: row.detail?.platform || "",
        count: Array.isArray(row.detail?.devices) ? row.detail.devices.length + (row.detail.linux?.length || 0) : null,
        error: row.detail?.error || row.detail?.reason || "",
        legacy: row.detail?.legacy === true,
      })),
    },
    services: {
      postgres: true,
      redis: redisOk,
      geoip: { loaded: geo.available(), updatedAt: await fileDate(geoPath) },
      apiStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      node: process.version,
    },
    generatedAt: new Date().toISOString(),
  };
}

// Returns null when sent, or the reason it could not be.
async function sendLinuxUpdate(row, orgId, release) {
  if (!LINUX_ARCHES.some((arch) => release.sha256?.[arch])) return "No Linux agent build is published yet.";
  const units = {};
  for (const name of ["df-agent.service", "df-patch-helper.service"]) {
    units[name] = await readFile(join(AGENT_BIN_DIR, "linux", name), "utf8").catch(() => "");
    if (!units[name]) return "The Linux agent files are incomplete on the server.";
  }
  let node;
  try {
    node = await resolveMeshNode(row, orgId);
  } catch {
    return "The remote service did not answer.";
  }
  if (!node.nodeId) return "The remote desktop agent is not installed on this device, so the update must be installed by hand.";
  if (!node.online) return "The remote desktop agent on this device is offline. Try again when it is online.";
  const ticket = randomBytes(24).toString("base64url");
  await redis.set(`agent-download-linux:${ticket}`, String(row.id), "EX", 1800);
  try {
    await meshControl(["RunCommand", "--id", node.nodeId, "--run", linuxUpdateScript(ticket, release, units)]);
  } catch {
    await redis.del(`agent-download-linux:${ticket}`);
    return "The remote service did not accept the update.";
  }
  return null;
}

// customer: null for every customer, "none" for devices without one, or a customer id.
function customerScope(value) {
  if (value === "none") return "none";
  return /^\d{1,18}$/.test(String(value || "")) ? String(value) : null;
}

async function fleetItems(orgId, { patch = false, customer = null } = {}) {
  const [fleet, succeeded, releases] = await Promise.all([
    pool.query(
      `SELECT d.id, d.hostname, d.display_name, d.os_name, d.os_version, d.os_build, d.last_seen_at,
              d.agent_version, d.metrics, d.ipv4, d.public_ip, d.users, d.geo_country, d.geo_country_name,
              d.geo_region, d.geo_city, d.geo_updated_at, d.site_override, d.remote_agent,
              ${patch ? "d.updates, d.software," : ""}
              c.id AS customer_id, c.name AS customer_name
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE d.org_id = $1
         AND ($2::text IS NULL OR ($2 = 'none' AND c.id IS NULL) OR c.id::text = $2)
       ORDER BY d.hostname`,
      [orgId, customer],
    ),
    patch
      ? pool.query("SELECT device_id, package_name FROM patch_deploys WHERE org_id = $1 AND status = 'succeeded'", [orgId])
      : { rows: [] },
    agentReleases(),
  ]);
  const done = new Map();
  for (const item of succeeded.rows) {
    const key = String(item.device_id);
    done.set(key, [...(done.get(key) || []), item.package_name]);
  }
  const now = Date.now();
  const items = fleet.rows.map((row) => {
    if (patch) {
      const state = patchState(row.updates, row.software, done.get(String(row.id)) || []);
      row.missing = state.missing.length;
      row.patched = state.patched.length;
      row.missing_names = state.missing;
      delete row.software;
    }
    return { row, facts: deviceFacts(row, { now, releases }) };
  });
  return { items, releases };
}

let snapshotsRunning = false;

async function writeDailySnapshots() {
  if (snapshotsRunning) return;
  snapshotsRunning = true;
  try {
    const due = await pool.query(
      `SELECT o.id, (now() AT TIME ZONE 'Africa/Johannesburg')::date::text AS day
       FROM orgs o
       WHERE NOT EXISTS (
         SELECT 1 FROM device_daily_stats s
         WHERE s.org_id = o.id AND s.customer_id IS NULL
           AND s.day = (now() AT TIME ZONE 'Africa/Johannesburg')::date
           AND s.build_counts IS NOT NULL
       )`,
    );
    for (const org of due.rows) {
      const [fleet, succeeded] = await Promise.all([
        pool.query(
          `SELECT d.id, d.last_seen_at, d.agent_version, d.os_name, d.os_version, d.updates, d.software,
                  d.geo_country, d.geo_region, d.geo_updated_at, s.customer_id
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           WHERE d.org_id = $1`,
          [org.id],
        ),
        pool.query(
          "SELECT device_id, package_name FROM patch_deploys WHERE org_id = $1 AND status = 'succeeded'",
          [org.id],
        ),
      ]);
      const done = new Map();
      for (const row of succeeded.rows) {
        const key = String(row.device_id);
        done.set(key, [...(done.get(key) || []), row.package_name]);
      }
      const devices = fleet.rows.map((device) => {
        const state = patchState(device.updates, device.software, done.get(String(device.id)) || []);
        return { ...device, patched: state.patched.length, missing: state.missing.length, scanned: Array.isArray(device.updates) };
      });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [key, stats] of dailyStats(devices)) {
          // Rows from before build and compliance counts existed are completed once, then left alone.
          await client.query(
            `INSERT INTO device_daily_stats
               (org_id, customer_id, day, device_count, online_count, seen_day_count, agent_versions,
                os_counts, country_counts, region_counts, patched_count, missing_count,
                build_counts, scanned_count, compliant_count)
             VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (org_id, customer_id, day) DO UPDATE
               SET build_counts = EXCLUDED.build_counts, scanned_count = EXCLUDED.scanned_count,
                   compliant_count = EXCLUDED.compliant_count
               WHERE device_daily_stats.build_counts IS NULL`,
            [
              org.id, key === "all" ? null : Number(key), org.day, stats.deviceCount, stats.onlineCount,
              stats.seenDayCount, stats.agentVersions, stats.osCounts, stats.countryCounts,
              stats.regionCounts, stats.patchedCount, stats.missingCount,
              stats.buildCounts, stats.scannedCount, stats.compliantCount,
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error(`daily snapshots: ${error.message}`);
  } finally {
    snapshotsRunning = false;
  }
}

async function dashboardSnapshot(orgId) {
  const license = await licenseQuery(orgId);
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
      `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, c.sla_plan_id, ${TICKET_CLOCK_SQL}
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
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
  const book = await slaBook(orgId);
  const sla = book.base;
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
      clock: slaClock(ticket, slaFor(book, ticket.sla_plan_id), now),
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
      const license = await licenseQuery(schedule.org_id);
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

const LOCAL_DAY_START = "($X::date::timestamp AT TIME ZONE 'Africa/Johannesburg')";

function localRange(fromParam, toParam) {
  return [
    LOCAL_DAY_START.replace("$X", fromParam),
    LOCAL_DAY_START.replace("$X::date", `(${toParam}::date + 1)`),
  ];
}

async function snapshotTrend(orgId, customerId, from, to) {
  const rows = await pool.query(
    `SELECT day::text AS day, agent_versions, os_counts, build_counts, scanned_count, compliant_count, device_count
     FROM device_daily_stats
     WHERE org_id = $1 AND customer_id IS NOT DISTINCT FROM $2 AND day BETWEEN $3::date AND $4::date
     ORDER BY day`,
    [orgId, customerId, from, to],
  );
  return fillDays(rows.rows, from, to);
}

function customerSql(column, param) {
  return `($${param}::text IS NULL OR ($${param} = 'none' AND ${column} IS NULL) OR ${column}::text = $${param})`;
}

// scope: { orgId, customer (null | "none" | id), from, to, drill, license }
async function reportData(key, scope) {
  const { orgId, customer, from, to } = scope;
  const [start, end] = localRange("$3", "$4");
  if (key === "agents" || key === "os") {
    const { items, releases } = await fleetItems(orgId, { customer });
    const trend = customer === "none" ? fillDays([], from, to) : await snapshotTrend(orgId, customer ? Number(customer) : null, from, to);
    return { trend, items, releases, versions: overviewFrom(items, { releases }).agents.versions };
  }
  if (key === "locations") {
    const { items } = await fleetItems(orgId, { customer });
    return { items, drill: scope.drill };
  }
  if (key === "patches") {
    const { items } = await fleetItems(orgId, { patch: true, customer });
    const trends = [];
    if (customer && customer !== "none") {
      trends.push({ id: customer, name: scope.customerName, days: await snapshotTrend(orgId, Number(customer), from, to) });
    } else if (!customer) {
      trends.push({ id: "all", name: "All customers", days: await snapshotTrend(orgId, null, from, to) });
      const top = await pool.query(
        `SELECT c.id, c.name FROM customers c
         JOIN device_daily_stats s ON s.customer_id = c.id AND s.org_id = c.org_id
         WHERE c.org_id = $1 AND s.day BETWEEN $2::date AND $3::date
         GROUP BY c.id, c.name ORDER BY max(s.device_count) DESC, lower(c.name) LIMIT 5`,
        [orgId, from, to],
      );
      for (const row of top.rows) trends.push({ id: String(row.id), name: row.name, days: await snapshotTrend(orgId, Number(row.id), from, to) });
    } else {
      trends.push({ id: "none", name: "No customer", days: fillDays([], from, to) });
    }
    const missing = [];
    for (const { row } of items) {
      const details = new Map((Array.isArray(row.updates) ? row.updates : []).map((update) => [String(update?.name || "").trim(), update]));
      for (const name of row.missing_names || []) {
        const update = details.get(name) || {};
        missing.push({
          device: row.display_name || row.hostname,
          customer: row.customer_name || "No customer",
          name,
          kb: update.kb ? (String(update.kb).toUpperCase().startsWith("KB") ? update.kb : `KB${update.kb}`) : "",
          category: update.category || "",
          severity: update.severity || "",
          _id: Number(row.id),
        });
      }
    }
    missing.sort((a, b) => a.device.localeCompare(b.device) || a.name.localeCompare(b.name));
    return { items, trends, missing };
  }
  if (key === "uptime") {
    const params = [orgId, customer, from, to];
    const [devices, daily, since] = await Promise.all([
      pool.query(
        `SELECT d.id, COALESCE(d.display_name, d.hostname) AS name, c.name AS customer,
                sum(u.checks)::int AS checks, sum(u.online_checks)::int AS online, count(*)::int AS days
         FROM device_uptime_daily u
         JOIN devices d ON d.id = u.device_id AND d.org_id = u.org_id
         LEFT JOIN sites s ON s.id = d.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE u.org_id = $1 AND ${customerSql("c.id", 2)} AND u.day BETWEEN $3::date AND $4::date
         GROUP BY d.id, d.display_name, d.hostname, c.name`,
        params,
      ),
      pool.query(
        `SELECT u.day::text AS day, sum(u.checks)::int AS checks, sum(u.online_checks)::int AS online
         FROM device_uptime_daily u
         JOIN devices d ON d.id = u.device_id AND d.org_id = u.org_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE u.org_id = $1 AND ${customerSql("s.customer_id", 2)} AND u.day BETWEEN $3::date AND $4::date
         GROUP BY u.day`,
        params,
      ),
      pool.query("SELECT min(day)::text AS since FROM device_uptime_daily WHERE org_id = $1", [orgId]),
    ]);
    return { devices: devices.rows, daily: daily.rows, since: since.rows[0]?.since || null };
  }
  if (key === "sessions") {
    const rows = await pool.query(
      `SELECT rs.status, rs.started_at, rs.connected_at, rs.last_seen_at, rs.ended_at, rs.ticket_id,
              u.name AS technician, c.name AS customer, rs.device_name AS device, 'Remote Desk' AS kind,
              rs.ticket_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM ticket_time_entries te
                WHERE te.ticket_id = rs.ticket_id AND te.org_id = rs.org_id AND te.billable
              ) AS billable
       FROM remote_sessions rs
       LEFT JOIN users u ON u.id = rs.user_id
       LEFT JOIN customers c ON c.id = rs.customer_id AND c.org_id = rs.org_id
       WHERE rs.org_id = $1 AND ${customerSql("rs.customer_id", 2)}
         AND rs.started_at >= ${start} AND rs.started_at < ${end}
       UNION ALL
       SELECT CASE WHEN ss.ended_at IS NULL THEN 'live' ELSE 'ended' END, ss.joined_at, ss.joined_at, NULL, ss.ended_at, ss.ticket_id,
              u.name, c.name, COALESCE(ss.hostname, 'Support session'), 'Support code',
              ss.ticket_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM ticket_time_entries te
                WHERE te.ticket_id = ss.ticket_id AND te.org_id = ss.org_id AND te.billable
              )
       FROM support_sessions ss
       LEFT JOIN users u ON u.id = ss.created_by
       LEFT JOIN tickets t ON t.id = ss.ticket_id AND t.org_id = ss.org_id
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ss.org_id = $1 AND ss.joined_at IS NOT NULL AND ${customerSql("t.customer_id", 2)}
         AND ss.joined_at >= ${start} AND ss.joined_at < ${end}`,
      [orgId, customer, from, to],
    );
    return { sessions: rows.rows };
  }
  if (key === "service-desk") {
    const params = [orgId, customer, from, to];
    const [tickets, resolved, time, book, ratings] = await Promise.all([
      pool.query(
        `SELECT t.id, t.status, t.created_at, t.updated_at, c.name AS customer, c.sla_plan_id, ${TICKET_CLOCK_SQL}
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         WHERE t.org_id = $1 AND t.merged_into_id IS NULL AND ${customerSql("c.id", 2)}
           AND t.created_at >= ${start} AND t.created_at < ${end}`,
        params,
      ),
      pool.query(
        `SELECT (COALESCE(r.resolved_at, r.updated_at) AT TIME ZONE 'Africa/Johannesburg')::date::text AS day, count(*)::int AS count
         FROM (
           SELECT t.updated_at, ${TICKET_CLOCK_SQL}
           FROM tickets t
           WHERE t.org_id = $1 AND t.status = 'resolved' AND t.merged_into_id IS NULL AND ${customerSql("t.customer_id", 2)}
         ) r
         WHERE COALESCE(r.resolved_at, r.updated_at) >= ${start} AND COALESCE(r.resolved_at, r.updated_at) < ${end}
         GROUP BY 1`,
        params,
      ),
      pool.query(
        `SELECT c.name AS customer, te.minutes, te.billable
         FROM ticket_time_entries te
         JOIN tickets t ON t.id = te.ticket_id AND t.org_id = te.org_id
         JOIN customers c ON c.id = t.customer_id
         WHERE te.org_id = $1 AND ${customerSql("c.id", 2)}
           AND COALESCE(te.started_at, te.created_at) >= ${start} AND COALESCE(te.started_at, te.created_at) < ${end}`,
        params,
      ),
      slaBook(orgId),
      pool.query(
        `SELECT c.name AS customer, r.rating
         FROM ticket_ratings r
         JOIN tickets t ON t.id = r.ticket_id
         JOIN customers c ON c.id = t.customer_id
         WHERE r.org_id = $1 AND ${customerSql("c.id", 2)}
           AND r.updated_at >= ${start} AND r.updated_at < ${end}`,
        params,
      ),
    ]);
    return {
      tickets: tickets.rows.map((row) => {
        const sla = slaFor(book, row.sla_plan_id);
        return { ...row, response_target: sla?.responseMinutes || null, resolve_target: sla?.resolveMinutes || null };
      }),
      resolved: resolved.rows,
      time: time.rows,
      ratings: ratings.rows,
    };
  }
  throw new Error(`unknown report ${key}`);
}

async function customerName(orgId, customer) {
  if (customer == null) return "All customers";
  if (customer === "none") return "No customer";
  const row = await pool.query("SELECT name FROM customers WHERE id = $1 AND org_id = $2", [customer, orgId]);
  return row.rows[0]?.name || null;
}

// Throws { status } for a bad customer or a report the package does not include.
async function makeReport(key, { orgId, orgName, customer, from, to, drill, license }) {
  const meta = reportByKey(key);
  if (!meta) throw Object.assign(new Error("Report not found."), { status: 404 });
  if (meta.needs === "ticketing" && !ticketingAllowed(license)) {
    throw Object.assign(new Error("Service Desk reports need Service Desk in your package."), { status: 403 });
  }
  const name = await customerName(orgId, customer);
  if (name == null) throw Object.assign(new Error("Customer not found."), { status: 404 });
  const data = await reportData(key, { orgId, customer, from, to, drill, customerName: name });
  return buildReport(key, data, { from, to, customerName: name, orgName, now: Date.now() });
}

function reportFileName(report, extension) {
  const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${[slug(report.title), report.customerName === "All customers" ? "" : slug(report.customerName), report.from, report.to].filter(Boolean).join("_")}.${extension}`;
}

// 07:00 South African time on the 1st of next month.
function nextMonthlyRun(now = Date.now()) {
  const today = localDay(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return new Date(Date.UTC(year, month, 1, 5, 0, 0));
}

async function deliverSubscription(sub, { period } = {}) {
  const range = period || previousMonth();
  const license = (await licenseQuery(sub.org_id)).rows[0];
  const log = async (status, detail, bytes = null) => {
    await pool.query(
      `INSERT INTO report_deliveries (org_id, subscription_id, report_key, customer_id, email, period_from, period_to, status, detail, pdf_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [sub.org_id, sub.id, sub.report_key, sub.customer_id, sub.email, range.from, range.to, status, detail, bytes],
    );
    await writeAudit(sub.org_id, sub.actor_id || null, "report.email", "report_subscription", String(sub.id), {
      report: sub.report_key, status, from: range.from, to: range.to,
    });
    return { status, detail };
  };
  if (!reportingAllowed(license)) return log("skipped", "Reports is not in the package.");
  let report;
  try {
    const org = await pool.query("SELECT name FROM orgs WHERE id = $1", [sub.org_id]);
    report = await makeReport(sub.report_key, {
      orgId: sub.org_id,
      orgName: org.rows[0]?.name || "",
      customer: sub.customer_id == null ? null : String(sub.customer_id),
      from: range.from,
      to: range.to,
      drill: {},
      license,
    });
  } catch (error) {
    return log("skipped", error.status ? error.message : "The report could not be built.");
  }
  const pdf = reportPdf(report);
  const month = new Date(`${range.from}T12:00:00Z`).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
  try {
    const sent = await sendMail({
      to: sub.email,
      subject: `${report.title} report for ${report.customerName}, ${month}`,
      text: [
        `Hello${sub.contact_name ? ` ${sub.contact_name}` : ""},`,
        "",
        `Attached is the ${report.title} report for ${report.customerName} for ${month}.`,
        "",
        report.orgName || "Digital Fingers",
      ].join("\n"),
      attachments: [{ filename: reportFileName(report, "pdf"), contentType: "application/pdf", content: pdf }],
    });
    if (!sent) return log("failed", "Email is not set up on the server.", pdf.length);
    return log("sent", null, pdf.length);
  } catch (error) {
    return log("failed", `The mail server did not accept the message (${String(error.message).slice(0, 80)}).`, pdf.length);
  }
}

let subscriptionTickRunning = false;

async function runDueSubscriptions() {
  if (subscriptionTickRunning) return;
  subscriptionTickRunning = true;
  try {
    for (let i = 0; i < 20; i += 1) {
      const claimed = await pool.query(
        `UPDATE report_subscriptions rs
         SET next_run_at = $1
         FROM (
           SELECT id FROM report_subscriptions
           WHERE paused_at IS NULL AND next_run_at <= now()
           ORDER BY next_run_at, id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         ) due
         WHERE rs.id = due.id
         RETURNING rs.*, (SELECT name FROM contacts ct WHERE ct.id = rs.contact_id) AS contact_name`,
        [nextMonthlyRun()],
      );
      if (!claimed.rows[0]) break;
      await deliverSubscription(claimed.rows[0]).catch((error) => console.error(`report email: ${error.message}`));
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    subscriptionTickRunning = false;
  }
}

async function writeAudit(orgId, actorId, action, targetType, targetId, detail, db = pool) {
  await insertAudit(db, orgId, actorId, action, targetType, targetId, detail);
}

// Ticket history is part of the timeline store; this returns the new event's id.
async function ticketEvent(orgId, ticketId, kind, { actorId = null, label = null, detail = {}, db = pool } = {}) {
  return recordActivity(db, orgId, {
    ...activityFromTicketEvent(kind, detail),
    ticketId: Number(ticketId),
    ...ticketActor(kind, actorId, label),
  });
}

async function ticketChangeEvents(orgId, ticketId, before, after, options) {
  for (const change of ticketChanges(before, after)) {
    await ticketEvent(orgId, ticketId, change.kind, { ...options, detail: { from: change.from, to: change.to } });
  }
}

async function ticketListRows(orgId) {
  const [tickets, book] = await Promise.all([
    pool.query(
      `SELECT t.id, t.subject, t.status, t.priority, t.customer_id, c.name AS customer_name, c.sla_plan_id,
              ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
              t.device_id, d.hostname AS device_hostname, t.assignee_user_id,
              u.name AS assignee_name, u.email AS assignee_email, t.created_at, t.updated_at,
              t.category, t.tags, t.merged_into_id, ${TICKET_SLA_COLUMNS}, t.status_id, st.name AS status_label,
              (SELECT count(*)::int FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count,
              GREATEST(t.updated_at, (SELECT max(tc.created_at) FROM ticket_comments tc WHERE tc.ticket_id = t.id)) AS last_activity_at,
              (SELECT MIN(tc.created_at)
               FROM ticket_comments tc
               JOIN users ru ON ru.id = tc.author_user_id AND ru.org_id = t.org_id
               WHERE tc.ticket_id = t.id AND tc.kind = 'reply') AS first_response_at,
              COALESCE(t.channel, CASE
                WHEN EXISTS (SELECT 1 FROM alerts a WHERE a.ticket_id = t.id) THEN 'alert'
                WHEN EXISTS (SELECT 1 FROM support_sessions ss WHERE ss.ticket_id = t.id) THEN 'support'
                WHEN t.created_by IS NULL THEN 'automatic'
                ELSE 'console'
              END) AS channel
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN devices d ON d.id = t.device_id
       LEFT JOIN users u ON u.id = t.assignee_user_id
       LEFT JOIN desk_statuses st ON st.id = t.status_id
       ${TICKET_CONTACT_JOIN}
       WHERE t.org_id = $1
       ORDER BY t.id DESC
       LIMIT ${EXPORT_LIMIT}`,
      [orgId],
    ),
    slaBook(orgId),
  ]);
  const now = new Date();
  return tickets.rows.map((row) => {
    const targets = slaFor(book, row.sla_plan_id);
    const due = ticketDue(row, targets);
    const view = ticketView(row);
    return {
      ...view,
      commentCount: row.comment_count,
      lastActivityAt: row.last_activity_at || row.updated_at,
      dueAt: due ? due.toISOString() : null,
      overdue: isOverdue(row, targets, now),
      channel: row.channel,
      category: row.category || null,
      tags: row.tags || [],
      mergedIntoId: row.merged_into_id == null ? null : Number(row.merged_into_id),
      dueOverridden: row.due_at != null,
      sla: slaState(row, targets, now),
    };
  });
}

const ATTACHMENT_DIR = process.env.ATTACHMENT_DIR || "/var/lib/df-api/attachments";

function attachmentView(row) {
  return {
    id: Number(row.id),
    name: row.file_name,
    contentType: row.content_type,
    isImage: row.is_image,
    size: row.size_bytes,
  };
}

async function linkAttachments(client, actor, ticketId, commentId, ids) {
  if (ids.length === 0) return true;
  const linked = await client.query(
    `UPDATE ticket_attachments
     SET ticket_id = $1, comment_id = $2, linked_at = now()
     WHERE id = ANY($3::bigint[]) AND org_id = $4 AND uploaded_by = $5 AND linked_at IS NULL
       AND (ticket_id IS NULL OR ticket_id = $1)
     RETURNING id`,
    [ticketId, commentId, ids, actor.org_id, actor.id],
  );
  return linked.rows.length === ids.length;
}

function idsFromEvents(rows, kinds, key) {
  const ids = new Set();
  for (const row of rows) {
    if (!kinds.includes(row.kind)) continue;
    for (const value of key === "deviceId" && row.kind === "device" ? [row.detail.from, row.detail.to] : [row.detail[key]]) {
      const id = Number(value);
      if (value != null && Number.isInteger(id)) ids.add(id);
    }
  }
  return [...ids];
}

async function ticketTimeline(orgId, ticketId, comments) {
  const timeline = ticketTimelineQuery(orgId, ticketId);
  const [events, attachments, users] = await Promise.all([
    pool.query(timeline.text, timeline.values),
    pool.query(
      `SELECT id, comment_id, file_name, content_type, is_image, size_bytes
       FROM ticket_attachments
       WHERE ticket_id = $1 AND org_id = $2 AND linked_at IS NOT NULL
       ORDER BY id`,
      [ticketId, orgId],
    ),
    pool.query("SELECT id, name FROM users WHERE org_id = $1", [orgId]),
  ]);
  for (const row of events.rows) {
    if (String(row.ticket_id) !== String(ticketId)) row.detail = { ...row.detail, mergedFrom: Number(row.ticket_id) };
  }
  const contactIds = events.rows
    .filter((row) => row.kind === "contact")
    .flatMap((row) => [row.detail.from, row.detail.to])
    .filter((value) => value != null)
    .map(Number);
  const deviceIds = [
    ...idsFromEvents(events.rows, ["device"], "deviceId"),
    ...idsFromEvents(events.rows, ["remote_start", "command"], "deviceId"),
  ];
  const [contacts, devices] = await Promise.all([
    pool.query("SELECT id, name FROM contacts WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, contactIds]),
    pool.query("SELECT id, COALESCE(display_name, hostname) AS name FROM devices WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, deviceIds]),
  ]);
  const byComment = new Map();
  for (const row of attachments.rows) {
    const key = Number(row.comment_id);
    if (!byComment.has(key)) byComment.set(key, []);
    byComment.get(key).push(attachmentView(row));
  }
  const lookups = {
    comments: new Map(comments.map((row) => [Number(row.id), row])),
    attachments: byComment,
    users: new Map(users.rows.map((row) => [Number(row.id), row.name])),
    contacts: new Map(contacts.rows.map((row) => [Number(row.id), row.name])),
    devices: new Map(devices.rows.map((row) => [Number(row.id), row.name])),
  };
  return events.rows.map((row) => timelineItem(row, lookups));
}

async function ticketTime(actor, ticketId) {
  const [entries, timer] = await Promise.all([
    pool.query(
      `SELECT te.id, te.minutes, te.billable, te.note, te.source, te.created_at, te.user_id, u.name AS user_name
       FROM ticket_time_entries te
       LEFT JOIN users u ON u.id = te.user_id
       WHERE te.ticket_id = $1 AND te.org_id = $2
       ORDER BY te.id DESC`,
      [ticketId, actor.org_id],
    ),
    pool.query("SELECT started_at FROM ticket_timers WHERE ticket_id = $1 AND user_id = $2", [ticketId, actor.id]),
  ]);
  return {
    ...timeTotals(entries.rows),
    timerStartedAt: timer.rows[0]?.started_at || null,
    entries: entries.rows.map((row) => ({
      id: Number(row.id),
      minutes: row.minutes,
      billable: row.billable,
      note: row.note,
      source: row.source,
      createdAt: row.created_at,
      userName: row.user_name || "Removed user",
      canDelete: Number(row.user_id) === Number(actor.id) || canOperate(actor),
    })),
  };
}

async function ticketInOrg(ticketId, orgId, db = pool) {
  const found = await db.query("SELECT id, customer_id FROM tickets WHERE id = $1 AND org_id = $2", [ticketId, orgId]);
  return found.rows[0] || null;
}

let ticketSessionSweepRunning = false;
const liveTicketSessions = new Set();

// A launch that never shows up in Mesh within 3 minutes is closed as "not connected".
async function trackRemoteSessions(rows, live) {
  const now = Date.now();
  for (const row of rows) {
    if (row.mesh_node_id && live[row.mesh_node_id]) {
      await pool.query(
        `UPDATE remote_sessions
         SET status = 'live', connected_at = COALESCE(connected_at, now()), last_seen_at = now()
         WHERE id = $1 AND status IN ('launched', 'live')`,
        [row.id],
      );
    } else if (row.status === "live") {
      await pool.query("UPDATE remote_sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'live'", [row.id]);
    } else if (now - new Date(row.started_at).getTime() >= 3 * 60000) {
      await pool.query("UPDATE remote_sessions SET status = 'ended', ended_at = started_at WHERE id = $1 AND status = 'launched'", [row.id]);
    }
  }
}

let uptimeSampleRunning = false;

async function sampleUptime() {
  if (uptimeSampleRunning) return;
  uptimeSampleRunning = true;
  try {
    await pool.query(
      `INSERT INTO device_uptime_daily (org_id, device_id, day, checks, online_checks)
       SELECT org_id, id, (now() AT TIME ZONE 'Africa/Johannesburg')::date, 1,
              CASE WHEN last_seen_at > now() - interval '60 seconds' THEN 1 ELSE 0 END
       FROM devices
       ON CONFLICT (device_id, day) DO UPDATE
         SET checks = device_uptime_daily.checks + 1,
             online_checks = device_uptime_daily.online_checks + EXCLUDED.online_checks`,
    );
  } catch (error) {
    console.error(`uptime sample: ${error.message}`);
  } finally {
    uptimeSampleRunning = false;
  }
}

// Mesh does not report when a viewer closes, so the end time is when the device stops showing a session.
async function sweepTicketSessions() {
  if (ticketSessionSweepRunning) return;
  ticketSessionSweepRunning = true;
  try {
    const open = await pool.query(
      `SELECT e.id, e.org_id, e.ticket_id, e.created_at, d.mesh_node_id
       FROM activity_events e
       JOIN devices d ON d.id = (e.payload->>'deviceId')::bigint AND d.org_id = e.org_id
       WHERE e.type = 'ticket.remote_start'
         AND e.created_at > now() - interval '12 hours'
         AND NOT (e.payload ? 'backfilled')
         AND NOT EXISTS (
           SELECT 1 FROM activity_events x
           WHERE x.org_id = e.org_id AND x.ticket_id = e.ticket_id AND x.type = 'ticket.remote_end'
             AND (x.payload->>'startEvent' = e.id::text OR (e.source = 'ticket_event' AND x.payload->>'startId' = e.source_id))
         )`,
    );
    const tracked = await pool.query(
      `SELECT rs.id, rs.status, rs.started_at, d.mesh_node_id
       FROM remote_sessions rs
       LEFT JOIN devices d ON d.id = rs.device_id AND d.org_id = rs.org_id
       WHERE rs.status IN ('launched', 'live')`,
    );
    if (open.rows.length === 0 && tracked.rows.length === 0) return;
    const live = await meshSessionList();
    await trackRemoteSessions(tracked.rows, live);
    const now = Date.now();
    for (const row of open.rows) {
      const key = String(row.id);
      if (row.mesh_node_id && live[row.mesh_node_id]) {
        liveTicketSessions.add(key);
        continue;
      }
      const age = now - new Date(row.created_at).getTime();
      if (!liveTicketSessions.has(key) && age < 3 * 60000) continue;
      liveTicketSessions.delete(key);
      await ticketEvent(row.org_id, row.ticket_id, "remote_end", {
        label: "Remote Desk",
        detail: { startEvent: Number(row.id), minutes: Math.max(1, Math.round(age / 60000)) },
      });
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    ticketSessionSweepRunning = false;
  }
}

async function sweepPendingAttachments() {
  try {
    const stale = await pool.query(
      "SELECT id, storage_key FROM ticket_attachments WHERE linked_at IS NULL AND created_at < now() - interval '1 day' LIMIT 200",
    );
    for (const row of stale.rows) {
      await rm(join(ATTACHMENT_DIR, row.storage_key), { force: true });
      await pool.query("DELETE FROM ticket_attachments WHERE id = $1 AND linked_at IS NULL", [row.id]);
    }
  } catch (error) {
    console.error(error.message);
  }
}

function platformHelpers() {
  return {
    send,
    readJson,
    requirePlatform,
    hashPassword,
    orgUsers,
    setUserRole,
    managersLeft,
    revokeUserSessions,
    expiryFrom,
    seatsLeft,
    parseTenantAdmin,
    parseUserInput,
    canOperate,
    USER_ROLES,
  };
}

function tokenHelpers() {
  return { send, readJson, requireActor, canOperate, clientAddress, addressAllowed, parseAllowlist, licenseQuery, hasApp, redis };
}

function migrationHelpers() {
  return { send, readJson, requirePlatform, ensureTenantMesh, meshControl, meshOk };
}

async function ticketingFor(orgId) {
  return ticketingAllowed((await licenseQuery(orgId)).rows[0]);
}

function csatKey() {
  return createHash("sha256").update(`csat:`).update(mfaKey()).digest();
}

function deskHelpers() {
  const helpers = {
    send, readJson, requireTicketing, canOperate, writeAudit, ticketEvent,
    sealSecret, openSecret, notifyNewTicket, ticketingFor, csatKey,
  };
  helpers.ticketResolved = (orgId, ticketId) => emailResolved(helpers, orgId, ticketId);
  return helpers;
}

function expiryFrom(value) {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: "expiresAt must be a date." };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const end = new Date(`${value}T23:59:59+02:00`);
    if (Number.isNaN(end.getTime())) return { error: "expiresAt must be a date." };
    return { value: end.toISOString() };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: "expiresAt must be a date." };
  return { value: parsed.toISOString() };
}

function parseTenantAdmin(body) {
  const name = typeof body.adminName === "string" ? body.adminName.trim() : "";
  const email = typeof body.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
  const password = typeof body.adminPassword === "string" ? body.adminPassword : "";
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { error: "Enter the first admin's name, email, and password." };
  }
  if (password.length < 8 || password.length > 200) return { error: "Use at least 8 characters." };
  return { value: { name, email, password } };
}

const USER_ROLES = ["owner", "admin", "tech"];

function parseUserInput(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!name || name.length > 120) return { error: "Enter the technician's full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  if (password.length < 8 || password.length > 200) return { error: "Use at least 8 characters for the password." };
  if (!USER_ROLES.includes(role)) return { error: "Choose a role." };
  return { value: { name, email, password, role } };
}

async function orgUsers(orgId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.account_number, u.created_at, u.disabled_at, u.mfa_enabled_at,
            COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.org_id = $1 AND u.is_platform_admin = false
     GROUP BY u.id
     ORDER BY u.disabled_at IS NOT NULL, u.name`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    accountNumber: Number(row.account_number || 900000000 + Number(row.id)),
    role: USER_ROLES.find((role) => row.roles.includes(role)) || "tech",
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    mfaEnabled: Boolean(row.mfa_enabled_at),
  }));
}

async function seatsLeft(client, orgId) {
  const license = await loadLicense(client, orgId);
  if (!license) return 0;
  const result = await client.query(
    "SELECT count(*)::int AS used FROM users u WHERE u.org_id = $1 AND u.is_platform_admin = false AND u.disabled_at IS NULL",
    [orgId],
  );
  return license.seats - result.rows[0].used;
}

async function setUserRole(client, orgId, userId, role) {
  await client.query(
    "DELETE FROM user_roles WHERE user_id = $1 AND role_id IN (SELECT id FROM roles WHERE org_id = $2)",
    [userId, orgId],
  );
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE org_id = $2 AND name = $3`,
    [userId, orgId, role],
  );
}

async function managersLeft(client, orgId) {
  const result = await client.query(
    `SELECT count(DISTINCT u.id)::int AS count
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.name IN ('owner', 'admin')
     WHERE u.org_id = $1 AND u.disabled_at IS NULL`,
    [orgId],
  );
  return result.rows[0].count;
}

const SUPPORT_JOIN_MINUTES = 15;
const SUPPORT_MAX_HOURS = 8;
const SUPPORT_LIVE = ["waiting", "connected"];
const SUPPORT_COLUMNS = `s.id, s.code, s.status, s.topic, s.customer_email, s.ticket_id, s.hostname, s.os_name, s.notes,
  s.created_at, s.expires_at, s.joined_at, s.ended_at, c.name AS created_by_name, e.name AS ended_by_name`;

function cleanHostname(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
}

function supportView(row) {
  return {
    id: String(row.id),
    code: SUPPORT_LIVE.includes(row.status) ? row.code : "",
    status: row.status,
    topic: row.topic || "",
    customerEmail: row.customer_email || "",
    ticketId: row.ticket_id ? String(row.ticket_id) : "",
    hostname: row.hostname || "",
    osName: row.os_name || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    joinedAt: row.joined_at,
    endedAt: row.ended_at,
    createdBy: row.created_by_name || "",
    endedBy: row.ended_by_name || "",
  };
}

function supportReason(row) {
  if (licenseExpired(row)) return "expired";
  if (row?.modules?.remote_support !== true) return "module";
  return null;
}

async function requireSupport(actor, res, options = {}) {
  if (!requireActor(actor, res)) return null;
  if (!actor.org_id) {
    send(res, 403, { error: "This account is not in an org." });
    return null;
  }
  const license = await licenseQuery(actor.org_id);
  const reason = supportReason(license.rows[0]);
  if (reason) {
    if (options.deny) {
      await writeAudit(actor.org_id, actor.id, "support.deny", "org", String(actor.org_id), { reason });
    }
    licenseDenied(res, license.rows[0], reason, "remote_support", "Remote support");
    return null;
  }
  return license.rows[0];
}

const REMOTE_OPERATE_LABELS = {
  terminal: "open a terminal",
  upload: "upload files",
  folder: "create folders",
  service: "change services",
  startup: "change startup items",
  process: "end processes",
};

async function requireRemote(actor, res, deviceId, operation) {
  const license = await licenseQuery(actor.org_id);
  const access = remoteAccess(license.rows[0]);
  if (!access.canRemote) {
    licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
    return false;
  }
  if (operation && !canOperate(actor)) {
    await writeAudit(actor.org_id, actor.id, `${operation}.deny`, "device", String(deviceId), { reason: "role" });
    send(res, 403, { error: `A technician cannot ${REMOTE_OPERATE_LABELS[operation]}.` });
    return false;
  }
  return true;
}

function supportGroupShortId(groupId) {
  const marker = "mesh//";
  return groupId.startsWith(marker) ? groupId.slice(marker.length) : "";
}

async function removeSupportGroup(groupId) {
  if (!groupId) return;
  try {
    await meshControl(["RemoveDeviceGroup", "--id", groupId]);
  } catch {
    // The group may already be gone; the session still ends.
  }
}

// Deleting the group neither closes the customer's support app nor its open desktop relay.
async function closeSupportApp(nodeId) {
  if (!nodeId) return;
  try {
    await meshControl(["RunCommand", "--id", nodeId, "--run", "taskkill /F /T /IM DigitalFingersQuickSupport*"]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch {
    // The app may already be closed; the group is still removed.
  }
}

async function finishSupportSession(row, status, actorId) {
  const done = await pool.query(
    `UPDATE support_sessions SET status = $2, ended_at = now(), ended_by = $3
     WHERE id = $1 AND status = ANY($4::text[]) RETURNING id`,
    [row.id, status, actorId || null, SUPPORT_LIVE],
  );
  if (!done.rows[0]) return false;
  await closeSupportApp(row.mesh_node_id);
  await removeSupportGroup(row.mesh_group_id);
  await writeAudit(row.org_id, actorId || null, `support.${status === "expired" ? "expire" : "end"}`, "support_session",
    String(row.id), { code: row.code, hostname: row.hostname || "" });
  return true;
}

let supportRefreshing = null;
const supportMisses = new Map();

async function refreshSupportSessions(orgId) {
  const live = await pool.query(
    `SELECT id, org_id, code, status, mesh_group_id, mesh_node_id, hostname, expires_at, joined_at, created_at
     FROM support_sessions WHERE status = ANY($1::text[]) ${orgId ? "AND org_id = $2" : ""}`,
    orgId ? [SUPPORT_LIVE, orgId] : [SUPPORT_LIVE],
  );
  if (!live.rows.length) return;
  let listed = null;
  try {
    listed = meshJson(await meshControl(["ListDevices", "--json"]));
  } catch {
    listed = null;
  }
  const now = Date.now();
  for (const row of live.rows) {
    const nodes = Array.isArray(listed)
      ? listed.filter((item) => item?.meshid === row.mesh_group_id || item?.groupname === `${SUPPORT_GROUP_NAME} ${row.code}`)
      : null;
    const online = nodes ? nodes.find((item) => (Number(item.conn) || 0) & 1) : null;
    if (row.status === "waiting") {
      if (online) {
        const joined = await pool.query(
          `UPDATE support_sessions SET status = 'connected', joined_at = now(), mesh_node_id = $2, hostname = $3, os_name = $4
           WHERE id = $1 AND status = 'waiting' RETURNING id`,
          [row.id, String(online._id || ""), String(online.name || "").slice(0, 120), String(online.osdesc || "").slice(0, 120)],
        );
        if (joined.rows[0]) await writeAudit(row.org_id, null, "support.join", "support_session", String(row.id), {
          code: row.code,
          hostname: String(online.name || "").slice(0, 120),
        });
      } else if (new Date(row.expires_at).getTime() < now) {
        await finishSupportSession(row, "expired", null);
      }
      continue;
    }
    const tooLong = new Date(row.joined_at || row.created_at).getTime() + SUPPORT_MAX_HOURS * 3600000 < now;
    const misses = nodes && !online ? (supportMisses.get(row.id) || 0) + 1 : 0;
    if (misses) supportMisses.set(row.id, misses);
    else supportMisses.delete(row.id);
    if (tooLong || misses >= 2) {
      supportMisses.delete(row.id);
      await finishSupportSession(row, "ended", null);
    }
  }
}

let supportOrphanCheckAt = 0;

async function removeSupportOrphans() {
  if (Date.now() - supportOrphanCheckAt < 60000) return;
  supportOrphanCheckAt = Date.now();
  const groups = meshJson(await meshControl(["ListDeviceGroups", "--json"]));
  if (!Array.isArray(groups)) return;
  const support = groups.filter((group) => String(group?.name || "").startsWith(`${SUPPORT_GROUP_NAME} `) && group?._id);
  if (!support.length) return;
  const live = await pool.query("SELECT code FROM support_sessions WHERE status = ANY($1::text[])", [SUPPORT_LIVE]);
  const keep = new Set(live.rows.map((row) => `${SUPPORT_GROUP_NAME} ${row.code}`));
  for (const group of support) {
    if (!keep.has(String(group.name))) await removeSupportGroup(String(group._id));
  }
}

function sweepSupport() {
  if (supportRefreshing) return supportRefreshing;
  supportRefreshing = refreshSupportSessions(null)
    .then(() => removeSupportOrphans())
    .catch((error) => console.error("support sweep failed", error))
    .finally(() => {
      supportRefreshing = null;
    });
  return supportRefreshing;
}

async function supportJoinLimited(req) {
  const key = `support-join:${clientAddress(req)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 600);
  return count > 30;
}

async function liveSupportByCode(code) {
  if (!/^\d{6}$/.test(code)) return null;
  const found = await pool.query(
    `SELECT s.id, s.org_id, s.code, s.status, s.topic, s.mesh_group_id, s.expires_at, o.name AS org_name, u.name AS tech_name
     FROM support_sessions s
     JOIN orgs o ON o.id = s.org_id
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.code = $1 AND s.status = 'waiting' AND s.expires_at > now()`,
    [code],
  );
  return found.rows[0] || null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  enterRequest(req, clientAddress(req));
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
      const limits = loginLimitKeys(req, email);
      const [ipFails, emailFails] = await redis.mget(limits.ip, limits.email);
      if (Number(ipFails) >= LOGIN_IP_LIMIT || Number(emailFails) >= LOGIN_EMAIL_LIMIT) {
        return send(res, 429, { error: "Too many sign-in attempts. Wait 15 minutes and try again." });
      }
      const found = await pool.query(
        `SELECT u.id, u.email, u.name, u.password_hash, u.is_platform_admin, u.disabled_at, u.org_id, u.mfa_enabled_at, u.platform_mfa_due_at,
                COALESCE(o.require_mfa, false) AS require_mfa, COALESCE(o.ip_allowlist, '{}') AS ip_allowlist
         FROM users u LEFT JOIN orgs o ON o.id = u.org_id
         WHERE u.email = $1`,
        [email],
      );
      const user = found.rows[0];
      const valid = await verifyPassword(password, user ? user.password_hash : await dummyPasswordHash());
      if (!user || !valid || user.disabled_at) {
        await redis.multi()
          .incr(limits.ip).expire(limits.ip, LOGIN_WINDOW_SECONDS)
          .incr(limits.email).expire(limits.email, LOGIN_WINDOW_SECONDS)
          .exec();
        return send(res, 401, { error: "Invalid email or password." });
      }
      await redis.del(limits.email);
      if (!user.is_platform_admin && !addressAllowed(clientAddress(req), user.ip_allowlist)) {
        await writeAudit(user.org_id, user.id, "login.ip_deny", "user", String(user.id), { address: clientAddress(req) });
        return send(res, 403, { error: "ip" });
      }
      if (user.mfa_enabled_at) {
        const mfaToken = randomBytes(32).toString("base64url");
        await redis.set(`mfa-pending:${mfaToken}`, JSON.stringify({ userId: user.id, tries: 0 }), "EX", MFA_PENDING_SECONDS);
        return send(res, 200, { mfaRequired: true, mfaToken });
      }
      return issueSession(res, user);
    }

    if (req.method === "POST" && url.pathname === "/v1/login/mfa") {
      const body = await readJson(req);
      const mfaToken = typeof body.mfaToken === "string" ? body.mfaToken : "";
      const key = `mfa-pending:${mfaToken}`;
      const raw = mfaToken ? await redis.get(key) : null;
      if (!raw) return send(res, 401, { error: "expired" });
      const pending = JSON.parse(raw);
      if (pending.tries >= MFA_MAX_TRIES) {
        await redis.del(key);
        return send(res, 401, { error: "expired" });
      }
      const found = await pool.query(
        `SELECT u.id, u.email, u.name, u.is_platform_admin, u.org_id, u.mfa_secret, u.mfa_recovery, u.mfa_enabled_at, u.platform_mfa_due_at,
                COALESCE(o.require_mfa, false) AS require_mfa
         FROM users u LEFT JOIN orgs o ON o.id = u.org_id
         WHERE u.id = $1 AND u.disabled_at IS NULL`,
        [pending.userId],
      );
      const user = found.rows[0];
      if (!user?.mfa_enabled_at) {
        await redis.del(key);
        return send(res, 401, { error: "expired" });
      }
      const check = await mfaCheck(user, body.code);
      if (!check.ok) {
        pending.tries += 1;
        await redis.set(key, JSON.stringify(pending), "KEEPTTL");
        await writeAudit(user.org_id, user.id, "login.mfa_fail", "user", String(user.id), {});
        return send(res, 401, { error: "code" });
      }
      await redis.del(key);
      if (check.recovery) await writeAudit(user.org_id, user.id, "login.mfa_recovery", "user", String(user.id), {});
      return issueSession(res, user);
    }

    const supportJoinMatch = url.pathname.match(/^\/v1\/support\/join\/([^/]+)(\/download)?$/);
    if (req.method === "GET" && supportJoinMatch) {
      if (await supportJoinLimited(req)) {
        return send(res, 429, { error: "Too many tries. Wait a few minutes and try again." });
      }
      const session = await liveSupportByCode(decodeURIComponent(supportJoinMatch[1]));
      if (!session) return send(res, 404, { error: "That code is not valid or has expired. Ask your technician for a new one." });
      if (!supportJoinMatch[2]) {
        return send(res, 200, {
          org: session.org_name,
          technician: session.tech_name || "",
          topic: session.topic || "",
          expiresAt: session.expires_at,
        });
      }
      const shortId = supportGroupShortId(String(session.mesh_group_id || ""));
      if (!shortId) return send(res, 409, { error: "This session is not ready. Ask your technician for a new code." });
      const meshLocal = process.env.MESH_LOCAL_URL || "http://127.0.0.1:4430";
      const agent = await fetch(
        `${meshLocal}/meshagents?id=4&meshid=${encodeURIComponent(shortId)}&installflags=1`,
      ).catch(() => null);
      if (!agent?.ok || !agent.body) return send(res, 502, { error: "The support app could not be prepared. Try again." });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        ...(agent.headers.get("content-length") ? { "content-length": agent.headers.get("content-length") } : {}),
        "content-disposition": downloadDisposition("DigitalFingersQuickSupport.exe"),
        "cache-control": "no-store",
      });
      const stream = Readable.fromWeb(agent.body);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (await handleTokenApi(req, res, url, tokenHelpers())) return;

    const actor = await actorFrom(req);
    setRequestRole(actor);
    if (actor?.mfa_setup_required && !MFA_SETUP_PATHS.has(url.pathname)) {
      return send(res, 403, { error: "mfa_setup" });
    }
    if (supportBlocked(actor, req.method, url.pathname)) {
      return send(res, 403, { error: "Support accounts can look but not change anything. Ask a platform admin." });
    }

    if (req.method === "POST" && url.pathname === "/v1/logout") {
      if (actor) {
        await redis.multi().del(`session:${actor.session_token}`).srem(`user-sessions:${actor.id}`, actor.session_token).exec();
      }
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/v1/support-sessions") {
      if (!(await requireSupport(actor, res))) return;
      await sweepSupport();
      const [live, history] = await Promise.all([
        pool.query(
          `SELECT ${SUPPORT_COLUMNS} FROM support_sessions s
           LEFT JOIN users c ON c.id = s.created_by LEFT JOIN users e ON e.id = s.ended_by
           WHERE s.org_id = $1 AND s.status = ANY($2::text[]) ORDER BY s.id DESC`,
          [actor.org_id, SUPPORT_LIVE],
        ),
        pool.query(
          `SELECT ${SUPPORT_COLUMNS} FROM support_sessions s
           LEFT JOIN users c ON c.id = s.created_by LEFT JOIN users e ON e.id = s.ended_by
           WHERE s.org_id = $1 AND NOT (s.status = ANY($2::text[])) ORDER BY s.id DESC LIMIT 100`,
          [actor.org_id, SUPPORT_LIVE],
        ),
      ]);
      const license = await licenseQuery(actor.org_id);
      return send(res, 200, {
        live: live.rows.map(supportView),
        history: history.rows.map(supportView),
        limit: license.rows[0]?.support_concurrent ?? 0,
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/support-sessions") {
      const license = await requireSupport(actor, res, { deny: true });
      if (!license) return;
      const body = await readJson(req);
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
      const email = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase().slice(0, 200) : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return send(res, 400, { error: "Enter a valid customer email, or leave it blank." });
      }
      const ticketId = body.ticketId == null || body.ticketId === "" ? null : Number(body.ticketId);
      if (ticketId != null) {
        if (!Number.isInteger(ticketId)) return send(res, 404, { error: "Ticket not found." });
        const ticket = await pool.query("SELECT id FROM tickets WHERE id = $1 AND org_id = $2", [ticketId, actor.org_id]);
        if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      }
      const running = await pool.query(
        "SELECT count(*)::int AS n FROM support_sessions WHERE org_id = $1 AND status = ANY($2::text[])",
        [actor.org_id, SUPPORT_LIVE],
      );
      if (running.rows[0].n >= (license.support_concurrent ?? 0)) {
        await writeAudit(actor.org_id, actor.id, "support.deny", "org", String(actor.org_id), { reason: "concurrent" });
        return send(res, 409, {
          error: `Your license allows ${license.support_concurrent} support session${license.support_concurrent === 1 ? "" : "s"} at a time. End one first.`,
        });
      }
      let session = null;
      for (let attempt = 0; attempt < 5 && !session; attempt += 1) {
        const code = String(randomInt(0, 1000000)).padStart(6, "0");
        try {
          const made = await pool.query(
            `INSERT INTO support_sessions (org_id, code, topic, customer_email, ticket_id, created_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7))
             RETURNING id, org_id, code, mesh_group_id`,
            [actor.org_id, code, topic || null, email || null, ticketId, actor.id, SUPPORT_JOIN_MINUTES],
          );
          session = made.rows[0];
        } catch (error) {
          if (error.code !== "23505") throw error;
        }
      }
      if (!session) return send(res, 503, { error: "A code could not be made. Try again." });
      let groupId = "";
      try {
        const text = await meshControl([
          "AddDeviceGroup",
          "--name",
          `${SUPPORT_GROUP_NAME} ${session.code}`,
          "--desc",
          `One-off support session for org ${actor.org_id}`,
          "--features",
          "1",
          "--consent",
          "127",
        ]);
        groupId = (text.match(/mesh\/\/[A-Za-z0-9@$_-]+/) || [""])[0];
        if (groupId) await shareSupportGroup(actor.org_id, groupId);
      } catch {
        if (groupId) await removeSupportGroup(groupId).catch(() => {});
        groupId = "";
      }
      if (!groupId) {
        await pool.query("UPDATE support_sessions SET status = 'ended', ended_at = now() WHERE id = $1", [session.id]);
        return send(res, 502, { error: "The remote service did not create the session. Try again." });
      }
      await pool.query("UPDATE support_sessions SET mesh_group_id = $2 WHERE id = $1", [session.id, groupId]);
      const joinUrl = `https://rmm.digitalfingers.co.za/join?code=${session.code}`;
      let emailed = false;
      if (email) {
        emailed = await sendMail({
          to: email,
          subject: `Remote support from ${actor.name || "your technician"}`,
          text:
            `${actor.name || "Your technician"} would like to connect to your computer to help you.\n\n` +
            `1. Open ${joinUrl}\n2. Download and run the support app.\n3. Click Allow when asked.\n\n` +
            `Your code is ${session.code}. It works for ${SUPPORT_JOIN_MINUTES} minutes.\n` +
            "The app removes itself when the session ends.\n",
        }).catch(() => false);
      }
      await writeAudit(actor.org_id, actor.id, "support.start", "support_session", String(session.id), {
        code: session.code,
        ticketId,
        emailed,
      });
      return send(res, 201, { id: String(session.id), code: session.code, joinUrl, emailed });
    }

    const supportSessionMatch = url.pathname.match(/^\/v1\/support-sessions\/(\d+)(?:\/(end|remote))?$/);
    if (supportSessionMatch && (req.method === "POST" || req.method === "PUT")) {
      const action = supportSessionMatch[2] || "";
      if ((req.method === "PUT") !== !action) return send(res, 404, { error: "Not found." });
      if (!(await requireSupport(actor, res, { deny: true }))) return;
      const found = await pool.query(
        `SELECT id, org_id, code, status, mesh_group_id, mesh_node_id, hostname, os_name
         FROM support_sessions WHERE id = $1 AND org_id = $2`,
        [supportSessionMatch[1], actor.org_id],
      );
      const session = found.rows[0];
      if (!session) return send(res, 404, { error: "Support session not found." });
      if (action === "end") {
        await finishSupportSession(session, "ended", actor.id);
        return send(res, 200, { ok: true });
      }
      if (action === "remote") {
        if (session.status !== "connected" || !session.mesh_node_id) {
          return send(res, 409, { error: "The customer has not joined yet." });
        }
        const remoteUrl = await tenantDesktopUrl(actor.org_id, actor, session.mesh_node_id, `df-support-${session.id}-${Date.now()}`, session.os_name);
        await writeAudit(actor.org_id, actor.id, "support.remote", "support_session", String(session.id), {
          hostname: session.hostname || "",
        });
        return send(res, 200, { url: remoteUrl, hostname: session.hostname || "" });
      }
      const body = await readJson(req);
      const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;
      const ticketId = body.ticketId == null || body.ticketId === "" ? null : Number(body.ticketId);
      if (ticketId != null) {
        if (!Number.isInteger(ticketId)) return send(res, 404, { error: "Ticket not found." });
        const ticket = await pool.query("SELECT id FROM tickets WHERE id = $1 AND org_id = $2", [ticketId, actor.org_id]);
        if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      }
      await pool.query(
        "UPDATE support_sessions SET notes = COALESCE($3, notes), ticket_id = $4 WHERE id = $1 AND org_id = $2",
        [session.id, actor.org_id, notes, ticketId],
      );
      await writeAudit(actor.org_id, actor.id, "support.update", "support_session", String(session.id), { ticketId });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/v1/account") {
      if (!requireActor(actor, res)) return;
      const found = actor.org_id
        ? await pool.query(
            `SELECT o.id, o.name, o.slug, o.created_at, o.require_mfa, o.ip_allowlist,
                    l.id AS license_id,
                    (SELECT count(*)::int FROM devices d WHERE d.org_id = o.id) AS device_count,
                    (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND u.is_platform_admin = false AND u.disabled_at IS NULL) AS seats_used
             FROM orgs o
             LEFT JOIN licenses l ON l.org_id = o.id
             WHERE o.id = $1`,
            [actor.org_id],
          )
        : { rows: [] };
      const row = found.rows[0];
      const effective = row?.license_id == null ? null : await loadLicense(pool, actor.org_id);
      const org = row
        ? {
            id: Number(row.id),
            name: row.name,
            slug: row.slug,
            createdAt: row.created_at,
            requireMfa: row.require_mfa === true,
            ipRestricted: (row.ip_allowlist || []).length > 0,
          }
        : null;
      const license = !effective
        ? null
        : {
            id: Number(row.license_id),
            number: 900000000 + Number(row.license_id),
            plan: effective.plan,
            package: effective.package,
            status: effective.status,
            active: effective.entitlements.active,
            apps: effective.entitlements.apps,
            features: effective.entitlements.features,
            seats: effective.seats,
            seatsUsed: row.seats_used,
            deviceCap: effective.device_cap,
            deviceCount: row.device_count,
            expiresAt: effective.expires_at,
            remoteDesktop: effective.modules?.remote_desktop === true,
            remoteSupport: effective.modules?.remote_support === true,
            supportConcurrent: effective.support_concurrent,
            ticketing: effective.modules?.ticketing === true,
            monitoring: effective.modules?.monitoring === true,
            patch: effective.modules?.patch === true,
            reporting: effective.modules?.reporting === true,
          };
      return send(res, 200, {
        user: {
          id: Number(actor.id),
          accountNumber: Number(actor.account_number || 900000000 + Number(actor.id)),
          name: actor.name,
          email: actor.email,
          roles: actor.roles,
          isPlatformAdmin: actor.is_platform_admin === true,
          platformRole: actor.is_platform_admin ? actor.platform_role : null,
          mfaEnabled: Boolean(actor.mfa_enabled_at),
          mfaSetupRequired: actor.mfa_setup_required === true,
          mfaDueAt: actor.is_platform_admin && !actor.mfa_enabled_at ? actor.platform_mfa_due_at : null,
        },
        impersonating: actor.impersonating || null,
        org,
        license,
        migrationsWaiting: actor.is_platform_admin ? await platformWaiting(actor.id) : await tenantWaiting(actor),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/notices") {
      if (!requireActor(actor, res)) return;
      const devices = await pool.query(
        `SELECT n.id, n.device_id, n.hostname, n.created_at, o.name AS org_name,
                (s.read_at IS NOT NULL) AS read
         FROM device_notices n
         JOIN orgs o ON o.id = n.org_id
         LEFT JOIN device_notice_states s ON s.notice_id = n.id AND s.user_id = $1
         WHERE s.deleted_at IS NULL
           AND ($2::boolean OR n.org_id = $3)
         ORDER BY n.id DESC
         LIMIT 40`,
        [actor.id, actor.is_platform_admin === true, actor.org_id || 0],
      );
      const ribbon = await pool.query(
        `SELECT n.id, n.body, n.link_label, n.link_url
         FROM ribbon_notices n
         LEFT JOIN ribbon_dismissals d ON d.notice_id = n.id AND d.user_id = $1
         WHERE n.active = true
           AND (n.starts_at IS NULL OR n.starts_at <= now())
           AND (n.ends_at IS NULL OR n.ends_at > now())
           AND d.notice_id IS NULL
           AND (n.org_id IS NULL OR n.org_id = $2)
         ORDER BY n.org_id NULLS LAST, n.id DESC
         LIMIT 1`,
        [actor.id, actor.org_id || 0],
      );
      const row = ribbon.rows[0];
      return send(res, 200, {
        devices: devices.rows.map((item) => ({
          id: Number(item.id),
          deviceId: item.device_id == null ? null : Number(item.device_id),
          hostname: item.hostname,
          orgName: item.org_name,
          createdAt: item.created_at,
          read: item.read === true,
        })),
        ribbon: row
          ? { id: Number(row.id), body: row.body, linkLabel: row.link_label || "", linkUrl: row.link_url || "" }
          : null,
      });
    }

    const deviceNoticeMatch = url.pathname.match(/^\/v1\/notices\/devices\/(\d+)(\/read)?$/);
    if (deviceNoticeMatch && (req.method === "POST" || req.method === "DELETE")) {
      if (!requireActor(actor, res)) return;
      const found = await pool.query(
        `SELECT id FROM device_notices
         WHERE id = $1 AND ($2::boolean OR org_id = $3)`,
        [deviceNoticeMatch[1], actor.is_platform_admin === true, actor.org_id || 0],
      );
      if (!found.rows[0]) return send(res, 404, { error: "That notice is no longer here." });
      if (req.method === "DELETE") {
        await pool.query(
          `INSERT INTO device_notice_states (notice_id, user_id, deleted_at)
           VALUES ($1, $2, now())
           ON CONFLICT (notice_id, user_id)
           DO UPDATE SET deleted_at = now()`,
          [deviceNoticeMatch[1], actor.id],
        );
        return send(res, 200, { ok: true });
      }
      if (deviceNoticeMatch[2] !== "/read") return send(res, 404, { error: "That notice is no longer here." });
      await pool.query(
        `INSERT INTO device_notice_states (notice_id, user_id, read_at)
         VALUES ($1, $2, now())
         ON CONFLICT (notice_id, user_id)
         DO UPDATE SET read_at = COALESCE(device_notice_states.read_at, now())
         WHERE device_notice_states.deleted_at IS NULL`,
        [deviceNoticeMatch[1], actor.id],
      );
      return send(res, 200, { ok: true });
    }

    const ribbonDismissMatch = url.pathname.match(/^\/v1\/notices\/ribbon\/(\d+)\/dismiss$/);
    if (req.method === "POST" && ribbonDismissMatch) {
      if (!requireActor(actor, res)) return;
      const found = await pool.query(
        `SELECT id FROM ribbon_notices
         WHERE id = $1 AND active = true AND (org_id IS NULL OR org_id = $2)`,
        [ribbonDismissMatch[1], actor.org_id || 0],
      );
      if (!found.rows[0]) return send(res, 404, { error: "That notice is no longer here." });
      await pool.query(
        `INSERT INTO ribbon_dismissals (notice_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (notice_id, user_id) DO NOTHING`,
        [ribbonDismissMatch[1], actor.id],
      );
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/v1/users" || /^\/v1\/users\/\d+$/.test(url.pathname)) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 400, { error: "This login is not linked to an organisation." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "user.deny", "user", null, { method: req.method });
        return send(res, 403, { error: "Only an owner or admin can manage technicians." });
      }
      const isOwner = actor.roles.includes("owner");
      if (req.method === "GET" && url.pathname === "/v1/users") {
        const client = await pool.connect();
        try {
          return send(res, 200, { users: await orgUsers(actor.org_id), seatsLeft: await seatsLeft(client, actor.org_id) });
        } finally {
          client.release();
        }
      }
      if (req.method === "POST" && url.pathname === "/v1/users") {
        const parsed = parseUserInput(await readJson(req));
        if (parsed.error) return send(res, 400, { error: parsed.error });
        if (parsed.value.role === "owner" && !isOwner) return send(res, 403, { error: "Only an owner can add another owner." });
        const passwordHash = await hashPassword(parsed.value.password);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT id FROM licenses WHERE org_id = $1 FOR UPDATE", [actor.org_id]);
          if ((await seatsLeft(client, actor.org_id)) < 1) {
            await client.query("ROLLBACK");
            return send(res, 409, { error: "All seats on the license are in use. Disable a technician or add seats first." });
          }
          const user = await client.query(
            `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin)
             VALUES ($1, $2, $3, $4, false) RETURNING id`,
            [actor.org_id, parsed.value.email, parsed.value.name, passwordHash],
          );
          await setUserRole(client, actor.org_id, user.rows[0].id, parsed.value.role);
          await writeAudit(actor.org_id, actor.id, "user.create", "user", String(user.rows[0].id), { role: parsed.value.role, email: parsed.value.email }, client);
          await client.query("COMMIT");
          return send(res, 201, { id: Number(user.rows[0].id) });
        } catch (error) {
          await client.query("ROLLBACK");
          if (error.code === "23505") return send(res, 409, { error: "That email is already a login." });
          throw error;
        } finally {
          client.release();
        }
      }
      const userId = Number(url.pathname.split("/").pop());
      if (req.method === "PUT" && userId) {
        const body = await readJson(req);
        if (userId === Number(actor.id)) return send(res, 400, { error: "You cannot change your own access here." });
        const target = (await orgUsers(actor.org_id)).find((user) => user.id === userId);
        if (!target) return send(res, 404, { error: "That technician is not in this organisation." });
        if (target.role === "owner" && !isOwner) return send(res, 403, { error: "Only an owner can change an owner." });
        if (body.resetMfa === true) {
          await pool.query("UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery = NULL WHERE id = $1", [userId]);
          await revokeUserSessions(userId, null);
          await writeAudit(actor.org_id, actor.id, "user.mfa_reset", "user", String(userId), {});
          return send(res, 200, { ok: true });
        }
        const role = body.role === undefined ? target.role : body.role;
        if (!USER_ROLES.includes(role)) return send(res, 400, { error: "Choose a role." });
        if (role === "owner" && !isOwner) return send(res, 403, { error: "Only an owner can make someone an owner." });
        const disabled = body.disabled === undefined ? Boolean(target.disabledAt) : body.disabled === true;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT id FROM licenses WHERE org_id = $1 FOR UPDATE", [actor.org_id]);
          if (target.disabledAt && !disabled && (await seatsLeft(client, actor.org_id)) < 1) {
            await client.query("ROLLBACK");
            return send(res, 409, { error: "All seats on the license are in use. Disable someone else or add seats first." });
          }
          await setUserRole(client, actor.org_id, userId, role);
          await client.query(
            "UPDATE users SET disabled_at = CASE WHEN $2 THEN COALESCE(disabled_at, now()) ELSE NULL END WHERE id = $1",
            [userId, disabled],
          );
          if ((await managersLeft(client, actor.org_id)) < 1) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "The organisation needs at least one active owner or admin." });
          }
          if (role !== target.role) {
            await writeAudit(actor.org_id, actor.id, "user.role_change", "user", String(userId), { before: target.role, after: role }, client);
          }
          if (disabled !== Boolean(target.disabledAt)) {
            await writeAudit(actor.org_id, actor.id, disabled ? "user.deactivate" : "user.reactivate", "user", String(userId), {}, client);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        if (disabled || role !== target.role) await revokeUserSessions(userId, null);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "Method not allowed." });
    }

    if (url.pathname.startsWith("/v1/account/mfa/") && req.method === "POST") {
      if (!requireActor(actor, res)) return;
      const action = url.pathname.slice("/v1/account/mfa/".length);
      const setupKey = `mfa-setup:${actor.id}`;
      if (action === "setup") {
        if (actor.mfa_enabled_at) return send(res, 409, { error: "MFA is already on for this login." });
        mfaKey();
        const secret = base32Encode(randomBytes(20));
        await redis.set(setupKey, secret, "EX", 900);
        const label = encodeURIComponent(`${MFA_ISSUER}:${actor.email}`);
        const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(MFA_ISSUER)}&algorithm=SHA1&digits=6&period=30`;
        return send(res, 200, { secret, uri });
      }
      if (action === "enable") {
        if (actor.mfa_enabled_at) return send(res, 409, { error: "MFA is already on for this login." });
        const secret = await redis.get(setupKey);
        if (!secret) return send(res, 400, { error: "The setup expired. Start again." });
        const body = await readJson(req);
        if (!(await totpValid(actor.id, secret, body.code))) return send(res, 400, { error: "That code is not right. Check the time on your phone and try the newest code." });
        const recovery = newRecoveryCodes();
        await pool.query(
          "UPDATE users SET mfa_secret = $2, mfa_enabled_at = now(), mfa_recovery = $3::jsonb WHERE id = $1",
          [actor.id, sealSecret(secret), JSON.stringify(recovery.hashes)],
        );
        await redis.del(setupKey);
        await revokeUserSessions(actor.id, actor.session_token);
        await writeAudit(actor.org_id, actor.id, "user.mfa_enable", "user", String(actor.id), {});
        return send(res, 200, { recoveryCodes: recovery.codes });
      }
      if (action === "disable" || action === "recovery") {
        if (!actor.mfa_enabled_at) return send(res, 400, { error: "MFA is not on for this login." });
        if (action === "disable" && actor.require_mfa) return send(res, 400, { error: "Your organisation requires MFA, so it cannot be turned off." });
        if (action === "disable" && actor.is_platform_admin) return send(res, 400, { error: "Platform accounts must keep MFA on. Another super admin can reset it if you lose your phone." });
        const body = await readJson(req);
        const found = await pool.query("SELECT id, mfa_secret, mfa_recovery FROM users WHERE id = $1", [actor.id]);
        const check = await mfaCheck(found.rows[0], body.code);
        if (!check.ok) return send(res, 400, { error: "That code is not right." });
        if (action === "disable") {
          await pool.query("UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery = NULL WHERE id = $1", [actor.id]);
          await writeAudit(actor.org_id, actor.id, "user.mfa_disable", "user", String(actor.id), {});
          return send(res, 200, { ok: true });
        }
        const recovery = newRecoveryCodes();
        await pool.query("UPDATE users SET mfa_recovery = $2::jsonb WHERE id = $1", [actor.id, JSON.stringify(recovery.hashes)]);
        await writeAudit(actor.org_id, actor.id, "user.mfa_recovery_new", "user", String(actor.id), {});
        return send(res, 200, { recoveryCodes: recovery.codes });
      }
      return send(res, 404, { error: "Not found." });
    }

    if (url.pathname === "/v1/org/security") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 400, { error: "This login is not linked to an organisation." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "security.deny", "org", String(actor.org_id), {});
        return send(res, 403, { error: "Only an owner or admin can change security settings." });
      }
      const current = await pool.query("SELECT require_mfa, ip_allowlist FROM orgs WHERE id = $1", [actor.org_id]);
      const yourAddress = normaliseAddress(clientAddress(req));
      if (req.method === "GET") {
        const counts = await pool.query(
          `SELECT count(*) FILTER (WHERE mfa_enabled_at IS NOT NULL)::int AS on, count(*)::int AS total
           FROM users WHERE org_id = $1 AND is_platform_admin = false AND disabled_at IS NULL`,
          [actor.org_id],
        );
        return send(res, 200, {
          requireMfa: current.rows[0].require_mfa,
          ipAllowlist: current.rows[0].ip_allowlist,
          yourAddress,
          mfaUsers: counts.rows[0].on,
          activeUsers: counts.rows[0].total,
        });
      }
      if (req.method !== "PUT") return send(res, 405, { error: "Method not allowed." });
      const body = await readJson(req);
      let requireMfa = current.rows[0].require_mfa;
      let allowlist = current.rows[0].ip_allowlist;
      if (body.requireMfa !== undefined) {
        requireMfa = body.requireMfa === true;
        if (requireMfa && !actor.mfa_enabled_at) return send(res, 400, { error: "Turn on MFA for your own login first." });
      }
      if (body.ipAllowlist !== undefined) {
        const parsed = parseAllowlist(body.ipAllowlist);
        if (parsed.error) return send(res, 400, { error: parsed.error });
        if (parsed.value.length && !addressAllowed(yourAddress, parsed.value)) {
          return send(res, 400, { error: `Your current address (${yourAddress}) is not in the list, so saving it would lock you out. Add it first.` });
        }
        allowlist = parsed.value;
      }
      await pool.query("UPDATE orgs SET require_mfa = $2, ip_allowlist = $3 WHERE id = $1", [actor.org_id, requireMfa, allowlist]);
      await writeAudit(actor.org_id, actor.id, "security.update", "org", String(actor.org_id), { requireMfa, ipAllowlist: allowlist });
      const listChanged = JSON.stringify(allowlist) !== JSON.stringify(current.rows[0].ip_allowlist);
      if (listChanged && allowlist.length) await revokeOrgSessions(actor.org_id, actor.id);
      return send(res, 200, { ok: true, requireMfa, ipAllowlist: allowlist });
    }

    if (req.method === "POST" && url.pathname === "/v1/account/password") {
      if (!requireActor(actor, res)) return;
      const body = await readJson(req);
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 200) {
        return send(res, 400, { error: "Use at least 8 characters." });
      }
      const found = await pool.query("SELECT password_hash FROM users WHERE id = $1", [actor.id]);
      if (!found.rows[0] || !(await verifyPassword(currentPassword, found.rows[0].password_hash))) {
        return send(res, 400, { error: "current" });
      }
      const passwordHash = await hashPassword(password);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, actor.id]);
      await revokeUserSessions(actor.id, actor.session_token);
      await writeAudit(actor.org_id, actor.id, "user.password", "user", String(actor.id), {});
      return send(res, 200, { ok: true });
    }

    const orgMatch = url.pathname.match(/^\/v1\/orgs\/(\d+)$/);
    if (req.method === "GET" && orgMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.is_platform_admin && String(actor.org_id || "") !== orgMatch[1]) {
        return send(res, 404, { error: "Org not found." });
      }
      const result = await pool.query("SELECT id, name, slug, created_at FROM orgs WHERE id = $1", [orgMatch[1]]);
      const license = result.rows[0] ? await loadLicense(pool, result.rows[0].id) : null;
      if (!license) return send(res, 404, { error: "Org not found." });
      const row = result.rows[0];
      return send(res, 200, {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.created_at,
        license: licenseView(license),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/orgs") {
      if (!requireActor(actor, res)) return;
      const slug = url.searchParams.get("slug");
      const orgId = actor.is_platform_admin ? null : actor.org_id || 0;
      const [result, licenses] = await Promise.all([
        pool.query(
          `SELECT o.id, o.name, o.slug
           FROM orgs o
           WHERE ($1::bigint IS NULL OR o.id = $1)
             AND ($2::text IS NULL OR o.slug = $2)
           ORDER BY o.id`,
          [orgId, slug],
        ),
        loadAllLicenses(pool),
      ]);
      return send(res, 200, {
        orgs: result.rows.filter((row) => licenses.has(Number(row.id))).map((row) => {
          const license = licenses.get(Number(row.id));
          return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            deviceCap: license.device_cap,
            modules: license.modules,
          };
        }),
      });
    }

    const impersonateMatch = url.pathname.match(/^\/v1\/platform\/tenants\/(\d+)\/impersonate$/);
    if (req.method === "POST" && impersonateMatch) {
      if (!requirePlatform(actor, res)) return;
      const org = await pool.query("SELECT id, name FROM orgs WHERE id = $1", [impersonateMatch[1]]);
      if (!org.rows[0]) return send(res, 404, { error: "Tenant not found." });
      const token = randomBytes(32).toString("base64url");
      const startedAt = new Date().toISOString();
      await redis.multi()
        .set(`session:${token}`, JSON.stringify({ userId: actor.id, impersonateOrgId: Number(org.rows[0].id), startedAt }), "EX", IMPERSONATION_TTL_SECONDS)
        .sadd(`user-sessions:${actor.id}`, token)
        .exec();
      await writeAudit(org.rows[0].id, actor.id, "impersonation.start", "org", String(org.rows[0].id), { tenant: org.rows[0].name });
      return send(res, 201, { token, expiresInSeconds: IMPERSONATION_TTL_SECONDS });
    }

    if (req.method === "POST" && url.pathname === "/v1/impersonation/end") {
      if (!actor?.impersonating) return send(res, 400, { error: "Not viewing as a tenant." });
      await redis.multi().del(`session:${actor.session_token}`).srem(`user-sessions:${actor.id}`, actor.session_token).exec();
      const minutes = actor.impersonating.startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(actor.impersonating.startedAt).getTime()) / 60000))
        : null;
      await writeAudit(actor.impersonating.orgId, actor.id, "impersonation.end", "org", String(actor.impersonating.orgId), { minutes });
      return send(res, 200, { ok: true, orgId: actor.impersonating.orgId });
    }

    if (await handleInvites(req, res, url, actor, platformHelpers())) return;
    if (await handlePlatformTeam(req, res, url, actor, platformHelpers())) return;
    if (await handleApiTokens(req, res, url, actor, tokenHelpers())) return;
    if (await handleMigrations(req, res, url, actor, migrationHelpers())) return;
    if (await handleCsat(req, res, url, deskHelpers())) return;
    if (await handleDeskSettings(req, res, url, actor, deskHelpers())) return;
    if (await handleDeskFlow(req, res, url, actor, deskHelpers())) return;
    if (await handleDeskMail(req, res, url, actor, deskHelpers())) return;
    if (await handlePlatformAdmin(req, res, url, actor, platformHelpers())) return;

    if (req.method === "GET" && url.pathname === "/v1/platform/system") {
      if (!requirePlatform(actor, res)) return;
      return send(res, 200, await systemOverview());
    }

    const platformPassword = url.pathname.match(/^\/v1\/platform\/users\/(\d+)\/password$/);
    if (req.method === "POST" && platformPassword) {
      if (!requirePlatform(actor, res)) return;
      const body = await readJson(req);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: "Use at least 8 characters." });
      const found = await pool.query(
        "SELECT id, org_id, is_platform_admin FROM users WHERE id = $1",
        [platformPassword[1]],
      );
      const person = found.rows[0];
      if (!person || person.is_platform_admin || !person.org_id) return send(res, 404, { error: "User not found." });
      const passwordHash = await hashPassword(password);
      await inTransaction(async (client) => {
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, person.id]);
        await writeAudit(person.org_id, actor.id, "user.password_set", "user", String(person.id), {}, client);
      });
      await revokeUserSessions(person.id, null);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/v1/enroll-tokens") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "enroll.deny", "org", String(actor.org_id), { reason: "role" });
        return send(res, 403, { error: "Only an owner or admin can add computers." });
      }
      if (!(await remoteAppAllowed(actor.org_id))) {
        await writeAudit(actor.org_id, actor.id, "enroll.deny", "org", String(actor.org_id), { reason: "app" });
        return send(res, 403, { error: "Adding computers needs Remote Desk.", code: "app_not_entitled", app: "remote" });
      }
      const body = await readJson(req);
      let customerId = null;
      if (body.customerId != null && body.customerId !== "") {
        const account = await pool.query(
          "SELECT id FROM customers WHERE id = $1 AND org_id = $2",
          [Number.isInteger(Number(body.customerId)) ? Number(body.customerId) : 0, actor.org_id],
        );
        if (!account.rows[0]) return send(res, 400, { error: "Choose an account in this organisation." });
        customerId = account.rows[0].id;
      }
      const command = body.kind === "command";
      const maxUses = command ? Number(body.maxUses) : 1;
      if (command && !COMMAND_USES.includes(maxUses)) {
        return send(res, 400, { error: "Choose how many computers may use the command." });
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const created = await pool.query(
        `INSERT INTO enroll_tokens (org_id, token_hash, created_by, expires_at, customer_id, max_uses, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [actor.org_id, sha256(token), actor.id, expiresAt.toISOString(), customerId, maxUses, command ? "command" : "package"],
      );
      const id = Number(created.rows[0].id);
      if (command) {
        await writeAudit(actor.org_id, actor.id, "enroll.command.create", "enroll_token", String(id), { maxUses, customerId });
      }
      return send(res, 201, { id, token, expiresAt: expiresAt.toISOString() });
    }

    if (req.method === "GET" && url.pathname === "/v1/enroll-tokens") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id || !canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can see install commands." });
      const rows = await pool.query(
        `SELECT t.id, t.max_uses, t.use_count, t.expires_at, t.created_at, c.name AS customer_name, u.name AS created_by_name
         FROM enroll_tokens t
         LEFT JOIN customers c ON c.id = t.customer_id
         LEFT JOIN users u ON u.id = t.created_by
         WHERE t.org_id = $1 AND t.kind = 'command' AND t.revoked_at IS NULL
           AND t.expires_at > now() AND t.use_count < t.max_uses
         ORDER BY t.created_at DESC
         LIMIT 50`,
        [actor.org_id],
      );
      return send(res, 200, {
        commands: rows.rows.map((row) => ({
          id: Number(row.id),
          maxUses: row.max_uses,
          useCount: row.use_count,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
          customer: row.customer_name || null,
          createdBy: row.created_by_name || null,
        })),
      });
    }

    const enrollTokenMatch = url.pathname.match(/^\/v1\/enroll-tokens\/(\d+)$/);
    if (req.method === "DELETE" && enrollTokenMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id || !canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can revoke install commands." });
      const revoked = await pool.query(
        `UPDATE enroll_tokens SET revoked_at = now()
         WHERE id = $1 AND org_id = $2 AND kind = 'command' AND revoked_at IS NULL
         RETURNING id`,
        [enrollTokenMatch[1], actor.org_id],
      );
      if (!revoked.rows[0]) return send(res, 404, { error: "That install command was not found." });
      await writeAudit(actor.org_id, actor.id, "enroll.command.revoke", "enroll_token", enrollTokenMatch[1], {});
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/install-check") {
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token || token.length > 100) return send(res, 401, { error: "This install command is not valid." });
      const row = await pool.query(
        "SELECT expires_at, use_count, max_uses, revoked_at FROM enroll_tokens WHERE token_hash = $1",
        [sha256(token)],
      );
      if (!enrollTokenUsable(row.rows[0])) {
        return send(res, 401, { error: "This install command has expired, was revoked or has been used up. Create a new one under Downloads." });
      }
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/v1/agent/update/windows") {
      let deviceId = null;
      const ticket = String(url.searchParams.get("t") || "");
      if (ticket) {
        const key = `agent-download:${ticket.slice(0, 64)}`;
        deviceId = await redis.get(key);
        if (deviceId) await redis.del(key);
      } else {
        deviceId = (await deviceFrom(req))?.id || null;
      }
      if (!deviceId) return send(res, 401, { error: "Device login required." });
      const file = join(AGENT_BIN_DIR, "DigitalFingersAgent.exe");
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return send(res, 404, { error: "No agent build is published." });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(info.size),
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/agent/remote/windows") {
      const device = await deviceFrom(req);
      if (!device) return send(res, 401, { error: "Device login required." });
      const file = join(AGENT_BIN_DIR, "DigitalFingersRemoteSupport.exe");
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return send(res, 404, { error: "No remote support build is published." });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(info.size),
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/agent/update/linux") {
      const arch = String(url.searchParams.get("arch") || "");
      if (!LINUX_ARCHES.includes(arch)) return send(res, 400, { error: "Unknown processor type." });
      const key = `agent-download-linux:${String(url.searchParams.get("t") || "").slice(0, 64)}`;
      const deviceId = await redis.get(key);
      if (deviceId) await redis.del(key);
      if (!deviceId) return send(res, 401, { error: "This update link has expired or was already used." });
      const file = join(AGENT_BIN_DIR, "linux", `df-agent-${arch}`);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return send(res, 404, { error: "No Linux agent build is published." });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(info.size),
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/enroll") {
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const hostname = cleanHostname(body.hostname);
      const osName = typeof body.osName === "string" ? body.osName.trim() : "";
      if (!token || !hostname || hostname.length > 200 || osName.length > 200) {
        return send(res, 400, { error: "Hostname and enroll token are required." });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tokenRow = await client.query(
          `SELECT id, org_id, created_by, expires_at, customer_id, use_count, max_uses, revoked_at
           FROM enroll_tokens
           WHERE token_hash = $1
           FOR UPDATE`,
          [sha256(token)],
        );
        const invite = tokenRow.rows[0];
        if (!enrollTokenUsable(invite)) {
          await client.query("ROLLBACK");
          return send(res, 401, { error: "Enroll token is not valid." });
        }
        const current = await loadLicense(client, invite.org_id, { lock: true });
        const denyEnroll = async (reason, message) => {
          await client.query("ROLLBACK");
          await writeAudit(invite.org_id, invite.created_by, "enroll.deny", "org", String(invite.org_id), { reason });
          return send(res, 403, { error: message });
        };
        if (!current || current.modules?.core !== true) {
          return await denyEnroll("core", "This org cannot enroll devices.");
        }
        if (licenseExpired(current)) {
          return await denyEnroll("expired", inactiveMessage(current));
        }
        const count = await client.query(
          "SELECT count(*)::int AS total FROM devices WHERE org_id = $1",
          [invite.org_id],
        );
        if (count.rows[0].total >= current.device_cap) {
          return await denyEnroll("device_cap", "All devices on the license are in use.");
        }
        const deviceToken = randomBytes(32).toString("base64url");
        const site = invite.customer_id
          ? await client.query("SELECT id FROM sites WHERE customer_id = $1 ORDER BY id LIMIT 1", [invite.customer_id])
          : { rows: [] };
        const device = await client.query(
          `INSERT INTO devices (org_id, hostname, display_name, os_name, last_seen_at, agent_token_hash, site_id)
           VALUES ($1, $2, $2, $3, now(), $4, $5)
           RETURNING id`,
          [invite.org_id, hostname, osName || null, sha256(deviceToken), site.rows[0]?.id || null],
        );
        await client.query(
          `UPDATE enroll_tokens
           SET use_count = use_count + 1,
               used_at = CASE WHEN use_count + 1 >= max_uses THEN now() ELSE used_at END
           WHERE id = $1`,
          [invite.id],
        );
        await writeAudit(
          invite.org_id,
          invite.created_by,
          "device.enroll",
          "device",
          String(device.rows[0].id),
          { hostname, osName, ...(invite.customer_id ? { customerId: String(invite.customer_id) } : {}) },
          client,
        );
        await client.query(
          "INSERT INTO device_notices (org_id, device_id, hostname) VALUES ($1, $2, $3)",
          [invite.org_id, device.rows[0].id, hostname],
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
      // A full software inventory (up to 4000 packages) does not fit the default limit.
      const body = await readJson(req, 1 << 20);
      const hostname = cleanHostname(body.hostname);
      const osName = typeof body.osName === "string" ? body.osName.trim() : "";
      const metrics = metricsFrom(body);
      const updates = updatesFrom(body);
      const asset = assetFrom(body);
      const users = usersFrom(body);
      const agentVersion = versionParts(body.agentVersion) ? body.agentVersion : "";
      const remoteAgent = remoteAgentFrom(body);
      const uptime = Number(metrics?.uptimeSeconds);
      const publicIp = publicIpFrom(req);
      const saved = await pool.query(
        `UPDATE devices
         SET last_seen_at = now(),
             os_version = COALESCE(NULLIF($17, ''), os_version),
             os_build = COALESCE(NULLIF($18, ''), os_build),
             last_boot_at = CASE WHEN $19::bigint IS NULL THEN last_boot_at
                                 ELSE date_trunc('minute', now() - make_interval(secs => $19::bigint)) END,
             public_ip = COALESCE(NULLIF($20, ''), public_ip),
             hostname = COALESCE(NULLIF($2, ''), hostname),
             display_name = COALESCE(NULLIF(display_name, ''), NULLIF($2, ''), hostname),
             os_name = COALESCE(NULLIF($3, ''), os_name),
             metrics = COALESCE($4::jsonb, metrics),
             updates = CASE WHEN $5::boolean THEN $6::jsonb ELSE updates END,
             make = COALESCE(NULLIF($7, ''), make),
             model = COALESCE(NULLIF($8, ''), model),
             serial = COALESCE(NULLIF($9, ''), serial),
             software = CASE WHEN $10::boolean THEN $11::jsonb ELSE software END,
             ipv4 = CASE WHEN $12 = '' THEN ipv4 ELSE $12 END,
             users = CASE WHEN $13::boolean THEN $14::jsonb ELSE users END,
             updates_checked_at = CASE WHEN $5::boolean THEN now() ELSE updates_checked_at END,
             reboot_pending = CASE WHEN $5::boolean THEN $15::boolean ELSE reboot_pending END,
             agent_version = COALESCE(NULLIF($16, ''), agent_version),
             remote_agent = COALESCE($21::jsonb, remote_agent)
         FROM (SELECT public_ip AS previous_ip, remote_agent AS previous_remote, agent_version AS previous_agent FROM devices WHERE id = $1) prior
         WHERE devices.id = $1
         RETURNING update_scan_requested_at, updates_checked_at, os_name, agent_version,
                   agent_update_requested_at, agent_update_offered_at,
                   public_ip, geo_updated_at, prior.previous_ip, prior.previous_remote, prior.previous_agent`,
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
          ipv4From(req),
          users != null,
          users ? JSON.stringify(users) : "[]",
          body.rebootPending === true,
          agentVersion,
          osField(body.osVersion),
          osField(body.osBuild),
          Number.isFinite(uptime) && uptime >= 0 && uptime < 10 * 365 * 86400 ? Math.floor(uptime) : null,
          publicIp,
          remoteAgent ? JSON.stringify(remoteAgent) : null,
        ],
      );
      const remoteChange = remoteAgentChange(saved.rows[0]?.previous_remote, remoteAgent);
      if (remoteChange) {
        await writeAudit(device.org_id, null, remoteChange, "device", String(device.id), {
          hostname: hostname || null,
          ...(remoteAgent.detail ? { detail: remoteAgent.detail } : {}),
        });
        if (remoteChange === "device.remote_agent_ok") setTimeout(isolateTenantMesh, 15000);
      }
      const previousAgent = saved.rows[0]?.previous_agent;
      if (agentVersion && previousAgent && previousAgent !== agentVersion) {
        await recordActivitySafely(pool, device.org_id, {
          type: "agent.updated",
          group: "agent",
          summary: `updated the agent from ${previousAgent} to ${agentVersion}`,
          actorType: "system",
          actorLabel: hostname || device.hostname || "Device agent",
          deviceId: Number(device.id),
          payload: { from: previousAgent, to: agentVersion },
        });
      }
      if (saved.rows[0]) {
        locateDevice(device.id, saved.rows[0].previous_ip, saved.rows[0])
          .catch((error) => console.error(`geoip update: ${error.message}`));
      }
      const scanAt = saved.rows[0]?.update_scan_requested_at;
      const checkedAt = saved.rows[0]?.updates_checked_at;
      const scanUpdates = scanAt && (!checkedAt || scanAt > checkedAt) ? scanAt.toISOString() : "";
      if (updates) {
        autoApproveUpdates({ id: device.id, org_id: device.org_id, updates })
          .catch(() => console.error("update auto-approve failed"));
      }
      if (metrics) {
        await evaluateAlerts(device.id);
        await storeHealthSample(device.org_id, device.id, metrics);
      }
      await clearOfflineTicket(device.id);
      await attachMissingTickets(device.id);
      let agentUpdate = null;
      try {
        agentUpdate = await offerAgentUpdate(device, saved.rows[0] || {}, body.acceptDeploys !== false);
      } catch (error) {
        console.error(`agent update offer: ${error.message}`);
      }
      const cannotScript = scriptProblem(saved.rows[0] || {});
      if (cannotScript) {
        await pool.query(
          `UPDATE jobs SET status = 'finished', exit_code = 1, output = $2, finished_at = now()
           WHERE device_id = $1 AND status = 'queued' AND kind = 'script'`,
          [device.id, cannotScript],
        );
      }
      const jobs = await pool.query(
        `UPDATE jobs
         SET status = 'running'
         WHERE device_id = $1 AND status = 'queued'
         RETURNING id, command, kind`,
        [device.id],
      );
      const deploys = body.acceptDeploys === false
        ? { rows: [] }
        : await pool.query(
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
      const remoteOffer = remoteAgentOffer(remoteAgent, remoteAgent ? await remoteRelease() : null);
      return send(res, 200, {
        jobs: jobs.rows.map((row) => ({ id: Number(row.id), command: row.command, kind: row.kind })),
        deploys: deploys.rows.map((row) => ({ id: Number(row.id), packageName: row.package_name })),
        scanUpdates,
        ...(agentUpdate ? { agentUpdate } : {}),
        ...(remoteOffer ? { remoteAgent: remoteOffer } : {}),
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
         RETURNING id, org_id, ticket_id, kind`,
        [exitCode, output, jobResultMatch[1], device.id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Job not found." });
      const finished = updated.rows[0];
      await recordActivitySafely(pool, finished.org_id, {
        type: finished.kind === "script" ? "script.finished" : "command.finished",
        group: "commands",
        summary: `${finished.kind === "script" ? "script" : "command"} ${exitCode === 0 ? "finished" : "failed"} with exit code ${exitCode}`,
        actorType: "system",
        actorLabel: device.hostname || "Device agent",
        deviceId: Number(device.id),
        ticketId: finished.ticket_id == null ? null : Number(finished.ticket_id),
        payload: { jobId: Number(finished.id), exitCode },
        source: "job_result",
        sourceId: finished.id,
      });
      if (updated.rows[0].ticket_id != null) {
        await ticketEvent(updated.rows[0].org_id, updated.rows[0].ticket_id, "command_result", {
          label: device.hostname || "Device agent",
          detail: { jobId: Number(updated.rows[0].id), exitCode, output: output.slice(0, 4000) },
        });
      }
      return send(res, 200, { id: Number(updated.rows[0].id), status: "finished" });
    }

    const deployResultMatch = url.pathname.match(/^\/v1\/agent\/deploys\/(\d+)\/result$/);
    if (req.method === "POST" && deployResultMatch) {
      const device = await deviceFrom(req);
      if (!device) return send(res, 401, { error: "Device login required." });
      const body = await readJson(req);
      const succeeded = body.ok === true;
      const restart = succeeded && body.restartRequired === true;
      const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 2000) : "";
      const updated = await pool.query(
        `UPDATE patch_deploys
         SET status = $1, detail = $2, finished_at = now(), restart_required = $5
         WHERE id = $3 AND device_id = $4 AND status = 'running'
         RETURNING id, package_name`,
        [succeeded ? "succeeded" : "failed", detail, deployResultMatch[1], device.id, restart],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Deploy not found." });
      if (restart) {
        await pool.query("UPDATE devices SET reboot_pending = true WHERE id = $1", [device.id]);
      }
      await writeAudit(device.org_id, null, "patch.deploy", "patch_deploy", String(updated.rows[0].id), {
        deviceId: Number(device.id),
        packageName: updated.rows[0].package_name,
        status: succeeded ? "succeeded" : "failed",
        restartRequired: restart,
      });
      finishUpdateBatch(device.id).catch(() => console.error("update batch finish failed"));
      return send(res, 200, { id: Number(updated.rows[0].id), status: succeeded ? "succeeded" : "failed" });
    }

    if (req.method === "GET" && url.pathname === "/v1/devices") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = await licenseQuery(actor.org_id);
      if (!hasApp(license.rows[0]?.entitlements, "remote")) {
        return send(res, 403, { error: "Devices need Remote Desk.", code: "app_not_entitled", app: "remote" });
      }
      const org = await pool.query("SELECT id, name FROM orgs WHERE id = $1", [actor.org_id]);
      const access = remoteAccess(license.rows[0]);
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 200).toLowerCase();
      const filter = deviceFilterFrom(url.searchParams);
      const { items } = await fleetItems(actor.org_id, { patch: filter.patch === "missing" && patchAllowed(license.rows[0]) });
      const enrolled = items.length;
      const shown = items.filter((item) => deviceMatches(item.facts, filter)
        && (!q || `${item.row.hostname} ${item.row.display_name || ""}`.toLowerCase().includes(q)));
      const result = { rows: shown.map((item) => item.row) };
      const factsById = new Map(shown.map((item) => [String(item.row.id), item.facts]));
      const customers = await pool.query("SELECT id, name FROM customers WHERE org_id = $1 ORDER BY name", [actor.org_id]);
      const [release, linux] = await Promise.all([agentRelease(), linuxRelease()]);
      const latestFor = (osName) => ({ windows: release?.version, linux: linux?.version })[platformOf(osName)] || null;
      return send(res, 200, {
        filter,
        enrolledCount: enrolled,
        customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
        org: org.rows[0] || null,
        latestAgent: release?.version || null,
        canRemote: access.canRemote,
        canTicket: ticketingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        remoteReason: access.remoteReason,
        deviceCount: result.rows.length,
        devices: result.rows.map((row) => ({
          id: row.id,
          hostname: row.hostname,
          displayName: row.display_name || row.hostname,
          presence: presenceFrom(row.last_seen_at),
          users: Array.isArray(row.users) ? row.users : [],
          customerId: row.customer_id == null ? null : Number(row.customer_id),
          customerName: row.customer_name || null,
          osName: row.os_name,
          ipv4: row.ipv4 || null,
          lastSeenAt: row.last_seen_at,
          agentVersion: row.agent_version || null,
          agentLatest: latestFor(row.os_name),
          agentOutdated: Boolean(latestFor(row.os_name)) && olderAgent(row.agent_version, latestFor(row.os_name)),
          remoteAgent: remoteAgentView(row.remote_agent),
          siteOverride: row.site_override || null,
          location: factsById.get(String(row.id))?.group || "Unknown",
        })),
      });
    }

    const deviceDetailsMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/details$/);
    if (req.method === "GET" && deviceDetailsMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = await licenseQuery(actor.org_id);
      const device = await pool.query(
        `SELECT d.id, d.hostname, d.display_name, d.os_name, d.last_seen_at, d.make, d.model,
                d.serial, d.ipv4, d.users, d.mesh_node_id, d.agent_version, c.name AS customer_name,
                d.public_ip, d.geo_city, d.geo_region, d.geo_country_name, d.geo_updated_at, d.site_override
         FROM devices d
         LEFT JOIN sites s ON s.id = d.site_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE d.id = $1 AND d.org_id = $2`,
        [deviceDetailsMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const row = device.rows[0];
      let meshInfo = null;
      let rawInfo = null;
      let groupName = "";
      let note = "";
      let clock = {};
      try {
        const node = await resolveMeshNode(row, actor.org_id);
        const nodeId = node.nodeId;
        groupName = node.group;
        if (nodeId) {
          try {
            meshInfo = meshJson(await meshControl(["DeviceInfo", "--id", nodeId, "--json"]));
          } catch {
            meshInfo = null;
          }
          try {
            rawInfo = meshJson(await meshControl(["DeviceInfo", "--id", nodeId, "--raw"]));
            clock = osClock(rawInfo);
          } catch {
            clock = {};
          }
          if (!meshInfo && !clock.timeZone && !clock.lastBoot && !clock.productId) {
            note = "MeshCentral has not reported this computer yet.";
          }
        } else {
          note = "MeshCentral has not reported this computer yet.";
        }
      } catch {
        note = "MeshCentral did not answer.";
      }
      row.latest_agent = (await releaseFor(row.os_name))?.version || "";
      const sections = detailSections(row, meshInfo, groupName, clock);
      const presence = presenceFrom(row.last_seen_at);
      return send(res, 200, {
        hostname: row.hostname,
        displayName: row.display_name || row.hostname,
        presence,
        presenceLabel: presence === "online" ? "Online" : presence === "rebooting" ? "Rebooting" : "Offline",
        canRemote: remoteAccess(license.rows[0]).canRemote,
        users: Array.isArray(row.users) ? row.users : [],
        siteOverride: row.site_override || "",
        note,
        overview: deviceOverview(row, meshInfo, rawInfo),
        left: sections.left,
        right: sections.right,
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/devices/site") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const body = await readJson(req);
      const ids = Array.isArray(body.deviceIds)
        ? [...new Set(body.deviceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
        : [];
      if (!ids.length || ids.length > 500) return send(res, 400, { error: "Choose between 1 and 500 devices." });
      const site = typeof body.site === "string" ? body.site.trim().replace(/\s+/g, " ") : "";
      if (site.length > 80 || /[\u0000-\u001f<>]/.test(site)) {
        return send(res, 400, { error: "Enter a site or branch name of up to 80 characters." });
      }
      const updated = await pool.query(
        `UPDATE devices SET site_override = NULLIF($1, '')
         WHERE org_id = $2 AND id = ANY($3::bigint[])
         RETURNING id`,
        [site, actor.org_id, ids],
      );
      if (!updated.rows.length) return send(res, 404, { error: "Device not found." });
      const changed = updated.rows.map((row) => Number(row.id));
      await writeAudit(actor.org_id, actor.id, "device.site", "device", changed.length === 1 ? String(changed[0]) : "bulk", {
        site: site || null,
        devices: changed,
      });
      return send(res, 200, { site, updated: changed.length });
    }

    const deviceNameMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/name$/);
    if (req.method === "POST" && deviceNameMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
        return send(res, 400, { error: "Enter a device name." });
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceNameMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const row = device.rows[0];
      try {
        const { nodeId } = await resolveMeshNode(row, actor.org_id);
        if (!nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        const parsed = meshJson(await meshRename(nodeId, name));
        if (!parsed?.ok) return send(res, 502, { error: parsed?.error || "MeshCentral did not rename this computer." });
      } catch {
        return send(res, 502, { error: "MeshCentral did not answer." });
      }
      await pool.query("UPDATE devices SET display_name = $1 WHERE id = $2", [name, row.id]);
      await writeAudit(actor.org_id, actor.id, "device.rename", "device", String(row.id), { name });
      return send(res, 200, { name });
    }

    const deviceSoftwareMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/software$/);
    if (req.method === "GET" && deviceSoftwareMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceSoftwareMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const row = device.rows[0];
      let note = "";
      let apps = [];
      try {
        const match = await resolveMeshNode(row, actor.org_id);
        const nodeId = match.nodeId;
        if (!nodeId) {
          note = "MeshCentral has not reported this computer yet.";
        } else if (match && match.online === false) {
          note = "The Mesh agent is offline, so installed software cannot be read.";
        } else {
          const parsed = meshJson(await meshSoftware(nodeId));
          if (Array.isArray(parsed)) apps = softwareRows(parsed);
          else note = softwareNote(parsed?.error);
        }
      } catch {
        note = "MeshCentral did not answer.";
      }
      return send(res, 200, {
        hostname: row.hostname,
        note,
        total: apps.length,
        apps,
      });
    }

    const deviceDiagnosticMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/diagnostics$/);
    if (req.method === "GET" && deviceDiagnosticMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const tool = url.searchParams.get("tool") || "";
      const kind = DIAGNOSTIC_KINDS[tool];
      if (!kind) return send(res, 400, { error: "Choose a diagnostic tool." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceDiagnosticMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const row = device.rows[0];
      let note = "";
      let table = { columns: [], rows: [] };
      try {
        const match = await resolveMeshNode(row, actor.org_id);
        const nodeId = match.nodeId;
        if (!nodeId) {
          note = "MeshCentral has not reported this computer yet.";
        } else if (match && match.online === false) {
          note = "The Mesh agent is offline, so this list cannot be read.";
        } else {
          const parsed = meshJson(await meshQuery(nodeId, kind));
          if (!parsed) note = diagnosticNote("");
          else if (!Array.isArray(parsed) && parsed.error && !parsed.items) note = diagnosticNote(parsed.error);
          else table = diagnosticTable(tool, parsed);
        }
      } catch {
        note = "MeshCentral did not answer.";
      }
      return send(res, 200, {
        hostname: row.hostname,
        tool,
        note,
        columns: table.columns,
        rows: table.rows,
        total: table.rows.length,
        warning: table.warning || "",
      });
    }

    const deviceStartupMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/startup$/);
    if (req.method === "POST" && deviceStartupMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceStartupMatch[1], "startup"))) return;
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      }
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const location = typeof body.location === "string" ? body.location.trim() : "";
      const enabled = body.enabled === true;
      if (!name || name.length > 180 || !location || location.length > 400) {
        return send(res, 400, { error: "That startup item is not available." });
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceStartupMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      try {
        const node = await resolveMeshNode(device.rows[0], actor.org_id);
        if (!node.nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        if (node.online === false) return send(res, 409, { error: "The Mesh agent is offline, so this startup item cannot be changed." });
        const listed = meshJson(await meshQuery(node.nodeId, "startup"));
        const source = listed && listed.items ? listed.items : listed;
        const users = listed && listed.users ? listed.users : {};
        const items = Array.isArray(source) ? source : [];
        const item = items.find((entry) => String(recordField(entry, "Name") || "").trim() === name && String(recordField(entry, "Location") || "").trim() === location);
        const target = item ? startupSwitch(item, users) : null;
        if (!target || !STARTUP_SWITCH.test(target.path)) {
          return send(res, 409, { error: "That startup item cannot be changed." });
        }
        const changed = meshJson(await meshStartupSet(node.nodeId, target.hive, target.path, target.value, enabled));
        if (!changed || changed.error) return send(res, 502, { error: changed?.error || "MeshCentral did not change this startup item." });
        await writeAudit(actor.org_id, actor.id, "startup.set", "device", String(device.rows[0].id), { name, enabled });
        return send(res, 200, { ok: true, enabled });
      } catch {
        return send(res, 502, { error: "MeshCentral did not answer." });
      }
    }

    const deviceServiceMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/services$/);
    if (req.method === "POST" && deviceServiceMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceServiceMatch[1], "service"))) return;
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      }
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const action = typeof body.action === "string" ? body.action.trim() : "";
      if (!SERVICE_ACTIONS.has(action) || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$/.test(name)) {
        return send(res, 400, { error: "That service cannot be changed." });
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceServiceMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      try {
        const node = await resolveMeshNode(device.rows[0], actor.org_id);
        if (!node.nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        if (node.online === false) return send(res, 409, { error: "The Mesh agent is offline, so this service cannot be changed." });
        const listed = meshJson(await meshQuery(node.nodeId, "services"));
        const rows = serviceRows(listed);
        const row = rows.find((entry) => entry.service === name);
        if (!row) return send(res, 404, { error: "That service is not on this computer." });
        if (serviceProtected(row.service, row.name)) return send(res, 409, { error: "That service is part of the system and cannot be changed from here." });
        const allowed = {
          stop: row.canStop,
          start: row.canStart,
          pause: row.canPause,
          resume: row.canResume,
          restart: row.canRestart,
          manual: row.canConfigure,
          auto: row.canConfigure,
          disabled: row.canConfigure,
        }[action];
        if (!allowed) return send(res, 409, { error: "That action is not available for this service." });
        const changed = meshJson(await meshServiceSet(node.nodeId, action, row.service));
        if (!changed || changed.error) return send(res, 502, { error: changed?.error || "MeshCentral did not change this service." });
        await writeAudit(actor.org_id, actor.id, "service.set", "device", String(device.rows[0].id), { name: row.service, action });
        return send(res, 200, { ok: true });
      } catch {
        return send(res, 502, { error: "MeshCentral did not answer." });
      }
    }

    const deviceProcessMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/processes\/(\d+)$/);
    if (req.method === "DELETE" && deviceProcessMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceProcessMatch[1], "process"))) return;
      const pid = deviceProcessMatch[2];
      if (!/^[1-9]\d{0,9}$/.test(pid) || Number(pid) > 2147483647) {
        return send(res, 400, { error: "That process is not available." });
      }
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceProcessMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      try {
        const node = await resolveMeshNode(device.rows[0], actor.org_id);
        if (!node.nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        if (node.online === false) return send(res, 409, { error: "The Mesh agent is offline, so this process cannot be ended." });
        const listed = meshJson(await meshQuery(node.nodeId, "processes", "list"));
        if (!listed || listed.error) return send(res, 502, { error: "MeshCentral did not return this list." });
        const match = processEntries(listed).find(([key, item]) => item && String(recordField(item, "pid") || key) === pid);
        const name = match ? processLabel(match[1]) : "";
        if (!name) return send(res, 404, { error: "That process is no longer running." });
        if (protectedProcess(name)) return send(res, 409, { error: "That process is part of the system and cannot be ended from here." });
        const ended = meshJson(await meshQuery(node.nodeId, "kill", pid));
        if (!ended || ended.error) return send(res, 502, { error: "MeshCentral did not end the process." });
        await writeAudit(actor.org_id, actor.id, "process.end", "device", String(device.rows[0].id), { pid: Number(pid), name });
        return send(res, 200, { ok: true });
      } catch {
        return send(res, 502, { error: "MeshCentral did not answer." });
      }
    }

    const deviceFilesMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/files$/);
    if (req.method === "GET" && deviceFilesMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceFilesMatch[1]))) return;
      const folder = filePathValue(url.searchParams.get("path") || "");
      if (folder == null) return send(res, 400, { error: "That folder is not available." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id, os_name FROM devices WHERE id = $1 AND org_id = $2",
        [deviceFilesMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      try {
        const node = await resolveMeshNode(device.rows[0], actor.org_id);
        if (!node.nodeId) return send(res, 200, { path: folder, entries: [], note: "MeshCentral has not reported this computer yet." });
        if (node.online === false) return send(res, 200, { path: folder, entries: [], note: "The Mesh agent is offline, so files cannot be read." });
        const parsed = meshJson(await meshFiles(node.nodeId, "ls", folder));
        if (parsed?.error) return send(res, 200, { path: folder, entries: [], note: parsed.error });
        return send(res, 200, { path: parsed.path || folder, entries: parsed.entries || [], windows: /windows/i.test(device.rows[0].os_name || "") });
      } catch {
        return send(res, 200, { path: folder, entries: [], note: "MeshCentral did not answer." });
      }
    }

    const deviceFolderMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/folders$/);
    if (req.method === "POST" && deviceFolderMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceFolderMatch[1], "folder"))) return;
      const body = await readJson(req);
      const folder = filePathValue(body.path || "");
      const name = fileNameValue(body.name);
      if (folder == null || !folder) return send(res, 400, { error: "Open a folder before creating one." });
      if (!name) return send(res, 400, { error: "Enter a folder name." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceFolderMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      try {
        const node = await resolveMeshNode(device.rows[0], actor.org_id);
        if (!node.nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        const parsed = meshJson(await meshFiles(node.nodeId, "mkdir", folder, name));
        if (parsed?.error) return send(res, 502, { error: parsed.error });
      } catch {
        return send(res, 502, { error: "MeshCentral did not answer." });
      }
      await writeAudit(actor.org_id, actor.id, "file.mkdir", "device", String(device.rows[0].id), { path: folder, name });
      return send(res, 200, { name });
    }

    const deviceTerminalMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/terminal$/);
    const deviceTerminalSessionMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/terminal\/([a-f0-9]{36})(\/input|\/size)?$/);
    if (deviceTerminalMatch || deviceTerminalSessionMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, (deviceTerminalMatch || deviceTerminalSessionMatch)[1], "terminal"))) return;
      const deviceId = (deviceTerminalMatch || deviceTerminalSessionMatch)[1];
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      }
      if (req.method === "POST" && deviceTerminalMatch) {
        const body = await readJson(req);
        const shell = body.shell === "powershell" ? "powershell" : body.shell === "cmd" ? "cmd" : "";
        const device = await pool.query(
          "SELECT id, hostname, display_name, os_name, users, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
          [deviceId, actor.org_id],
        );
        if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
        const accounts = Array.isArray(device.rows[0].users) ? device.rows[0].users.map((user) => String(user || "").trim()).filter(Boolean) : [];
        const runAs = body.runAs === "system" || accounts.includes(body.runAs) ? String(body.runAs) : "";
        if (!shell || !runAs) return send(res, 400, { error: "Choose a shell." });
        const protocol = shellProtocol(device.rows[0].os_name, shell, runAs);
        if (!protocol) return send(res, 400, { error: "PowerShell is only available on Windows." });
        const cols = Math.min(220, Math.max(40, Number(body.cols) || 100));
        const rows = Math.min(80, Math.max(10, Number(body.rows) || 30));
        let nodeId = device.rows[0].mesh_node_id || "";
        if (!nodeId) {
          const node = await resolveMeshNode(device.rows[0], actor.org_id);
          nodeId = node.nodeId || "";
        }
        if (!nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        let dropped = false;
        const onDrop = () => { dropped = true; };
        res.on("close", onDrop);
        try {
          const session = await openMeshTerminal(nodeId, protocol, cols, rows);
          res.removeListener("close", onDrop);
          if (dropped || res.writableEnded) {
            try { session.child.kill("SIGKILL"); } catch { /* already gone */ }
            return;
          }
          const ticket = randomBytes(18).toString("hex");
          session.orgId = String(actor.org_id);
          session.deviceId = String(device.rows[0].id);
          session.timer = setTimeout(() => closeTerminal(ticket), 30 * 60 * 1000);
          terminalSessions.set(ticket, session);
          await writeAudit(actor.org_id, actor.id, "terminal.open", "device", String(device.rows[0].id), { shell, runAs });
          return send(res, 200, { ticket });
        } catch (error) {
          const allowed = ["MeshCentral did not answer.", "The shell stopped.", "Remote service is not configured.", "Choose a shell.", "MeshCentral did not allow the shell."];
          return send(res, error.status || 502, { error: allowed.includes(error.message) ? error.message : "MeshCentral did not answer." });
        }
      }
      const ticket = deviceTerminalSessionMatch?.[2] || "";
      const session = terminalSessions.get(ticket);
      if (!session || session.orgId !== String(actor.org_id) || session.deviceId !== deviceId) {
        return send(res, 404, { error: "That shell is no longer open." });
      }
      if (req.method === "GET" && deviceTerminalSessionMatch && !deviceTerminalSessionMatch[3]) {
        if (session.res) return send(res, 409, { error: "That shell is already open." });
        if (res.socket) res.socket.setNoDelay(true);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        for (const chunk of session.buffer) res.write(chunk);
        session.buffer = [];
        if (session.closed) {
          res.end();
          return;
        }
        session.res = res;
        res.on("close", () => {
          if (session.res === res) closeTerminal(ticket);
        });
        return;
      }
      if (req.method === "DELETE" && deviceTerminalSessionMatch && !deviceTerminalSessionMatch[3]) {
        closeTerminal(ticket);
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && deviceTerminalSessionMatch?.[3] === "/input") {
        const bytes = await readBytes(req, 65536);
        session.child.stdin.write(bytes);
        clearTimeout(session.timer);
        session.timer = setTimeout(() => closeTerminal(ticket), 30 * 60 * 1000);
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && deviceTerminalSessionMatch?.[3] === "/size") {
        const body = await readJson(req);
        const cols = Math.min(220, Math.max(40, Number(body.cols) || 100));
        const rows = Math.min(80, Math.max(10, Number(body.rows) || 30));
        session.child.stdio[3].write(`${JSON.stringify({ cols, rows })}\n`);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "That shell is no longer open." });
    }

    const deviceDownloadFileMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/download\/([a-f0-9]{36})$/);
    if (req.method === "GET" && deviceDownloadFileMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const item = downloadTickets.get(deviceDownloadFileMatch[2]);
      if (!item || item.orgId !== String(actor.org_id) || item.deviceId !== deviceDownloadFileMatch[1]) {
        return send(res, 404, { error: "That download is no longer available." });
      }
      clearTimeout(item.timer);
      downloadTickets.delete(deviceDownloadFileMatch[2]);
      let info;
      try {
        info = await stat(item.filePath);
      } catch {
        await rm(item.dir, { recursive: true, force: true });
        return send(res, 404, { error: "That download is no longer available." });
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": info.size,
        "content-disposition": downloadDisposition(item.downloadName),
        "cache-control": "no-store",
      });
      const stream = createReadStream(item.filePath);
      stream.on("close", () => {
        rm(item.dir, { recursive: true, force: true }).catch(() => {});
      });
      stream.on("error", () => {
        res.destroy();
        rm(item.dir, { recursive: true, force: true }).catch(() => {});
      });
      stream.pipe(res);
      return;
    }

    const deviceDownloadMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/download$/);
    if (req.method === "POST" && deviceDownloadMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceDownloadMatch[1]))) return;
      const body = await readJson(req);
      const folder = filePathValue(body.path || "");
      const name = fileNameValue(body.name);
      const kind = body.kind === "folder" ? "folder" : body.kind === "file" ? "file" : "";
      const size = Number(body.size) || 0;
      if (folder == null || !folder) return send(res, 400, { error: "Open a folder before downloading." });
      if (!name || !kind) return send(res, 400, { error: "Choose a file." });
      if (kind === "file" && size > DOWNLOAD_LIMIT) return send(res, 413, { error: "That file is larger than 256 MB." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceDownloadMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const scratch = await mkdtemp(join(tmpdir(), "df-download-"));
      const stored = join(scratch, "download.bin");
      let started = false;
      try {
        let nodeId = device.rows[0].mesh_node_id || "";
        if (!nodeId) {
          const node = await resolveMeshNode(device.rows[0], actor.org_id);
          nodeId = node.nodeId || "";
        }
        if (!nodeId) {
          await rm(scratch, { recursive: true, force: true });
          return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        }
        started = true;
        if (res.socket) res.socket.setNoDelay(true);
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        res.write(`${JSON.stringify({ status: "Queued" })}\n`);
        let shown = "Queued";
        const note = (status) => {
          if (!status || status === shown) return;
          shown = status;
          res.write(`${JSON.stringify({ status })}\n`);
        };
        const report = (event) => {
          if (event.status === "Downloading") {
            const progress = event.size > 0 ? Math.min(99, Math.floor((event.acked / event.size) * 100)) : null;
            note(progress == null ? "Downloading" : `Downloading ${progress}%`);
            return;
          }
          if (event.status === "Zipping" && typeof event.progress === "number") {
            note(`Zipping ${event.progress}%`);
            return;
          }
          note(event.status);
        };
        const parsed = kind === "folder"
          ? await downloadFolderArchive(nodeId, folder, name, stored, report)
          : meshJson(await meshFilesDownload(nodeId, folder, name, kind, stored, size, report));
        if (!parsed?.ok) {
          await rm(scratch, { recursive: true, force: true });
          res.write(`${JSON.stringify({ error: parsed?.error || "The file was not downloaded." })}\n`);
          res.end();
          return;
        }
        const downloadName = kind === "folder" ? `${name}.zip` : name;
        const ticket = rememberDownload(actor.org_id, device.rows[0].id, scratch, stored, downloadName);
        await writeAudit(actor.org_id, actor.id, "file.download", "device", String(device.rows[0].id), { path: folder, name, kind, bytes: parsed.bytes || size });
        res.write(`${JSON.stringify({ ok: true, ticket, name: downloadName, progress: 100 })}\n`);
        res.end();
      } catch (error) {
        await rm(scratch, { recursive: true, force: true });
        const message = error.status === 413
          ? (error.message || "That file is larger than 256 MB.")
          : error.message && error.message !== "Remote service did not answer."
            ? error.message
            : "MeshCentral did not answer.";
        if (!started) return send(res, error.status || 502, { error: message });
        res.write(`${JSON.stringify({ error: message })}\n`);
        res.end();
      }
      return;
    }

    const deviceUploadMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/upload$/);
    if (req.method === "POST" && deviceUploadMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceUploadMatch[1], "upload"))) return;
      let folderHeader = "";
      let nameHeader = "";
      try {
        folderHeader = decodeURIComponent(String(req.headers["x-df-path"] || ""));
        nameHeader = decodeURIComponent(String(req.headers["x-df-name"] || ""));
      } catch {
        return send(res, 400, { error: "Choose a file." });
      }
      const folder = filePathValue(folderHeader);
      const name = fileNameValue(nameHeader);
      if (folder == null || !folder) return send(res, 400, { error: "Open a folder before uploading." });
      if (!name) return send(res, 400, { error: "Choose a file." });
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceUploadMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const uploadId = String(req.headers["x-df-id"] || "");
      const start = headerNumber(req.headers["x-df-start"]);
      const total = headerNumber(req.headers["x-df-total"]);
      const chunked = start != null && total != null;
      if (chunked && (!/^[0-9a-f-]{36}$/i.test(uploadId) || total > UPLOAD_LIMIT || start > total)) {
        return send(res, 400, { error: "Choose a file." });
      }
      const now = Date.now();
      for (const [key, session] of fileUploads) {
        if (now - session.at > UPLOAD_MS) {
          fileUploads.delete(key);
          await rm(session.scratch, { recursive: true, force: true });
        }
      }
      const uploadKey = chunked ? `${actor.id}:${device.rows[0].id}:${uploadId}` : "";
      let session = chunked ? fileUploads.get(uploadKey) : null;
      if (chunked && start === 0) {
        if (session) await rm(session.scratch, { recursive: true, force: true });
        const scratch = await mkdtemp(join(tmpdir(), "df-upload-"));
        session = {
          scratch,
          stored: join(scratch, "upload.bin"),
          received: 0,
          total,
          folder,
          name,
          at: now,
        };
        fileUploads.set(uploadKey, session);
      } else if (chunked && (!session || session.received !== start || session.total !== total || session.folder !== folder || session.name !== name)) {
        return send(res, 409, { error: "The upload did not continue. Choose the file again." });
      }
      const scratch = session ? session.scratch : await mkdtemp(join(tmpdir(), "df-upload-"));
      const stored = session ? session.stored : join(scratch, "upload.bin");
      const file = createWriteStream(stored, {
        flags: chunked && start > 0 ? "r+" : "w",
        start: chunked ? start : 0,
        mode: 0o600,
      });
      let received = 0;
      try {
        received = await pipeBody(req, file, UPLOAD_LIMIT, chunked ? start : 0);
      } catch (error) {
        if (error.status === 413 || !session || start === 0) {
          fileUploads.delete(uploadKey);
          await rm(scratch, { recursive: true, force: true });
        }
        const message = error.status === 413 ? error.message : "The file was not uploaded.";
        return send(res, error.status || 502, { error: message });
      }
      if (session) {
        session.received = received;
        session.at = Date.now();
        if (received > total) {
          fileUploads.delete(uploadKey);
          await rm(scratch, { recursive: true, force: true });
          return send(res, 400, { error: "Choose a file." });
        }
        if (received < total) return send(res, 200, { received, total });
        fileUploads.delete(uploadKey);
      }
      let started = false;
      try {
        let nodeId = device.rows[0].mesh_node_id || "";
        if (!nodeId) {
          const node = await resolveMeshNode(device.rows[0], actor.org_id);
          nodeId = node.nodeId || "";
        }
        if (!nodeId) return send(res, 409, { error: "MeshCentral has not reported this computer yet." });
        started = true;
        if (res.socket) res.socket.setNoDelay(true);
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        res.write(`${JSON.stringify({ progress: 0 })}\n`);
        let shown = 0;
        const parsed = meshJson(await meshFilesUpload(nodeId, folder, name, stored, (acked, size) => {
          const progress = size > 0 ? Math.min(99, Math.floor((acked / size) * 100)) : 0;
          if (progress === shown) return;
          shown = progress;
          res.write(`${JSON.stringify({ progress })}\n`);
        }));
        if (!parsed?.ok) {
          res.write(`${JSON.stringify({ error: parsed?.error || "The file was not uploaded." })}\n`);
          res.end();
          return;
        }
        await writeAudit(actor.org_id, actor.id, "file.upload", "device", String(device.rows[0].id), { path: folder, name, bytes: received });
        res.write(`${JSON.stringify({ ok: true, name, progress: 100 })}\n`);
        res.end();
      } catch (error) {
        const message = error.status === 413 ? (error.message || "That file is larger than 8 GB.") : "MeshCentral did not answer.";
        if (!started) return send(res, error.status || 502, { error: message });
        res.write(`${JSON.stringify({ error: message })}\n`);
        res.end();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
      return;
    }

    const agentUpdateMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/agent-update$/);
    if (req.method === "POST" && agentUpdateMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "agent.update.deny", "device", agentUpdateMatch[1], { reason: "role" });
        return send(res, 403, { error: "Only an owner or admin can update the agent." });
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id, os_name, agent_version FROM devices WHERE id = $1 AND org_id = $2",
        [agentUpdateMatch[1], actor.org_id],
      );
      const row = device.rows[0];
      if (!row) return send(res, 404, { error: "Device not found." });
      const platform = platformOf(row.os_name);
      if (!platform) return send(res, 400, { error: "Agent updates are available for Windows and Linux." });
      const release = await releaseFor(row.os_name);
      if (!release) return send(res, 503, { error: "No agent build is published yet." });
      if (!olderAgent(row.agent_version, release.version)) {
        return send(res, 200, { status: "current", version: row.agent_version });
      }
      if (platform === "linux") {
        const problem = await sendLinuxUpdate(row, actor.org_id, release);
        await writeAudit(actor.org_id, actor.id, "agent.update.request", "device", String(row.id), {
          from: row.agent_version || "older",
          to: release.version,
          platform,
          ...(problem ? { error: problem } : {}),
        });
        if (problem) return send(res, 409, { error: problem });
        return send(res, 202, { status: "sent", platform, version: release.version });
      }
      await pool.query(
        "UPDATE devices SET agent_update_requested_at = now() WHERE id = $1",
        [row.id],
      );
      await writeAudit(actor.org_id, actor.id, "agent.update.request", "device", String(row.id), {
        from: row.agent_version || "older",
        to: release.version,
      });
      return send(res, 202, { status: "queued", version: release.version });
    }

    const devicePowerMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/power$/);
    if (req.method === "POST" && devicePowerMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "power.deny", "device", devicePowerMatch[1], { reason: "role" });
        return send(res, 403, { error: "A technician cannot change power." });
      }
      const body = await readJson(req);
      const action = typeof body.action === "string" ? body.action : "";
      const device = await pool.query(
        "SELECT id, os_name, hostname FROM devices WHERE id = $1 AND org_id = $2",
        [devicePowerMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const command = powerCommand(action, device.rows[0].os_name, device.rows[0].hostname);
      if (!command) return send(res, 400, { error: "Choose a power action." });
      const job = await pool.query(
        `INSERT INTO jobs (org_id, device_id, command, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [actor.org_id, device.rows[0].id, command, actor.id],
      );
      await writeAudit(actor.org_id, actor.id, "power.request", "device", String(device.rows[0].id), { action, jobId: Number(job.rows[0].id) });
      return send(res, 201, { id: Number(job.rows[0].id), status: "queued" });
    }

    const deviceJobMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/jobs$/);
    if (req.method === "POST" && deviceJobMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "job.deny", "device", deviceJobMatch[1], { reason: "role" });
        return send(res, 403, { error: "A technician cannot run a shell." });
      }
      const jobLicense = await licenseQuery(actor.org_id);
      if (!hasApp(jobLicense.rows[0]?.entitlements, "remote")) {
        await writeAudit(actor.org_id, actor.id, "job.deny", "device", deviceJobMatch[1], { reason: "app" });
        return send(res, 403, { error: "Running commands needs Remote Desk.", code: "app_not_entitled", app: "remote" });
      }
      const body = await readJson(req);
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!command || command.length > COMMAND_MAX || /[\n\r\0]/.test(command)) {
        return send(res, 400, { error: `Enter one command line of up to ${COMMAND_MAX} characters.` });
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
      await writeAudit(actor.org_id, actor.id, "job.create", "job", String(job.rows[0].id), { deviceId: device.rows[0].id });
      if (ticketId != null) {
        await ticketEvent(actor.org_id, ticketId, "command", {
          actorId: actor.id,
          detail: { jobId: Number(job.rows[0].id), command, deviceId: Number(device.rows[0].id) },
        });
      }
      return send(res, 201, { id: Number(job.rows[0].id), status: "queued" });
    }

    if (req.method === "GET" && url.pathname === "/v1/remote-sessions") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const devices = await pool.query(
        "SELECT id, mesh_node_id FROM devices WHERE org_id = $1 AND mesh_node_id IS NOT NULL AND mesh_node_id <> ''",
        [actor.org_id],
      );
      let live = {};
      try {
        live = await meshSessionList();
      } catch (error) {
        return send(res, error.status || 502, { error: error.message });
      }
      const sessions = {};
      for (const row of devices.rows) {
        if (live[row.mesh_node_id]) sessions[String(row.id)] = live[row.mesh_node_id];
      }
      return send(res, 200, { sessions });
    }

    const deviceSessionsEndMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/sessions\/end$/);
    if (req.method === "POST" && deviceSessionsEndMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceSessionsEndMatch[1]))) return;
      const device = await pool.query(
        "SELECT id, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceSessionsEndMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      if (!device.rows[0].mesh_node_id) return send(res, 409, { error: "This device has no remote agent yet." });
      let result;
      try {
        result = await meshSessionsEnd(device.rows[0].mesh_node_id);
      } catch (error) {
        return send(res, error.status || 502, { error: error.message });
      }
      const ended = Number(result.ended) || 0;
      const remaining = result.remaining || { total: 0 };
      await writeAudit(actor.org_id, actor.id, "remote.end", "device", String(device.rows[0].id), {
        ended,
        remaining: Number(remaining.total) || 0,
      });
      return send(res, 200, { ended, remaining });
    }

    const deviceAgentRestartMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/agent\/restart$/);
    if (req.method === "POST" && deviceAgentRestartMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!(await requireRemote(actor, res, deviceAgentRestartMatch[1]))) return;
      const device = await pool.query(
        "SELECT id, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2",
        [deviceAgentRestartMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      if (!device.rows[0].mesh_node_id) return send(res, 409, { error: "This device has no remote agent yet." });
      let result;
      try {
        result = await meshAgentRestart(device.rows[0].mesh_node_id);
      } catch (error) {
        return send(res, error.status || 502, { error: error.message });
      }
      const remaining = result.remaining || { total: 0 };
      await writeAudit(actor.org_id, actor.id, "remote.agent_restart", "device", String(device.rows[0].id), {
        back: Boolean(result.back),
        remaining: Number(remaining.total) || 0,
      });
      return send(res, 200, { back: Boolean(result.back), remaining });
    }

    // An open session window polls this after the device went offline (usually a restart). It returns a fresh
    // desktop link once the remote agent is back, without counting a new remote session.
    const deviceResumeMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/remote\/resume$/);
    if (req.method === "POST" && deviceResumeMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id, os_name FROM devices WHERE id = $1 AND org_id = $2",
        [deviceResumeMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const node = await resolveMeshNode(device.rows[0], actor.org_id);
      if (!node.nodeId || !node.online) return send(res, 200, { online: false });
      const link = await tenantDesktopUrl(actor.org_id, actor, node.nodeId, `df-${device.rows[0].id}-${Date.now()}`, device.rows[0].os_name);
      await writeAudit(actor.org_id, actor.id, "remote.resume", "device", String(device.rows[0].id), {});
      return send(res, 200, { online: true, url: link });
    }

    const deviceRemoteMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/remote$/);
    if (req.method === "POST" && deviceRemoteMatch) {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = await licenseQuery(actor.org_id);
      const access = remoteAccess(license.rows[0]);
      if (!access.canRemote) {
        await writeAudit(actor.org_id, actor.id, "remote.deny", "device", deviceRemoteMatch[1], {
          reason: access.remoteReason,
        });
        return licenseDenied(res, license.rows[0], access.remoteReason, "remote_sessions", "Remote desktop");
      }
      const device = await pool.query(
        "SELECT id, hostname, display_name, mesh_node_id, os_name, users FROM devices WHERE id = $1 AND org_id = $2",
        [deviceRemoteMatch[1], actor.org_id],
      );
      if (!device.rows[0]) return send(res, 404, { error: "Device not found." });
      const node = await resolveMeshNode(device.rows[0], actor.org_id);
      device.rows[0].mesh_node_id = node.nodeId;
      if (!device.rows[0].mesh_node_id) {
        return send(res, 409, { error: "This device has no remote agent yet." });
      }
      const body = await readJson(req);
      const requestedUser = typeof body.user === "string" ? body.user.trim().slice(0, 80) : "";
      const knownUsers = Array.isArray(device.rows[0].users) ? device.rows[0].users : [];
      const sessionUser = knownUsers.includes(requestedUser) ? requestedUser : "";
      const ticketId = body.ticketId == null || body.ticketId === "" ? null : Number(body.ticketId);
      if (ticketId != null) {
        if (!Number.isInteger(ticketId)) return send(res, 404, { error: "Ticket not found." });
        const ticket = await pool.query(
          "SELECT id FROM tickets WHERE id = $1 AND org_id = $2 AND device_id = $3",
          [ticketId, actor.org_id, device.rows[0].id],
        );
        if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      }
      const url = await tenantDesktopUrl(
        actor.org_id,
        actor,
        device.rows[0].mesh_node_id,
        `df-${device.rows[0].id}-${Date.now()}`,
        device.rows[0].os_name,
      );
      const launched = await insertAudit(pool, actor.org_id, actor.id, "remote.launch", "device", String(device.rows[0].id), {
        ...(ticketId == null ? {} : { ticketId }),
        ...(sessionUser ? { user: sessionUser } : {}),
      });
      await pool.query(
        `INSERT INTO remote_sessions (org_id, device_id, customer_id, user_id, ticket_id, device_name, audit_event_id)
         SELECT d.org_id, d.id, s.customer_id, $3, $4, COALESCE(d.display_name, d.hostname), $5
         FROM devices d
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE d.id = $1 AND d.org_id = $2`,
        [device.rows[0].id, actor.org_id, actor.id, ticketId, launched.rows[0].id],
      ).catch((error) => console.error(`remote session: ${error.message}`));
      if (ticketId != null) {
        await ticketEvent(actor.org_id, ticketId, "remote_start", {
          actorId: actor.id,
          detail: { deviceId: Number(device.rows[0].id), ...(sessionUser ? { user: sessionUser } : {}) },
        });
      }
      return send(res, 200, { url });
    }

    if (req.method === "GET" && url.pathname === "/v1/accounts") {
      const access = await customerAccess(actor, res);
      if (!access) return;
      const view = customerView(url, access, res);
      if (view == null) return;
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 200);
      const needle = q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const [accounts, contactTotal] = await Promise.all([
        pool.query(
          `SELECT c.*, p.name AS primary_name, p.email AS primary_email, p.phone AS primary_phone,
                  sp.name AS sla_plan_name, os.org_id IS NOT NULL AS has_default_sla,
                  (SELECT count(*)::int FROM contacts ct WHERE ct.customer_id = c.id) AS contact_count,
                  (SELECT count(*)::int FROM devices d JOIN sites s ON s.id = d.site_id WHERE s.customer_id = c.id) AS device_count,
                  (SELECT count(*)::int FROM devices d JOIN sites s ON s.id = d.site_id
                   WHERE s.customer_id = c.id AND d.last_seen_at > now() - interval '60 seconds') AS online_count,
                  (SELECT max(e.created_at) FROM audit_events e
                   JOIN devices d ON e.target_id = d.id::text
                   JOIN sites s ON s.id = d.site_id
                   WHERE e.org_id = c.org_id AND e.target_type = 'device' AND e.action = 'remote.launch'
                     AND s.customer_id = c.id) AS last_session_at,
                  (SELECT count(*)::int FROM tickets t WHERE t.customer_id = c.id AND t.status <> 'resolved') AS open_ticket_count,
                  (SELECT count(*)::int FROM tickets t
                   WHERE t.customer_id = c.id AND t.status <> 'resolved'
                     AND COALESCE(sp.resolve_minutes, os.resolve_minutes) IS NOT NULL
                     AND t.created_at + make_interval(mins => COALESCE(sp.resolve_minutes, os.resolve_minutes)) < now()) AS overdue_count
           FROM customers c
           LEFT JOIN contacts p ON p.customer_id = c.id AND p.is_primary
           LEFT JOIN sla_plans sp ON sp.id = c.sla_plan_id
           LEFT JOIN org_slas os ON os.org_id = c.org_id
           WHERE c.org_id = $1
             AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR COALESCE(c.email, '') ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR COALESCE(c.phone, '') ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR COALESCE(c.website, '') ILIKE '%' || $2 || '%' ESCAPE '\\')
           ORDER BY lower(c.name)`,
          [actor.org_id, needle],
        ),
        pool.query("SELECT count(*)::int AS total FROM contacts WHERE org_id = $1", [actor.org_id]),
      ]);
      return send(res, 200, {
        accounts: accounts.rows.map((row) => ({
          ...accountView(row),
          primaryContact: row.primary_name
            ? { name: row.primary_name, email: row.primary_email || null, phone: row.primary_phone || null }
            : null,
          contactCount: row.contact_count,
          ...listFields(row, view, access),
        })),
        contactTotal: contactTotal.rows[0].total,
        view,
        ...customerFlags(access, actor),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/contacts") {
      const access = await customerAccess(actor, res);
      if (!access) return;
      if (customerView(url, access, res) == null) return;
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 200);
      const needle = q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const [contacts, accountTotal] = await Promise.all([
        pool.query(
          `SELECT ct.*, c.name AS customer_name
           FROM contacts ct
           JOIN customers c ON c.id = ct.customer_id
           WHERE ct.org_id = $1
             AND ($2 = '' OR ct.name ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR COALESCE(ct.email, '') ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR COALESCE(ct.phone, '') ILIKE '%' || $2 || '%' ESCAPE '\\'
                  OR c.name ILIKE '%' || $2 || '%' ESCAPE '\\')
           ORDER BY lower(ct.name)`,
          [actor.org_id, needle],
        ),
        pool.query("SELECT count(*)::int AS total FROM customers WHERE org_id = $1", [actor.org_id]),
      ]);
      return send(res, 200, {
        contacts: contacts.rows.map(contactView),
        accountTotal: accountTotal.rows[0].total,
        ...customerFlags(access, actor),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/accounts") {
      if (!(await customerAccess(actor, res, { write: true }))) return;
      const body = await readJson(req);
      const input = accountInput(body);
      if (input.error) return send(res, 400, { error: input.error });
      let contact = null;
      if (body.contact && typeof body.contact === "object" && String(body.contact.name || "").trim()) {
        contact = contactInput(body.contact);
        if (contact.error) return send(res, 400, { error: contact.error });
      }
      const v = input.values;
      const created = await inTransaction(async (client) => {
        if (await customerNameTaken(client, actor.org_id, v.name, null)) return null;
        const account = await client.query(
          `INSERT INTO customers (org_id, name, kind, website, email, phone, alt_phone, address, registration_number, vat_number, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [actor.org_id, v.name, v.kind, v.website, v.email, v.phone, v.altPhone, v.address, v.registrationNumber, v.vatNumber, v.notes],
        );
        const accountId = account.rows[0].id;
        const site = await client.query(
          "INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Primary') RETURNING id",
          [actor.org_id, accountId],
        );
        let contactId = null;
        if (contact) {
          const c = contact.values;
          const row = await client.query(
            `INSERT INTO contacts (org_id, customer_id, name, email, phone, alt_phone, job_title, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             RETURNING id`,
            [actor.org_id, accountId, c.name, c.email, c.phone, c.altPhone, c.jobTitle],
          );
          contactId = row.rows[0].id;
        }
        return { accountId, siteId: site.rows[0].id, contactId };
      }).catch((error) => {
        if (error.code === "23505" && error.constraint === "customers_org_name_key") return null;
        throw error;
      });
      if (!created) return send(res, 409, { error: "A customer with that name already exists." });
      await writeAudit(actor.org_id, actor.id, "customer.create", "customer", String(created.accountId), {
        name: v.name,
        kind: v.kind,
        siteId: String(created.siteId),
        ...(created.contactId ? { contactId: String(created.contactId) } : {}),
      });
      return send(res, 201, { id: Number(created.accountId) });
    }

    const timelineMatch = url.pathname.match(/^\/v1\/(accounts|devices)\/(\d+)\/timeline$/);
    if (timelineMatch && req.method === "GET") {
      const access = await customerAccess(actor, res);
      if (!access) return;
      const forDevice = timelineMatch[1] === "devices";
      const scopeId = Number(timelineMatch[2]);
      const owner = await pool.query(
        forDevice ? "SELECT id FROM devices WHERE id = $1 AND org_id = $2" : "SELECT id FROM customers WHERE id = $1 AND org_id = $2",
        [scopeId, actor.org_id],
      );
      if (!owner.rows[0]) return send(res, 404, { error: forDevice ? "Device not found." : "Customer not found." });
      const apps = [access.remote ? "remote" : null, access.service ? "servicedesk" : null].filter(Boolean);
      const params = url.searchParams;
      const filters = {
        groups: (params.get("type") || "").split(",").filter(Boolean),
        device: forDevice ? null : params.get("device") || null,
        actor: params.get("actor") || null,
        from: params.get("from"),
        to: params.get("to"),
        q: params.get("q"),
        before: params.get("before"),
      };
      const query = timelineQuery({ orgId: actor.org_id, ...(forDevice ? { deviceId: scopeId } : { customerId: scopeId }), apps, filters });
      const rows = await pool.query(query.text, query.values);
      const body = timelineView(rows.rows, query.size);
      if (!filters.before) {
        const scope = forDevice ? "device_id" : "customer_id";
        const visible = ["core", ...apps];
        const [deviceOptions, actorOptions] = await Promise.all([
          forDevice ? { rows: [] } : pool.query(
            `SELECT DISTINCT d.id, COALESCE(d.display_name, d.hostname) AS name
             FROM activity_events e JOIN devices d ON d.id = e.device_id AND d.org_id = e.org_id
             WHERE e.org_id = $1 AND e.customer_id = $2 AND e.app = ANY($3::text[]) ORDER BY 2`,
            [actor.org_id, scopeId, visible],
          ),
          pool.query(
            `SELECT DISTINCT u.id, COALESCE(u.name, u.email) AS name
             FROM activity_events e JOIN users u ON u.id = e.actor_user_id
             WHERE e.org_id = $1 AND e.${scope} = $2 AND e.app = ANY($3::text[]) ORDER BY 2`,
            [actor.org_id, scopeId, visible],
          ),
        ]);
        body.options = {
          groups: Object.entries(ACTIVITY_GROUPS)
            .filter(([, group]) => visible.includes(group.app))
            .map(([key, group]) => ({ key, label: group.label })),
          devices: deviceOptions.rows.map((row) => ({ id: Number(row.id), name: row.name })),
          actors: actorOptions.rows.map((row) => ({ id: Number(row.id), name: row.name })),
        };
      }
      return send(res, 200, body);
    }

    const accountMatch = url.pathname.match(/^\/v1\/accounts\/(\d+)$/);
    if (accountMatch && req.method === "DELETE") {
      if (!(await customerAccess(actor, res, { write: true }))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can delete a customer." });
      const result = await inTransaction(async (client) => {
        const found = await client.query(
          "SELECT id, name FROM customers WHERE id = $1 AND org_id = $2 FOR UPDATE",
          [accountMatch[1], actor.org_id],
        );
        if (!found.rows[0]) return { status: 404 };
        const accountId = found.rows[0].id;
        const used = await client.query(
          `SELECT (SELECT count(*)::int FROM tickets WHERE customer_id = $1) AS tickets,
                  (SELECT count(*)::int FROM devices d JOIN sites s ON s.id = d.site_id WHERE s.customer_id = $1) AS devices`,
          [accountId],
        );
        const { tickets, devices } = used.rows[0];
        if (tickets || devices) return { status: 409, tickets, devices };
        await client.query("UPDATE enroll_tokens SET customer_id = NULL WHERE customer_id = $1", [accountId]);
        await client.query(
          "UPDATE devices SET contact_id = NULL WHERE contact_id IN (SELECT id FROM contacts WHERE customer_id = $1)",
          [accountId],
        );
        await client.query("DELETE FROM contacts WHERE customer_id = $1", [accountId]);
        await client.query("DELETE FROM sites WHERE customer_id = $1", [accountId]);
        await client.query("DELETE FROM customers WHERE id = $1", [accountId]);
        await writeAudit(actor.org_id, actor.id, "customer.delete", "customer", String(accountId), { name: found.rows[0].name }, client);
        return { status: 200, id: accountId, name: found.rows[0].name };
      });
      if (result.status === 404) return send(res, 404, { error: "Customer not found." });
      if (result.status === 409) {
        const parts = [];
        if (result.tickets) parts.push(`${result.tickets} ticket${result.tickets === 1 ? "" : "s"}`);
        if (result.devices) parts.push(`${result.devices} device${result.devices === 1 ? "" : "s"}`);
        return send(res, 409, { error: `This customer still has ${parts.join(" and ")}. Move or remove them first.` });
      }
      return send(res, 200, { ok: true });
    }
    if (accountMatch && (req.method === "GET" || req.method === "PUT")) {
      const access = await customerAccess(actor, res, { write: req.method === "PUT" });
      if (!access) return;
      if (req.method === "PUT") {
        const raw = await readJson(req);
        const input = accountInput(raw);
        if (input.error) return send(res, 400, { error: input.error });
        const v = input.values;
        const keepNotes = !raw || !Object.hasOwn(raw, "notes");
        if (await customerNameTaken(pool, actor.org_id, v.name, accountMatch[1])) {
          return send(res, 409, { error: "A customer with that name already exists." });
        }
        const updated = await pool.query(
          `UPDATE customers
           SET name = $1, kind = $2, website = $3, email = $4, phone = $5, alt_phone = $6, address = $7,
               registration_number = $8, vat_number = $9, notes = CASE WHEN $13 THEN notes ELSE $10 END, updated_at = now()
           WHERE id = $11 AND org_id = $12
           RETURNING id`,
          [v.name, v.kind, v.website, v.email, v.phone, v.altPhone, v.address, v.registrationNumber, v.vatNumber, v.notes, accountMatch[1], actor.org_id, keepNotes],
        ).catch((error) => {
          if (error.code === "23505" && error.constraint === "customers_org_name_key") return null;
          throw error;
        });
        if (!updated) return send(res, 409, { error: "A customer with that name already exists." });
        if (!updated.rows[0]) return send(res, 404, { error: "Customer not found." });
        await writeAudit(actor.org_id, actor.id, "customer.update", "customer", String(updated.rows[0].id), { name: v.name, kind: v.kind });
        return send(res, 200, { id: Number(updated.rows[0].id) });
      }
      const account = await pool.query("SELECT * FROM customers WHERE id = $1 AND org_id = $2", [accountMatch[1], actor.org_id]);
      if (!account.rows[0]) return send(res, 404, { error: "Customer not found." });
      const accountId = account.rows[0].id;
      const view = customerView(url, access, res);
      if (view == null) return;
      const { remote, desk } = viewScope(view, access);
      const [contacts, tickets, devices, others, report, sessions, cross, slaRows] = await Promise.all([
        pool.query(
          "SELECT * FROM contacts WHERE customer_id = $1 ORDER BY is_primary DESC, lower(name)",
          [accountId],
        ),
        desk ? pool.query(
          `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at, ${TICKET_SLA_COLUMNS},
                  ct.name AS contact_name, d.hostname AS device_hostname, u.name AS assignee_name
           FROM tickets t
           LEFT JOIN devices d ON d.id = t.device_id
           LEFT JOIN users u ON u.id = t.assignee_user_id
           ${TICKET_CONTACT_JOIN}
           WHERE t.customer_id = $1
           ORDER BY t.id DESC
           LIMIT 200`,
          [accountId],
        ) : { rows: [] },
        remote
          ? pool.query(
            `SELECT d.id, d.hostname, d.display_name, d.os_name, d.last_seen_at, d.ipv4, d.agent_version,
                    d.users, d.contact_id, d.mesh_node_id IS NOT NULL AS has_remote
             FROM devices d
             JOIN sites s ON s.id = d.site_id
             WHERE s.customer_id = $1 AND d.org_id = $2
             ORDER BY lower(COALESCE(d.display_name, d.hostname))`,
            [accountId, actor.org_id],
          )
          : { rows: [] },
        remote && access.active && canOperate(actor)
          ? pool.query(
            `SELECT d.id, d.hostname, d.display_name, c.name AS customer_name
             FROM devices d
             LEFT JOIN sites s ON s.id = d.site_id
             LEFT JOIN customers c ON c.id = s.customer_id
             WHERE d.org_id = $1 AND (s.customer_id IS NULL OR s.customer_id <> $2)
             ORDER BY c.name NULLS FIRST, lower(COALESCE(d.display_name, d.hostname))`,
            [actor.org_id, accountId],
          )
          : { rows: [] },
        desk && (view === "desk" || access.reporting)
          ? pool.query(
            `SELECT count(*) FILTER (WHERE t.created_at > now() - interval '30 days')::int AS opened_30,
                    count(*) FILTER (WHERE t.status = 'resolved' AND t.updated_at > now() - interval '30 days')::int AS resolved_30,
                    count(*) FILTER (WHERE t.status <> 'resolved')::int AS open_now,
                    count(*) FILTER (
                      WHERE t.status <> 'resolved'
                        AND COALESCE(sp.resolve_minutes, os.resolve_minutes) IS NOT NULL
                        AND t.created_at + make_interval(mins => COALESCE(sp.resolve_minutes, os.resolve_minutes)) < now()
                    )::int AS overdue_now,
                    count(*)::int AS total
             FROM tickets t
             JOIN customers c ON c.id = t.customer_id
             LEFT JOIN sla_plans sp ON sp.id = c.sla_plan_id
             LEFT JOIN org_slas os ON os.org_id = c.org_id
             WHERE t.customer_id = $1 AND t.org_id = $2`,
            [accountId, actor.org_id],
          )
          : { rows: [] },
        view === "remote"
          ? pool.query(
            `SELECT * FROM (
               SELECT 'remote' AS kind, e.created_at, d.id AS device_id, COALESCE(d.display_name, d.hostname) AS device_name,
                      u.name AS technician, e.detail->>'user' AS session_user, NULL::text AS status
               FROM audit_events e
               JOIN devices d ON e.target_id = d.id::text
               JOIN sites s ON s.id = d.site_id
               LEFT JOIN users u ON u.id = e.actor_user_id
               WHERE e.org_id = $2 AND e.target_type = 'device' AND e.action = 'remote.launch' AND s.customer_id = $1
               UNION ALL
               SELECT 'support', ss.created_at, NULL, ss.hostname, u.name, NULL, ss.status
               FROM support_sessions ss
               JOIN tickets t ON t.id = ss.ticket_id
               LEFT JOIN users u ON u.id = ss.created_by
               WHERE ss.org_id = $2 AND t.customer_id = $1
             ) x
             ORDER BY created_at DESC
             LIMIT 100`,
            [accountId, actor.org_id],
          )
          : { rows: [] },
        view === "remote" && access.service
          ? pool.query(
            "SELECT count(*)::int AS n FROM tickets WHERE customer_id = $1 AND org_id = $2 AND status <> 'resolved'",
            [accountId, actor.org_id],
          )
          : view === "desk" && access.remote
            ? pool.query(
              "SELECT count(*)::int AS n FROM devices d JOIN sites s ON s.id = d.site_id WHERE s.customer_id = $1 AND d.org_id = $2",
              [accountId, actor.org_id],
            )
            : { rows: [] },
        view === "desk" ? slaBook(actor.org_id) : null,
      ]);
      const reportRow = report.rows[0];
      let slaInfo = null;
      if (slaRows) {
        const book = slaRows;
        const row = account.rows[0];
        const plan = row.sla_plan_id != null ? book.plans.get(String(row.sla_plan_id)) : null;
        const targets = plan || book.base;
        slaInfo = {
          planId: plan ? plan.id : null,
          planName: plan ? plan.name : book.base ? "Default" : null,
          responseMinutes: targets ? targets.responseMinutes : null,
          resolveMinutes: targets ? targets.resolveMinutes : null,
          defaultTargets: book.base,
          plans: [...book.plans.values()],
          contractStart: row.contract_start ? dateOnly(row.contract_start) : null,
          contractEnd: row.contract_end ? dateOnly(row.contract_end) : null,
          contractNotes: row.contract_notes || null,
        };
      }
      const slaTargets = slaRows ? slaFor(slaRows, account.rows[0].sla_plan_id) : null;
      if (reportRow && slaTargets && tickets.rows.length < 200) {
        const now = new Date();
        reportRow.overdue_now = tickets.rows.filter((row) => isOverdue(row, slaTargets, now)).length;
      }
      const timeRows = view === "desk"
        ? await pool.query(
          `SELECT te.id, te.minutes, te.billable, te.note, te.source, te.created_at, te.ticket_id, t.subject,
                  u.name AS user_name,
                  sum(te.minutes) OVER ()::int AS total_minutes,
                  (sum(te.minutes) FILTER (WHERE te.billable) OVER ())::int AS billable_minutes
           FROM ticket_time_entries te
           JOIN tickets t ON t.id = te.ticket_id AND t.org_id = te.org_id
           LEFT JOIN users u ON u.id = te.user_id
           WHERE t.customer_id = $1 AND te.org_id = $2
           ORDER BY te.created_at DESC, te.id DESC`,
          [accountId, actor.org_id],
        )
        : null;
      return send(res, 200, {
        account: accountView(account.rows[0]),
        view,
        ...(timeRows ? {
          time: {
            totalMinutes: timeRows.rows[0]?.total_minutes || 0,
            billableMinutes: timeRows.rows[0]?.billable_minutes || 0,
            entries: timeRows.rows.slice(0, 200).map((row) => ({
              id: Number(row.id),
              ticketId: Number(row.ticket_id),
              ticketSubject: row.subject,
              minutes: row.minutes,
              billable: row.billable,
              note: row.note,
              source: row.source,
              userName: row.user_name || "Removed user",
              createdAt: row.created_at,
            })),
          },
        } : {}),
        report: reportRow
          ? {
            ticketsOpened30: reportRow.opened_30,
            ticketsResolved30: reportRow.resolved_30,
            ticketsOpen: reportRow.open_now,
            ticketsOverdue: reportRow.overdue_now,
            ticketsTotal: reportRow.total,
          }
          : null,
        contacts: contacts.rows.map(contactView),
        ...(desk ? {
          tickets: tickets.rows.map((row) => {
            const due = view === "desk" ? ticketDue(row, slaTargets) : null;
            return {
              id: Number(row.id),
              subject: row.subject,
              status: row.status,
              priority: row.priority,
              contactName: row.contact_name || null,
              deviceHostname: view === "desk" && !access.remote ? null : row.device_hostname,
              assigneeName: row.assignee_name || null,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              dueAt: due ? due.toISOString() : null,
              overdue: view === "desk" ? isOverdue(row, slaTargets) : false,
            };
          }),
        } : {}),
        ...(slaInfo ? { sla: slaInfo } : {}),
        ...(view === "remote" ? {
          sessions: sessions.rows.map((row) => ({
            kind: row.kind,
            at: row.created_at,
            deviceId: row.device_id == null ? null : Number(row.device_id),
            deviceName: row.device_name || null,
            technician: row.technician || null,
            user: row.session_user || null,
            status: row.status || null,
          })),
          crossLink: access.service ? { openTickets: cross.rows[0]?.n || 0 } : null,
          canRemote: remoteAccess(access.row).canRemote,
        } : {}),
        ...(view === "desk" ? { crossLink: access.remote ? { devices: cross.rows[0]?.n || 0 } : null } : {}),
        ...(view === "desk" ? { insights: await customerInsights(actor.org_id, accountId, { devices: access.remote }) } : {}),
        ...(remote ? { devices: devices.rows.map((row) => {
          const users = Array.isArray(row.users) ? row.users : [];
          const suggested = row.contact_id == null ? suggestContact(users, contacts.rows) : null;
          return {
            id: Number(row.id),
            hostname: row.hostname,
            displayName: row.display_name || row.hostname,
            osName: row.os_name || null,
            ipv4: row.ipv4 || null,
            agentVersion: row.agent_version || null,
            presence: presenceFrom(row.last_seen_at),
            lastSeenAt: row.last_seen_at,
            users,
            contactId: row.contact_id == null ? null : Number(row.contact_id),
            suggestedContact: suggested ? { id: Number(suggested.id), name: suggested.name } : null,
            hasRemote: row.has_remote === true,
          };
        }),
        linkable: others.rows.map((row) => ({
          id: Number(row.id),
          name: row.display_name || row.hostname,
          accountName: row.customer_name || null,
        })) } : {}),
        canAssets: access.remote,
        canOperate: canOperate(actor),
        ...customerFlags(access, actor),
      });
    }

    const accountContactsMatch = url.pathname.match(/^\/v1\/accounts\/(\d+)\/contacts$/);
    if (req.method === "POST" && accountContactsMatch) {
      if (!(await customerAccess(actor, res, { write: true }))) return;
      const input = contactInput(await readJson(req));
      if (input.error) return send(res, 400, { error: input.error });
      const c = input.values;
      const account = await pool.query("SELECT id FROM customers WHERE id = $1 AND org_id = $2", [accountContactsMatch[1], actor.org_id]);
      if (!account.rows[0]) return send(res, 404, { error: "Account not found." });
      const accountId = account.rows[0].id;
      const contactId = await inTransaction(async (client) => {
        await client.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [accountId]);
        const existing = await client.query("SELECT 1 FROM contacts WHERE customer_id = $1 AND is_primary", [accountId]);
        const row = await client.query(
          `INSERT INTO contacts (org_id, customer_id, name, email, phone, alt_phone, job_title)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [actor.org_id, accountId, c.name, c.email, c.phone, c.altPhone, c.jobTitle],
        );
        if (c.primary || !existing.rows[0]) await setPrimaryContact(client, accountId, row.rows[0].id);
        return row.rows[0].id;
      });
      await writeAudit(actor.org_id, actor.id, "contact.create", "contact", String(contactId), { accountId: String(accountId), name: c.name });
      return send(res, 201, { id: Number(contactId) });
    }

    const contactMatch = url.pathname.match(/^\/v1\/contacts\/(\d+)$/);
    if (contactMatch && (req.method === "PUT" || req.method === "DELETE")) {
      if (!(await customerAccess(actor, res, { write: true }))) return;
      const found = await pool.query("SELECT id, customer_id, is_primary FROM contacts WHERE id = $1 AND org_id = $2", [contactMatch[1], actor.org_id]);
      if (!found.rows[0]) return send(res, 404, { error: "Contact not found." });
      const { id: contactId, customer_id: accountId } = found.rows[0];
      if (req.method === "PUT") {
        const input = contactInput(await readJson(req));
        if (input.error) return send(res, 400, { error: input.error });
        const c = input.values;
        await inTransaction(async (client) => {
          await client.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [accountId]);
          await client.query(
            `UPDATE contacts
             SET name = $1, email = $2, phone = $3, alt_phone = $4, job_title = $5, updated_at = now()
             WHERE id = $6`,
            [c.name, c.email, c.phone, c.altPhone, c.jobTitle, contactId],
          );
          if (c.primary) await setPrimaryContact(client, accountId, contactId);
        });
        await writeAudit(actor.org_id, actor.id, "contact.update", "contact", String(contactId), { name: c.name, primary: c.primary });
        return send(res, 200, { id: Number(contactId) });
      }
      await inTransaction(async (client) => {
        await client.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [accountId]);
        await client.query("UPDATE tickets SET contact_id = NULL WHERE contact_id = $1", [contactId]);
        await client.query("UPDATE devices SET contact_id = NULL WHERE contact_id = $1", [contactId]);
        await client.query("DELETE FROM contacts WHERE id = $1", [contactId]);
        if (found.rows[0].is_primary) {
          const next = await client.query("SELECT id FROM contacts WHERE customer_id = $1 ORDER BY id LIMIT 1", [accountId]);
          if (next.rows[0]) await setPrimaryContact(client, accountId, next.rows[0].id);
        }
      });
      await writeAudit(actor.org_id, actor.id, "contact.delete", "contact", String(contactId), { accountId: String(accountId) });
      return send(res, 200, { ok: true });
    }

    const accountDeviceMatch = url.pathname.match(/^\/v1\/accounts\/(\d+)\/devices(?:\/(\d+))?$/);
    if (accountDeviceMatch && req.method === "PUT" && accountDeviceMatch[2]) {
      const access = await customerAccess(actor, res, { write: true });
      if (!access) return;
      if (!access.remote) return send(res, 403, { error: "Devices need Remote Desk on the licence." });
      const body = await readJson(req);
      const contactId = body.contactId == null || body.contactId === "" ? null : Number(body.contactId);
      if (contactId != null && !Number.isInteger(contactId)) return send(res, 400, { error: "Choose a contact." });
      if (contactId != null) {
        const contact = await pool.query(
          "SELECT id FROM contacts WHERE id = $1 AND customer_id = $2 AND org_id = $3",
          [contactId, accountDeviceMatch[1], actor.org_id],
        );
        if (!contact.rows[0]) return send(res, 400, { error: "Choose a contact on this account." });
      }
      const updated = await pool.query(
        `UPDATE devices d SET contact_id = $1
         FROM sites s
         WHERE s.id = d.site_id AND s.customer_id = $2 AND d.id = $3 AND d.org_id = $4
         RETURNING d.id`,
        [contactId, accountDeviceMatch[1], accountDeviceMatch[2], actor.org_id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "That device is not on this account." });
      await writeAudit(actor.org_id, actor.id, "device.assign", "device", String(updated.rows[0].id), {
        customerId: String(accountDeviceMatch[1]),
        contactId: contactId == null ? null : String(contactId),
      });
      return send(res, 200, { ok: true });
    }
    if (accountDeviceMatch && ((req.method === "POST" && !accountDeviceMatch[2]) || (req.method === "DELETE" && accountDeviceMatch[2]))) {
      const access = await customerAccess(actor, res, { write: true });
      if (!access) return;
      if (!access.remote) return send(res, 403, { error: "Linking devices needs Remote Desk on the licence." });
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can link devices." });
      const deviceId = req.method === "POST" ? Number((await readJson(req)).deviceId) : Number(accountDeviceMatch[2]);
      if (!Number.isInteger(deviceId)) return send(res, 400, { error: "Choose a device." });
      const site = await pool.query(
        "SELECT id FROM sites WHERE customer_id = $1 AND org_id = $2 ORDER BY id LIMIT 1",
        [accountDeviceMatch[1], actor.org_id],
      );
      if (!site.rows[0]) return send(res, 404, { error: "Account not found." });
      const accountId = String(accountDeviceMatch[1]);
      if (req.method === "POST") {
        const before = await pool.query(
          `SELECT s.customer_id FROM devices d LEFT JOIN sites s ON s.id = d.site_id WHERE d.id = $1 AND d.org_id = $2`,
          [deviceId, actor.org_id],
        );
        if (!before.rows[0]) return send(res, 404, { error: "Device not found." });
        await pool.query(
          "UPDATE devices SET site_id = $1, contact_id = NULL WHERE id = $2 AND org_id = $3",
          [site.rows[0].id, deviceId, actor.org_id],
        );
        await writeAudit(actor.org_id, actor.id, "device.link", "device", String(deviceId), {
          customerId: accountId,
          siteId: String(site.rows[0].id),
          ...(before.rows[0].customer_id ? { fromCustomerId: String(before.rows[0].customer_id) } : {}),
        });
        return send(res, 200, { ok: true });
      }
      const removed = await pool.query(
        `UPDATE devices d SET site_id = NULL, contact_id = NULL
         FROM sites s
         WHERE s.id = d.site_id AND s.customer_id = $1 AND d.id = $2 AND d.org_id = $3
         RETURNING d.id`,
        [accountDeviceMatch[1], deviceId, actor.org_id],
      );
      if (!removed.rows[0]) return send(res, 404, { error: "That device is not on this account." });
      await writeAudit(actor.org_id, actor.id, "device.unlink", "device", String(deviceId), { customerId: accountId });
      return send(res, 200, { ok: true });
    }

    if (req.method === "PUT" && url.pathname === "/v1/sla") {
      if (!(await requireTicketing(actor, res))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can change SLA targets." });
      const body = await readJson(req);
      const responseMinutes = slaMinutes(body.responseMinutes);
      const resolveMinutes = slaMinutes(body.resolveMinutes);
      if (responseMinutes == null || resolveMinutes == null) {
        return send(res, 400, { error: "Enter response and resolve targets in minutes." });
      }
      const percent = parsePercent(body.priorityPercent);
      if (percent.error) return send(res, 400, { error: percent.error });
      await pool.query(
        `INSERT INTO org_slas (org_id, response_minutes, resolve_minutes, priority_percent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id) DO UPDATE
         SET response_minutes = EXCLUDED.response_minutes,
             resolve_minutes = EXCLUDED.resolve_minutes,
             priority_percent = EXCLUDED.priority_percent,
             updated_at = now()`,
        [actor.org_id, responseMinutes, resolveMinutes, JSON.stringify(percent.value)],
      );
      await writeAudit(actor.org_id, actor.id, "sla.update", "org", String(actor.org_id), {
        responseMinutes,
        resolveMinutes,
        priorityPercent: percent.value,
      });
      return send(res, 200, { responseMinutes, resolveMinutes, priorityPercent: percent.value });
    }

    if (req.method === "GET" && url.pathname === "/v1/sla-plans") {
      if (!(await requireTicketing(actor, res))) return;
      const [base, plans] = await Promise.all([
        orgSla(actor.org_id),
        pool.query(
          `SELECT p.id, p.name, p.response_minutes, p.resolve_minutes, p.priority_percent,
                  (SELECT count(*)::int FROM customers c WHERE c.sla_plan_id = p.id) AS customer_count
           FROM sla_plans p
           WHERE p.org_id = $1
           ORDER BY lower(p.name)`,
          [actor.org_id],
        ),
      ]);
      return send(res, 200, {
        default: base,
        plans: plans.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          responseMinutes: row.response_minutes,
          resolveMinutes: row.resolve_minutes,
          priorityPercent: percentFrom(row.priority_percent),
          customerCount: row.customer_count,
        })),
      });
    }

    const slaPlanMatch = url.pathname.match(/^\/v1\/sla-plans(?:\/(\d+))?$/);
    if (slaPlanMatch && ((req.method === "POST" && !slaPlanMatch[1]) || ((req.method === "PUT" || req.method === "DELETE") && slaPlanMatch[1]))) {
      if (!(await requireTicketing(actor, res))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can change SLA plans." });
      if (req.method === "DELETE") {
        const removed = await inTransaction(async (client) => {
          const found = await client.query(
            "SELECT id, name FROM sla_plans WHERE id = $1 AND org_id = $2 FOR UPDATE",
            [slaPlanMatch[1], actor.org_id],
          );
          if (!found.rows[0]) return null;
          const moved = await client.query(
            "UPDATE customers SET sla_plan_id = NULL WHERE sla_plan_id = $1 AND org_id = $2",
            [found.rows[0].id, actor.org_id],
          );
          await client.query("DELETE FROM sla_plans WHERE id = $1", [found.rows[0].id]);
          return { ...found.rows[0], moved: moved.rowCount };
        });
        if (!removed) return send(res, 404, { error: "SLA plan not found." });
        await writeAudit(actor.org_id, actor.id, "sla_plan.delete", "sla_plan", String(removed.id), {
          name: removed.name,
          customersMovedToDefault: removed.moved,
        });
        return send(res, 200, { ok: true });
      }
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const responseMinutes = slaMinutes(body.responseMinutes);
      const resolveMinutes = slaMinutes(body.resolveMinutes);
      if (!name || name.length > 80) return send(res, 400, { error: "Enter a plan name (up to 80 characters)." });
      if (name.toLowerCase() === "default") return send(res, 400, { error: "\"Default\" is the tenant target. Choose another name." });
      if (responseMinutes == null || resolveMinutes == null) {
        return send(res, 400, { error: "Enter response and resolve targets in minutes." });
      }
      const percent = parsePercent(body.priorityPercent);
      if (percent.error) return send(res, 400, { error: percent.error });
      const percentJson = JSON.stringify(percent.value);
      const saved = await (req.method === "POST"
        ? pool.query(
          `INSERT INTO sla_plans (org_id, name, response_minutes, resolve_minutes, priority_percent)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [actor.org_id, name, responseMinutes, resolveMinutes, percentJson],
        )
        : pool.query(
          `UPDATE sla_plans SET name = $1, response_minutes = $2, resolve_minutes = $3, priority_percent = $6, updated_at = now()
           WHERE id = $4 AND org_id = $5 RETURNING id`,
          [name, responseMinutes, resolveMinutes, slaPlanMatch[1], actor.org_id, percentJson],
        )).catch((error) => {
        if (error.code === "23505") return null;
        throw error;
      });
      if (!saved) return send(res, 409, { error: "A plan with that name already exists." });
      if (!saved.rows[0]) return send(res, 404, { error: "SLA plan not found." });
      await writeAudit(actor.org_id, actor.id, req.method === "POST" ? "sla_plan.create" : "sla_plan.update", "sla_plan", String(saved.rows[0].id), {
        name,
        responseMinutes,
        resolveMinutes,
        priorityPercent: percent.value,
      });
      return send(res, req.method === "POST" ? 201 : 200, { id: Number(saved.rows[0].id) });
    }

    const accountSlaMatch = url.pathname.match(/^\/v1\/accounts\/(\d+)\/sla$/);
    if (req.method === "PUT" && accountSlaMatch) {
      const access = await customerAccess(actor, res, { write: true });
      if (!access) return;
      if (!access.service) return send(res, 403, { error: "Service Desk is not in your package.", code: "app_not_entitled", app: "servicedesk" });
      const body = await readJson(req);
      const planId = body.planId == null || body.planId === "" ? null : Number(body.planId);
      if (planId != null && !Number.isInteger(planId)) return send(res, 400, { error: "Choose an SLA plan." });
      const day = (value) => {
        if (value == null || value === "") return { value: null };
        const text = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return { error: true };
        return { value: text };
      };
      const start = day(body.contractStart);
      const end = day(body.contractEnd);
      if (start.error || end.error) return send(res, 400, { error: "Enter contract dates as YYYY-MM-DD." });
      if (start.value && end.value && end.value < start.value) return send(res, 400, { error: "The contract can't end before it starts." });
      const notes = typeof body.contractNotes === "string" ? body.contractNotes.trim() : "";
      if (notes.length > 4000) return send(res, 400, { error: "Contract notes are too long." });
      if (planId != null) {
        const plan = await pool.query("SELECT id FROM sla_plans WHERE id = $1 AND org_id = $2", [planId, actor.org_id]);
        if (!plan.rows[0]) return send(res, 400, { error: "Choose an SLA plan." });
      }
      const updated = await pool.query(
        `UPDATE customers
         SET sla_plan_id = $1, contract_start = $2, contract_end = $3, contract_notes = $4, updated_at = now()
         WHERE id = $5 AND org_id = $6
         RETURNING id`,
        [planId, start.value, end.value, notes || null, accountSlaMatch[1], actor.org_id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Customer not found." });
      await writeAudit(actor.org_id, actor.id, "customer.sla", "customer", String(updated.rows[0].id), {
        planId: planId == null ? null : String(planId),
        contractStart: start.value,
        contractEnd: end.value,
      });
      return send(res, 200, { ok: true });
    }

    const accountNotesMatch = url.pathname.match(/^\/v1\/accounts\/(\d+)\/notes$/);
    if (req.method === "PUT" && accountNotesMatch) {
      if (!(await customerAccess(actor, res, { write: true }))) return;
      const body = await readJson(req);
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (notes.length > 4000) return send(res, 400, { error: "Notes are too long." });
      const updated = await pool.query(
        "UPDATE customers SET notes = $1, updated_at = now() WHERE id = $2 AND org_id = $3 RETURNING id",
        [notes || null, accountNotesMatch[1], actor.org_id],
      );
      if (!updated.rows[0]) return send(res, 404, { error: "Customer not found." });
      await writeAudit(actor.org_id, actor.id, "customer.notes", "customer", String(updated.rows[0].id), { length: notes.length });
      return send(res, 200, { ok: true });
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
        licenseQuery(actor.org_id),
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
      const outcome = await createAlertTicket(actor.org_id, alertTicketMatch[1], actor.id);
      if (outcome.error) return send(res, outcome.status, { error: outcome.error });
      return send(res, outcome.created ? 201 : 200, { id: outcome.id });
    }

    if (req.method === "GET" && url.pathname === "/v1/dashboard/overview") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      const license = (await licenseQuery(actor.org_id)).rows[0];
      const monitor = monitoringAllowed(license);
      const patch = patchAllowed(license);
      const ticketing = ticketingAllowed(license);
      const customers = await pool.query(
        "SELECT id, name FROM customers WHERE org_id = $1 ORDER BY name",
        [actor.org_id],
      );
      let customer = customerScope(url.searchParams.get("customer"));
      if (customer && customer !== "none" && !customers.rows.some((row) => String(row.id) === customer)) customer = null;
      const { items, releases } = await fleetItems(actor.org_id, { patch, customer });
      const overview = overviewFrom(items, { releases, monitor, patch });
      let tickets = null;
      if (ticketing) {
        const book = await slaBook(actor.org_id);
        const unresolved = await pool.query(
          `SELECT t.id, t.status, t.created_at, c.sla_plan_id, ${TICKET_SLA_COLUMNS}
           FROM tickets t
           JOIN customers c ON c.id = t.customer_id
           WHERE t.org_id = $1 AND t.status <> 'resolved'
             AND ($2::text IS NULL OR c.id::text = $2)`,
          [actor.org_id, customer === "none" ? "-1" : customer],
        );
        const now = new Date();
        const overdue = unresolved.rows.filter((ticket) => isOverdue(ticket, slaFor(book, ticket.sla_plan_id), now)).length;
        tickets = {
          open: unresolved.rows.filter((ticket) => ticket.status === "open").length,
          overdue,
          sla: Boolean(book.base) || book.plans.size > 0,
        };
      }
      let alerts = null;
      if (monitor) {
        const scope = `($2::text IS NULL OR ($2 = 'none' AND s.customer_id IS NULL) OR s.customer_id::text = $2)`;
        const [recent, byCustomer] = await Promise.all([
          pool.query(
            `SELECT a.id, a.metric, a.value, a.threshold, a.created_at, d.id AS device_id,
                    COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name
             FROM alerts a
             JOIN devices d ON d.id = a.device_id AND d.org_id = a.org_id
             LEFT JOIN sites s ON s.id = d.site_id
             WHERE a.org_id = $1 AND ${scope}
             ORDER BY a.id DESC
             LIMIT 5`,
            [actor.org_id, customer],
          ),
          pool.query(
            `SELECT s.customer_id, count(*)::int AS count
             FROM alerts a
             JOIN devices d ON d.id = a.device_id AND d.org_id = a.org_id
             JOIN sites s ON s.id = d.site_id
             WHERE a.org_id = $1 AND a.created_at > now() - interval '7 days' AND ${scope}
             GROUP BY s.customer_id
             ORDER BY count DESC
             LIMIT 5`,
            [actor.org_id, customer],
          ),
        ]);
        const names = new Map(customers.rows.map((row) => [String(row.id), row.name]));
        alerts = {
          recent: recent.rows.map((row) => ({
            id: Number(row.id),
            deviceId: Number(row.device_id),
            device: row.device_name,
            metric: ALERT_LABELS[row.metric] || row.metric,
            value: row.value,
            threshold: row.threshold,
            createdAt: row.created_at,
          })),
          topCustomers: byCustomer.rows.map((row) => ({
            id: Number(row.customer_id),
            name: names.get(String(row.customer_id)) || "Customer",
            count: row.count,
          })),
        };
      }
      const org = await pool.query("SELECT name FROM orgs WHERE id = $1", [actor.org_id]);
      return send(res, 200, {
        ...overview,
        orgName: org.rows[0]?.name || "",
        customer,
        customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
        tickets,
        alerts,
        canMonitor: monitor,
        canPatch: patch,
        canTicket: ticketing,
        canReport: reportingAllowed(license),
        canUpdateAgents: canOperate(actor),
        generatedAt: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/devices/agent-update/outdated") {
      if (!requireActor(actor, res)) return;
      if (!actor.org_id) return send(res, 403, { error: "This account is not in an org." });
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "agent.update.deny", "device", "bulk", { reason: "role" });
        return send(res, 403, { error: "Only an owner or admin can update agents." });
      }
      const body = await readJson(req);
      const [release, linux] = await Promise.all([agentRelease(), linuxRelease()]);
      if (!release && !linux) return send(res, 503, { error: "No agent build is published yet." });
      const { items } = await fleetItems(actor.org_id, { customer: customerScope(body.customer) });
      const updatable = items.filter((item) => item.facts.updatable);
      const ids = updatable.filter((item) => item.facts.platform === "windows").map((item) => Number(item.row.id));
      const linuxIds = updatable.filter((item) => item.facts.platform === "linux").map((item) => Number(item.row.id));
      if (ids.length) {
        await pool.query(
          "UPDATE devices SET agent_update_requested_at = now() WHERE org_id = $1 AND id = ANY($2::bigint[])",
          [actor.org_id, ids],
        );
      }
      const sent = [];
      const failed = [];
      if (linuxIds.length && linux) {
        const rows = await pool.query(
          "SELECT id, hostname, display_name, mesh_node_id, os_name, agent_version FROM devices WHERE org_id = $1 AND id = ANY($2::bigint[])",
          [actor.org_id, linuxIds],
        );
        for (const row of rows.rows) {
          const problem = await sendLinuxUpdate(row, actor.org_id, linux);
          if (problem) failed.push({ id: Number(row.id), hostname: row.hostname, error: problem });
          else sent.push(Number(row.id));
        }
      }
      if (!ids.length && !linuxIds.length) return send(res, 200, { queued: 0, sent: 0, failed: [], version: release?.version || "" });
      await writeAudit(actor.org_id, actor.id, "agent.update.bulk", "device", "bulk", {
        to: release?.version || "",
        toLinux: linux?.version || "",
        devices: ids,
        linux: sent,
        ...(failed.length ? { failed: failed.map((item) => item.id) } : {}),
      });
      return send(res, 202, { queued: ids.length, sent: sent.length, failed, version: release?.version || "", linuxVersion: linux?.version || "" });
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

    if (req.method === "GET" && url.pathname === "/v1/reports") {
      if (!(await requireReporting(actor, res))) return;
      const license = (await licenseQuery(actor.org_id)).rows[0];
      const customers = await pool.query("SELECT id, name FROM customers WHERE org_id = $1 ORDER BY lower(name)", [actor.org_id]);
      const ticketing = ticketingAllowed(license);
      return send(res, 200, {
        reports: REPORTS.map(({ key, title, description, needs }) => ({ key, title, description, available: needs !== "ticketing" || ticketing })),
        customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
        canManage: canOperate(actor),
      });
    }

    const reportMatch = url.pathname.match(/^\/v1\/reports\/([a-z-]{2,20})$/);
    if (req.method === "GET" && reportMatch) {
      if (!(await requireReporting(actor, res))) return;
      const format = String(url.searchParams.get("format") || "json");
      if (!["json", "csv", "pdf"].includes(format)) return send(res, 400, { error: "Choose json, csv or pdf." });
      const rawCustomer = String(url.searchParams.get("customer") || "");
      const customer = customerScope(rawCustomer);
      if (rawCustomer && customer == null) return send(res, 404, { error: "Customer not found." });
      const { from, to } = reportRange(url.searchParams.get("from"), url.searchParams.get("to"));
      const drill = {
        country: String(url.searchParams.get("country") || "").trim().slice(0, 100),
        region: String(url.searchParams.get("region") || "").trim().slice(0, 100),
      };
      if (!drill.country) drill.region = "";
      const [license, org] = await Promise.all([
        licenseQuery(actor.org_id),
        pool.query("SELECT name FROM orgs WHERE id = $1", [actor.org_id]),
      ]);
      let report;
      try {
        report = await makeReport(reportMatch[1], {
          orgId: actor.org_id, orgName: org.rows[0]?.name || "", customer, from, to, drill, license: license.rows[0],
        });
      } catch (error) {
        if (error.status) return send(res, error.status, { error: error.message });
        throw error;
      }
      if (format === "json") return send(res, 200, reportJson(report));
      await writeAudit(actor.org_id, actor.id, "report.download", "report", report.key, { format, from, to, customer });
      const body = format === "csv" ? Buffer.from(reportCsv(report), "utf8") : reportPdf(report);
      res.writeHead(200, {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        "content-disposition": `attachment; filename="${reportFileName(report, format)}"`,
        "content-length": body.length,
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/report-subscriptions") {
      if (!(await requireReporting(actor, res))) return;
      const [subs, deliveries, contacts, schedule] = await Promise.all([
        pool.query(
          `SELECT rs.id, rs.report_key, rs.customer_id, c.name AS customer_name, rs.contact_id, ct.name AS contact_name,
                  rs.email, rs.next_run_at, rs.created_at, u.name AS created_by_name
           FROM report_subscriptions rs
           LEFT JOIN customers c ON c.id = rs.customer_id
           LEFT JOIN contacts ct ON ct.id = rs.contact_id
           LEFT JOIN users u ON u.id = rs.created_by
           WHERE rs.org_id = $1
           ORDER BY rs.id`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT d.id, d.report_key, c.name AS customer_name, d.email, d.period_from::text, d.period_to::text,
                  d.status, d.detail, d.pdf_bytes, d.created_at
           FROM report_deliveries d
           LEFT JOIN customers c ON c.id = d.customer_id
           WHERE d.org_id = $1
           ORDER BY d.id DESC
           LIMIT 50`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT ct.id, ct.customer_id, ct.name, ct.email, ct.is_primary
           FROM contacts ct
           WHERE ct.org_id = $1 AND ct.email IS NOT NULL AND btrim(ct.email) <> ''
           ORDER BY ct.is_primary DESC, lower(ct.name)`,
          [actor.org_id],
        ),
        latestExport(actor.org_id),
      ]);
      const title = (key) => reportByKey(key)?.title || key;
      return send(res, 200, {
        subscriptions: subs.rows.map((row) => ({
          id: Number(row.id), report: row.report_key, reportTitle: title(row.report_key),
          customerId: row.customer_id == null ? null : Number(row.customer_id), customerName: row.customer_name || "All customers",
          contactName: row.contact_name || null, email: row.email, nextRunAt: row.next_run_at, createdBy: row.created_by_name || null,
        })),
        deliveries: deliveries.rows.map((row) => ({
          id: Number(row.id), report: row.report_key, reportTitle: title(row.report_key), customerName: row.customer_name || "All customers",
          email: row.email, from: row.period_from, to: row.period_to, status: row.status, detail: row.detail,
          pdfBytes: row.pdf_bytes, createdAt: row.created_at,
        })),
        contacts: contacts.rows.map((row) => ({ id: Number(row.id), customerId: Number(row.customer_id), name: row.name, email: row.email, primary: row.is_primary })),
        schedule: schedule ? { ...schedule, latest: schedule.latest ? { ...schedule.latest, csv: undefined } : null } : null,
        canManage: canOperate(actor),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/report-subscriptions") {
      if (!(await requireReporting(actor, res, { deny: true }))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can schedule emailed reports." });
      const body = await readJson(req);
      const meta = reportByKey(String(body.report || ""));
      if (!meta) return send(res, 400, { error: "Choose a report." });
      const license = (await licenseQuery(actor.org_id)).rows[0];
      if (meta.needs === "ticketing" && !ticketingAllowed(license)) return send(res, 403, { error: "Service Desk reports need Service Desk in your package." });
      let customerId = null;
      if (body.customerId != null && body.customerId !== "") {
        const found = await pool.query("SELECT id FROM customers WHERE id = $1 AND org_id = $2", [Number(body.customerId) || 0, actor.org_id]);
        if (!found.rows[0]) return send(res, 404, { error: "Customer not found." });
        customerId = Number(found.rows[0].id);
      }
      let contactId = null;
      let email = String(body.email || "").trim().toLowerCase();
      if (body.contactId != null && body.contactId !== "") {
        const contact = await pool.query(
          "SELECT id, customer_id, email FROM contacts WHERE id = $1 AND org_id = $2",
          [Number(body.contactId) || 0, actor.org_id],
        );
        const row = contact.rows[0];
        if (!row) return send(res, 404, { error: "Contact not found." });
        if (customerId != null && Number(row.customer_id) !== customerId) return send(res, 400, { error: "That contact belongs to a different customer." });
        if (!row.email) return send(res, 400, { error: "That contact has no email address." });
        contactId = Number(row.id);
        email = String(row.email).trim().toLowerCase();
      }
      if (!/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(email) || email.length > 254) {
        return send(res, 400, { error: "Enter a valid email address." });
      }
      const inserted = await pool.query(
        `INSERT INTO report_subscriptions (org_id, report_key, customer_id, contact_id, email, next_run_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, next_run_at`,
        [actor.org_id, meta.key, customerId, contactId, email, nextMonthlyRun(), actor.id],
      );
      await writeAudit(actor.org_id, actor.id, "report.subscribe", "report_subscription", String(inserted.rows[0].id), {
        report: meta.key, customerId, contactId,
      });
      return send(res, 201, { id: Number(inserted.rows[0].id), nextRunAt: inserted.rows[0].next_run_at });
    }

    const subscriptionMatch = url.pathname.match(/^\/v1\/report-subscriptions\/(\d{1,18})(\/send)?$/);
    if (subscriptionMatch && ((req.method === "DELETE" && !subscriptionMatch[2]) || (req.method === "POST" && subscriptionMatch[2]))) {
      if (!(await requireReporting(actor, res, { deny: true }))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can change emailed reports." });
      const found = await pool.query(
        `SELECT rs.*, (SELECT name FROM contacts ct WHERE ct.id = rs.contact_id) AS contact_name
         FROM report_subscriptions rs WHERE rs.id = $1 AND rs.org_id = $2`,
        [subscriptionMatch[1], actor.org_id],
      );
      if (!found.rows[0]) return send(res, 404, { error: "Scheduled report not found." });
      if (req.method === "DELETE") {
        await pool.query("DELETE FROM report_subscriptions WHERE id = $1 AND org_id = $2", [found.rows[0].id, actor.org_id]);
        await writeAudit(actor.org_id, actor.id, "report.unsubscribe", "report_subscription", String(found.rows[0].id), {
          report: found.rows[0].report_key,
        });
        return send(res, 200, { ok: true });
      }
      const result = await deliverSubscription({ ...found.rows[0], actor_id: actor.id });
      return send(res, result.status === "sent" ? 200 : 502, { status: result.status, error: result.detail || undefined });
    }

    if (req.method === "DELETE" && url.pathname === "/v1/report-schedules") {
      if (!(await requireReporting(actor, res, { deny: true }))) return;
      if (!canOperate(actor)) return send(res, 403, { error: "Only an owner or admin can stop the export." });
      const removed = await pool.query("SELECT id FROM report_schedules WHERE org_id = $1", [actor.org_id]);
      if (!removed.rows[0]) return send(res, 404, { error: "No export is scheduled." });
      await pool.query("DELETE FROM report_runs WHERE org_id = $1", [actor.org_id]);
      await pool.query("DELETE FROM report_schedules WHERE org_id = $1", [actor.org_id]);
      await writeAudit(actor.org_id, actor.id, "report.unschedule", "org", String(actor.org_id), {});
      return send(res, 200, { ok: true });
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

    const deviceUpdatesMatch = url.pathname.match(/^\/v1\/devices\/(\d+)\/updates(?:\/(scan|approve|push|restart))?$/);
    if (deviceUpdatesMatch && (req.method === "GET" ? !deviceUpdatesMatch[2] : req.method === "POST" && deviceUpdatesMatch[2])) {
      const action = deviceUpdatesMatch[2] || "list";
      if (!(await requirePatch(actor, res, { deny: action !== "list" }))) return;
      const found = await pool.query(
        `SELECT id, org_id, hostname, display_name, mesh_node_id, os_name, users, updates, reboot_pending,
                updates_checked_at, update_scan_requested_at, last_seen_at
         FROM devices WHERE id = $1 AND org_id = $2`,
        [deviceUpdatesMatch[1], actor.org_id],
      );
      const device = found.rows[0];
      if (!device) return send(res, 404, { error: "Device not found." });
      const available = Array.isArray(device.updates) ? device.updates : [];

      if (action === "list") {
        const deploys = await pool.query(
          `SELECT DISTINCT ON (package_name) id, package_name, status, detail, restart_required,
                  kb, severity, category, finished_at, created_at
           FROM patch_deploys
           WHERE device_id = $1 AND created_at > now() - interval '30 days'
           ORDER BY package_name, id DESC`,
          [device.id],
        );
        const latest = new Map(deploys.rows.map((row) => [row.package_name, row]));
        const listed = new Set();
        const updates = available.map((item) => {
          listed.add(item.name);
          const deploy = latest.get(item.name);
          return {
            name: item.name,
            kb: item.kb || "",
            category: item.category || "Update",
            severity: item.severity || "",
            sizeBytes: item.sizeBytes || 0,
            restart: item.restart === true,
            pushNow: pushNow(item),
            ...deployFields(deploy),
          };
        });
        const history = deploys.rows
          .filter((row) => !listed.has(row.package_name) && ["succeeded", "failed"].includes(row.status))
          .sort((a, b) => Number(b.id) - Number(a.id))
          .map((row) => ({
            name: row.package_name,
            kb: row.kb || "",
            category: row.category || "Update",
            severity: row.severity || "",
            ...deployFields(row),
          }));
        const scanAt = device.update_scan_requested_at;
        const checkedAt = device.updates_checked_at;
        return send(res, 200, {
          hostname: device.hostname,
          isServer: isServerOs(device.os_name),
          usersLoggedOn: Array.isArray(device.users) ? device.users.length : 0,
          canApprove: canOperate(actor),
          canPush: true,
          online: Boolean(device.last_seen_at) && Date.now() - device.last_seen_at.getTime() < 60000,
          rebootPending: device.reboot_pending === true,
          checkedAt: checkedAt ? checkedAt.toISOString() : null,
          scanning: Boolean(scanAt) && (!checkedAt || scanAt > checkedAt),
          updates,
          history,
        });
      }

      if (action === "scan") {
        await pool.query("UPDATE devices SET update_scan_requested_at = now() WHERE id = $1", [device.id]);
        await writeAudit(actor.org_id, actor.id, "patch.scan", "device", String(device.id), {});
        return send(res, 202, { scanning: true });
      }

      const body = await readJson(req);

      if (action === "restart") {
        if (!device.reboot_pending) return send(res, 409, { error: "This computer is not waiting for a restart." });
        const mode = body.mode === "ask" ? "ask" : "auto";
        if (mode === "auto" && isServerOs(device.os_name) && body.confirmServer !== true) {
          return send(res, 409, { error: "This is a server. Confirm the restart.", needsConfirm: true });
        }
        try {
          const done = await restartAfterUpdates(device, mode, actor.id);
          return send(res, mode === "ask" ? 200 : 201, done);
        } catch (error) {
          return send(res, error.status || 502, { error: error.message || "The restart could not be sent." });
        }
      }
      const names = Array.isArray(body.names)
        ? [...new Set(body.names.filter((name) => typeof name === "string").map((name) => name.trim()))].filter(Boolean).slice(0, 200)
        : [];
      if (names.length === 0) return send(res, 400, { error: "Choose at least one update." });
      const byName = new Map(available.map((item) => [item.name, item]));

      if (action === "approve") {
        if (!canOperate(actor)) {
          await writeAudit(actor.org_id, actor.id, "patch.deny", "device", String(device.id), { reason: "role" });
          return send(res, 403, { error: "A technician cannot approve an update." });
        }
        const approved = await approveUpdates(device, names.map((name) => byName.get(name)).filter(Boolean), actor.id);
        if (approved.length) {
          await writeAudit(actor.org_id, actor.id, "patch.approve", "device", String(device.id), {
            count: approved.length,
            names: approved.slice(0, 20),
          });
        }
        return send(res, 200, { approved: approved.length });
      }

      const restartMode = ["auto", "ask"].includes(body.restartMode) ? body.restartMode : "later";
      if (restartMode === "auto" && isServerOs(device.os_name) && body.confirmServer !== true) {
        return send(res, 409, { error: "This is a server. Confirm the automatic restart.", needsConfirm: true });
      }
      const pushed = await pool.query(
        `UPDATE patch_deploys
         SET status = 'queued', pushed_by = $1, pushed_at = now(), restart_mode = $4, restart_handled_at = NULL
         WHERE device_id = $2 AND status = 'approved' AND package_name = ANY($3::text[])
         RETURNING package_name`,
        [actor.id, device.id, names, restartMode],
      );
      if (pushed.rows.length === 0) return send(res, 409, { error: "Approve the updates before pushing them." });
      await writeAudit(actor.org_id, actor.id, "patch.push", "device", String(device.id), {
        restartMode,
        count: pushed.rows.length,
        names: pushed.rows.slice(0, 20).map((row) => row.package_name),
      });
      return send(res, 200, { pushed: pushed.rows.length });
    }

    if (req.method === "GET" && url.pathname === "/v1/patches") {
      if (!(await requirePatch(actor, res))) return;
      const [fleet, deploys, rules, license] = await Promise.all([
        pool.query(
          `SELECT d.id, d.hostname, d.os_name, d.updates, d.reboot_pending, d.updates_checked_at, d.last_seen_at,
                  c.name AS customer_name
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE d.org_id = $1
           ORDER BY c.name NULLS LAST, d.hostname`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT DISTINCT ON (device_id, package_name) device_id, package_name, status, finished_at
           FROM patch_deploys
           WHERE org_id = $1 AND created_at > now() - interval '30 days'
           ORDER BY device_id, package_name, id DESC`,
          [actor.org_id],
        ),
        pool.query("SELECT category FROM patch_rules WHERE org_id = $1 ORDER BY category", [actor.org_id]),
        licenseQuery(actor.org_id),
      ]);
      const latest = new Map(deploys.rows.map((row) => [`${row.device_id}:${row.package_name}`, row]));
      const lastInstalled = new Map();
      for (const row of deploys.rows) {
        if (row.status !== "succeeded" || !row.finished_at) continue;
        const key = String(row.device_id);
        if (!lastInstalled.has(key) || row.finished_at > lastInstalled.get(key)) lastInstalled.set(key, row.finished_at);
      }
      const devices = fleet.rows.map((row) => {
        const counts = { updates: 0, pushNow: 0, toApprove: 0, approved: 0, installing: 0, failed: 0 };
        for (const item of Array.isArray(row.updates) ? row.updates : []) {
          const status = latest.get(`${row.id}:${item?.name}`)?.status || "available";
          if (status === "succeeded") continue;
          counts.updates += 1;
          if (["available", "waiting", "failed"].includes(status)) counts.toApprove += 1;
          if (status === "approved") counts.approved += 1;
          if (status === "queued" || status === "running") counts.installing += 1;
          if (status === "failed") counts.failed += 1;
          if (pushNow(item) && status !== "queued" && status !== "running") counts.pushNow += 1;
        }
        const installed = lastInstalled.get(String(row.id));
        return {
          id: Number(row.id),
          hostname: row.hostname,
          customer: row.customer_name || "",
          osName: row.os_name || "",
          isServer: isServerOs(row.os_name),
          online: Boolean(row.last_seen_at) && Date.now() - row.last_seen_at.getTime() < 60000,
          rebootPending: row.reboot_pending === true,
          checkedAt: row.updates_checked_at ? row.updates_checked_at.toISOString() : null,
          lastInstalledAt: installed ? installed.toISOString() : null,
          ...counts,
        };
      });
      const total = (key) => devices.reduce((sum, device) => sum + device[key], 0);
      return send(res, 200, {
        canTicket: ticketingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        categories: PATCH_RULE_CATEGORIES,
        rules: rules.rows.map((row) => row.category),
        summary: {
          devices: devices.length,
          behind: devices.filter((device) => device.updates > 0).length,
          pushNow: total("pushNow"),
          pushNowDevices: devices.filter((device) => device.pushNow > 0).length,
          toApprove: total("toApprove"),
          approved: total("approved"),
          installing: total("installing"),
          restart: devices.filter((device) => device.rebootPending).length,
        },
        devices,
      });
    }

    if (req.method === "PUT" && url.pathname === "/v1/patch-rules") {
      if (!(await requirePatch(actor, res, { deny: true }))) return;
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "patch.deny", "org", String(actor.org_id), { reason: "role" });
        return send(res, 403, { error: "Only an admin can change auto-approve rules." });
      }
      const body = await readJson(req);
      if (!Array.isArray(body.categories) || body.categories.some((item) => !PATCH_RULE_CATEGORIES.includes(item))) {
        return send(res, 400, { error: "Choose update types from the list." });
      }
      const categories = [...new Set(body.categories)];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM patch_rules WHERE org_id = $1 AND NOT (category = ANY($2::text[]))",
          [actor.org_id, categories],
        );
        for (const category of categories) {
          await client.query(
            `INSERT INTO patch_rules (org_id, category, created_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (org_id, category) DO NOTHING`,
            [actor.org_id, category, actor.id],
          );
        }
        await client.query("COMMIT");
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
      await writeAudit(actor.org_id, actor.id, "patch.rules", "org", String(actor.org_id), { categories });
      pool.query("SELECT id, org_id, updates FROM devices WHERE org_id = $1", [actor.org_id])
        .then(async (found) => {
          for (const device of found.rows) await autoApproveUpdates(device);
        })
        .catch(() => console.error("update auto-approve failed"));
      return send(res, 200, { rules: categories });
    }

    if (req.method === "POST" && url.pathname === "/v1/patches/approve-urgent") {
      if (!(await requirePatch(actor, res, { deny: true }))) return;
      if (!canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "patch.deny", "org", String(actor.org_id), { reason: "role" });
        return send(res, 403, { error: "A technician cannot approve an update." });
      }
      const found = await pool.query(
        `SELECT id, org_id, updates FROM devices
         WHERE org_id = $1 AND jsonb_typeof(updates) = 'array' AND jsonb_array_length(updates) > 0`,
        [actor.org_id],
      );
      let count = 0;
      const touched = [];
      for (const device of found.rows) {
        const approved = await approveUpdates(device, device.updates.filter(pushNow), actor.id, { skipRecent: true });
        if (approved.length === 0) continue;
        count += approved.length;
        touched.push(Number(device.id));
        await writeAudit(actor.org_id, actor.id, "patch.approve", "device", String(device.id), {
          urgent: true,
          count: approved.length,
          names: approved.slice(0, 20),
        });
      }
      return send(res, 200, { approved: count, devices: touched.length });
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
      if (mode === "auto" && !canOperate(actor)) {
        await writeAudit(actor.org_id, actor.id, "patch.deny", "device", String(deviceId), { reason: "role" });
        return send(res, 403, { error: "Only an owner or admin can approve updates automatically." });
      }
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

    if (req.method === "GET" && url.pathname === "/v1/tickets/export") {
      if (!(await requireTicketing(actor, res))) return;
      const filters = parseListQuery(url.searchParams);
      const picked = new Set(String(url.searchParams.get("ids") || "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0));
      const all = await ticketListRows(actor.org_id);
      const matched = picked.size ? all.filter((ticket) => picked.has(ticket.id)) : filterTickets(all, filters, Number(actor.id));
      const rows = sortTickets(matched, filters.sort, filters.dir).slice(0, EXPORT_LIMIT);
      await writeAudit(actor.org_id, actor.id, "ticket.export", "ticket", null, { count: rows.length });
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      });
      return res.end(ticketsCsv(rows));
    }

    if (req.method === "GET" && url.pathname === "/v1/tickets") {
      if (!(await requireTicketing(actor, res))) return;
      const me = Number(actor.id);
      const filters = parseListQuery(url.searchParams);
      const [all, customers, devices, users, views, prefs] = await Promise.all([
        ticketListRows(actor.org_id),
        pool.query(
          `SELECT c.id, c.name,
                  COALESCE(json_agg(json_build_object('id', ct.id, 'name', ct.name, 'primary', ct.is_primary)
                    ORDER BY ct.is_primary DESC, ct.name) FILTER (WHERE ct.id IS NOT NULL), '[]') AS contacts
           FROM customers c
           LEFT JOIN contacts ct ON ct.customer_id = c.id
           WHERE c.org_id = $1
           GROUP BY c.id
           ORDER BY c.name`,
          [actor.org_id],
        ),
        pool.query(
          `SELECT d.id, d.hostname, d.contact_id, s.customer_id, c.name AS customer_name
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE d.org_id = $1
           ORDER BY d.hostname`,
          [actor.org_id],
        ),
        pool.query("SELECT id, name, email FROM users WHERE org_id = $1 ORDER BY name", [actor.org_id]),
        pool.query(
          `SELECT v.id, v.name, v.query, v.columns, v.shared, v.user_id, u.name AS owner_name
           FROM ticket_saved_views v
           JOIN users u ON u.id = v.user_id
           WHERE v.org_id = $1 AND (v.shared OR v.user_id = $2)
           ORDER BY v.shared, lower(v.name)`,
          [actor.org_id, actor.id],
        ),
        pool.query("SELECT columns FROM ticket_list_prefs WHERE user_id = $1 AND org_id = $2", [actor.id, actor.org_id]),
      ]);
      const [book, setup] = await Promise.all([slaBook(actor.org_id), deskSetup(actor.org_id)]);
      const sla = book.base;
      const matched = sortTickets(filterTickets(all, filters, me), filters.sort, filters.dir);
      const page = pageOf(matched, filters.page);
      const categories = new Map(setup.categories.map((item) => [item.name.toLowerCase(), item.name]));
      const tags = new Map(setup.tags.map((item) => [item.name.toLowerCase(), item.name]));
      for (const ticket of all) {
        if (ticket.category) categories.set(ticket.category.toLowerCase(), ticket.category);
        for (const tag of ticket.tags) tags.set(tag.toLowerCase(), tag);
      }
      const license = (await licenseQuery(actor.org_id)).rows[0];
      return send(res, 200, {
        me,
        tickets: page.items,
        total: page.total,
        page: page.page,
        pages: page.pages,
        pageSize: PAGE_SIZE,
        counts: viewCounts(all, me),
        categories: [...categories.values()].sort((a, b) => a.localeCompare(b)),
        tags: [...tags.values()].sort((a, b) => a.localeCompare(b)),
        columns: cleanColumns(prefs.rows[0]?.columns) || DEFAULT_COLUMNS,
        defaultColumns: DEFAULT_COLUMNS,
        allColumns: LIST_COLUMNS,
        views: views.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          query: row.query,
          columns: cleanColumns(row.columns),
          shared: row.shared,
          ownerName: row.owner_name,
          mine: Number(row.user_id) === me,
          canDelete: Number(row.user_id) === me || (row.shared && canOperate(actor)),
        })),
        canOperate: canOperate(actor),
        customers: customers.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          contacts: row.contacts.map((contact) => ({ id: Number(contact.id), name: contact.name, primary: contact.primary })),
        })),
        devices: devices.rows.map(deviceChoice),
        users: users.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })),
        sla,
        statuses: setup.statuses,
        priorityLabels: setup.priorityLabels,
        canned: setup.canned,
        canPatch: patchAllowed(license),
        canReport: reportingAllowed(license),
        canMonitor: monitoringAllowed(license),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/tickets/similar") {
      if (!(await requireTicketing(actor, res))) return;
      const customerId = Number(url.searchParams.get("customer"));
      const subject = String(url.searchParams.get("subject") || "").slice(0, 200);
      if (!Number.isSafeInteger(customerId) || !subject.trim()) return send(res, 200, { tickets: [] });
      const open = await pool.query(
        `SELECT id, subject, status, created_at FROM tickets
         WHERE org_id = $1 AND customer_id = $2 AND status <> 'resolved' AND merged_into_id IS NULL
         ORDER BY id DESC LIMIT 200`,
        [actor.org_id, customerId],
      );
      return send(res, 200, {
        tickets: similarTickets(open.rows, subject).map((row) => ({
          id: Number(row.id),
          subject: row.subject,
          status: row.status,
          createdAt: row.created_at,
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/tickets/due-preview") {
      if (!(await requireTicketing(actor, res))) return;
      const customerId = Number(url.searchParams.get("customer"));
      const priority = url.searchParams.get("priority") || "normal";
      if (!TICKET_PRIORITIES.has(priority)) return send(res, 400, { error: "Choose a priority." });
      const customer = Number.isSafeInteger(customerId)
        ? await pool.query("SELECT sla_plan_id FROM customers WHERE id = $1 AND org_id = $2", [customerId, actor.org_id])
        : { rows: [] };
      const book = await slaBook(actor.org_id);
      const targets = slaFor(book, customer.rows[0]?.sla_plan_id ?? null);
      const clock = ticketClock({ created_at: new Date(), status: "open", priority }, targets);
      return send(res, 200, clock
        ? {
          dueAt: clock.resolveDueAt.toISOString(),
          responseDueAt: clock.responseDueAt.toISOString(),
          resolveMinutes: clock.resolveMinutes,
          responseMinutes: clock.responseMinutes,
          businessHours: clock.businessHours,
          plan: targets?.name || null,
        }
        : { dueAt: null });
    }

    if (req.method === "POST" && url.pathname === "/v1/tickets") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      let status = body.status || "open";
      const priority = body.priority || "normal";
      const customerId = Number(body.customerId);
      const deviceId = body.deviceId == null || body.deviceId === "" ? null : Number(body.deviceId);
      const assigneeUserId = body.assigneeUserId == null || body.assigneeUserId === "" ? null : Number(body.assigneeUserId);
      const contactId = body.contactId == null || body.contactId === "" ? null : Number(body.contactId);
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      const files = attachmentIds(body.attachmentIds);
      if (files == null) return send(res, 400, { error: "Attach up to 10 files at a time." });
      const category = cleanCategory(body.category);
      const tags = cleanTags(body.tags);
      const due = parseDueAt(body.dueAt);
      const channel = parseChannel(body.channel);
      const cc = parseCc(body.cc);
      const statusRef = parseStatusId(body.statusId);
      const inputError = [due, channel, cc, statusRef].find((item) => item.error);
      if (inputError) return send(res, 400, { error: inputError.error });
      if (!subject || subject.length > 200) return send(res, 400, { error: "Enter a subject." });
      if (!TICKET_STATUSES.has(status) || !TICKET_PRIORITIES.has(priority)) {
        return send(res, 400, { error: "Choose a status and priority." });
      }
      if (!Number.isInteger(customerId) || (deviceId != null && !Number.isInteger(deviceId))) {
        return send(res, 400, { error: "Choose an account and a device." });
      }
      if (contactId != null && !Number.isInteger(contactId)) return send(res, 400, { error: "Choose a contact." });
      if (comment.length > 4000) return send(res, 400, { error: "Comment is too long." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const linked = deviceId == null
          ? await accountOnly(client, actor.org_id, customerId)
          : await linkDeviceToCustomer(client, actor.org_id, customerId, deviceId);
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
        if (contactId != null) {
          const contact = await client.query(
            "SELECT id FROM contacts WHERE id = $1 AND customer_id = $2 AND org_id = $3",
            [contactId, customerId, actor.org_id],
          );
          if (!contact.rows[0]) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "Choose a contact on that account." });
          }
        }
        if (statusRef.value != null) {
          const custom = await client.query("SELECT base FROM desk_statuses WHERE id = $1 AND org_id = $2", [statusRef.value, actor.org_id]);
          if (!custom.rows[0]) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "Choose a status." });
          }
          status = custom.rows[0].base;
        }
        if (cc.value.length) {
          const found = await client.query(
            "SELECT count(*)::int AS n FROM contacts WHERE id = ANY($1::bigint[]) AND customer_id = $2 AND org_id = $3",
            [cc.value, customerId, actor.org_id],
          );
          if (found.rows[0].n !== cc.value.length) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "Only contacts on this account can be copied in." });
          }
        }
        const ticket = await client.query(
          `INSERT INTO tickets (org_id, customer_id, device_id, assignee_user_id, subject, status, priority, created_by, contact_id,
                                category, tags, due_at, channel, status_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 'console'), $14)
           RETURNING id`,
          [actor.org_id, customerId, deviceId, assigneeUserId, subject, status, priority, actor.id, contactId,
            category, tags, due.value, channel.value, statusRef.value],
        );
        const ticketId = Number(ticket.rows[0].id);
        if (cc.value.length) {
          await client.query(
            `INSERT INTO ticket_cc (org_id, ticket_id, contact_id)
             SELECT $1, $2, unnest($3::bigint[]) ON CONFLICT DO NOTHING`,
            [actor.org_id, ticketId, cc.value],
          );
        }
        await ticketEvent(actor.org_id, ticketId, "created", { actorId: actor.id, detail: { status, priority }, db: client });
        if (comment || files.length) {
          const added = await client.query(
            `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [actor.org_id, ticketId, actor.id, comment],
          );
          const commentId = Number(added.rows[0].id);
          if (!(await linkAttachments(client, actor, ticketId, commentId, files))) {
            await client.query("ROLLBACK");
            return send(res, 400, { error: "An attachment was not found. Upload it again." });
          }
          await ticketEvent(actor.org_id, ticketId, "reply", { actorId: actor.id, detail: { commentId }, db: client });
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
          contactId,
          deviceId,
          status,
          priority,
          assigneeUserId,
          ...(category ? { category } : {}),
          ...(tags.length ? { tags } : {}),
          ...(due.value ? { dueAt: due.value.toISOString() } : {}),
          channel: channel.value || "console",
          ...(cc.value.length ? { cc: cc.value } : {}),
        });
        await runAutomations(deskHelpers(), actor.org_id, ticketId, "created");
        await notifyNewTicket(actor.org_id, ticketId, subject, { actorId: actor.id });
        if (assigneeUserId != null && assigneeUserId !== Number(actor.id)) {
          await deskNotify(deskHelpers(), { orgId: actor.org_id, event: "assigned", ticketId, subject, userIds: [assigneeUserId], actorId: actor.id });
        }
        return send(res, 201, { id: ticketId });
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

    if (req.method === "POST" && url.pathname === "/v1/tickets/bulk") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))].filter(Number.isInteger) : [];
      if (ids.length === 0 || ids.length > 200) return send(res, 400, { error: "Choose up to 200 tickets." });
      const status = body.status == null || body.status === "" ? null : body.status;
      const priority = body.priority == null || body.priority === "" ? null : body.priority;
      const assign = Object.hasOwn(body, "assigneeUserId");
      const assigneeUserId = !assign || body.assigneeUserId == null || body.assigneeUserId === "" ? null : Number(body.assigneeUserId);
      const setCategory = Object.hasOwn(body, "category");
      const category = setCategory ? cleanCategory(body.category) : null;
      const addTags = cleanTags(body.addTags);
      const removeTags = cleanTags(body.removeTags).map((tag) => tag.toLowerCase());
      if (status !== null && !TICKET_STATUSES.has(status)) return send(res, 400, { error: "Choose a status." });
      if (priority !== null && !TICKET_PRIORITIES.has(priority)) return send(res, 400, { error: "Choose a priority." });
      if (status === null && priority === null && !assign && !setCategory && !addTags.length && !removeTags.length) {
        return send(res, 400, { error: "Choose a change." });
      }
      if (assigneeUserId != null) {
        const assignee = await pool.query("SELECT id FROM users WHERE id = $1 AND org_id = $2", [assigneeUserId, actor.org_id]);
        if (!assignee.rows[0]) return send(res, 400, { error: "Choose an assignee in this organisation." });
      }
      const updated = await inTransaction(async (client) => {
        const old = await client.query(
          `SELECT id, status, priority, assignee_user_id, category, tags FROM tickets
           WHERE org_id = $1 AND id = ANY($2::bigint[])
           ORDER BY id
           FOR UPDATE`,
          [actor.org_id, ids],
        );
        const rows = [];
        for (const row of old.rows) {
          let tags = row.tags || [];
          if (removeTags.length) tags = tags.filter((tag) => !removeTags.includes(tag.toLowerCase()));
          if (addTags.length) tags = cleanTags([...tags, ...addTags]);
          const saved = await client.query(
            `UPDATE tickets
             SET status = COALESCE($1, status),
                 priority = COALESCE($2, priority),
                 assignee_user_id = CASE WHEN $3::boolean THEN $4::bigint ELSE assignee_user_id END,
                 category = CASE WHEN $5::boolean THEN $6 ELSE category END,
                 tags = $7::text[],
                 updated_at = now()
             WHERE id = $8
             RETURNING id, status, priority, assignee_user_id, category, tags`,
            [status, priority, assign, assigneeUserId, setCategory, category, tags, row.id],
          );
          rows.push({ before: row, after: saved.rows[0] });
        }
        return rows;
      });
      for (const { before, after } of updated) {
        await writeAudit(actor.org_id, actor.id, "ticket.update", "ticket", String(after.id), {
          status: after.status,
          priority: after.priority,
          assigneeUserId: after.assignee_user_id == null ? null : Number(after.assignee_user_id),
          category: after.category,
          tags: after.tags,
          bulk: true,
        });
        await ticketChangeEvents(
          actor.org_id,
          after.id,
          {
            status: before.status,
            priority: before.priority,
            assigneeUserId: before.assignee_user_id,
            category: before.category,
            tags: before.tags || [],
          },
          {
            ...(status !== null ? { status: after.status } : {}),
            ...(priority !== null ? { priority: after.priority } : {}),
            ...(assign ? { assigneeUserId: after.assignee_user_id } : {}),
            ...(setCategory ? { category: after.category } : {}),
            ...(addTags.length || removeTags.length ? { tags: after.tags } : {}),
          },
          { actorId: actor.id },
        );
        if (before.status !== "resolved" && after.status === "resolved") await deskHelpers().ticketResolved(actor.org_id, Number(after.id));
      }
      return send(res, 200, { updated: updated.length });
    }

    if (req.method === "POST" && url.pathname === "/v1/tickets/merge") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const targetId = Number(body.targetId);
      const sources = Array.isArray(body.ids)
        ? [...new Set(body.ids.map(Number))].filter((id) => Number.isInteger(id) && id !== targetId)
        : [];
      if (!Number.isInteger(targetId) || sources.length === 0 || sources.length > 20) {
        return send(res, 400, { error: "Choose the ticket to keep and up to 20 others to merge into it." });
      }
      const outcome = await inTransaction(async (client) => {
        const found = await client.query(
          `SELECT id, customer_id, merged_into_id FROM tickets
           WHERE org_id = $1 AND id = ANY($2::bigint[])
           ORDER BY id
           FOR UPDATE`,
          [actor.org_id, [targetId, ...sources]],
        );
        if (found.rows.length !== sources.length + 1) return { rollback: true, status: 404, error: "Ticket not found." };
        if (found.rows.some((row) => row.merged_into_id != null)) {
          return { rollback: true, status: 409, error: "One of those tickets was already merged." };
        }
        const target = found.rows.find((row) => Number(row.id) === targetId);
        if (found.rows.some((row) => String(row.customer_id) !== String(target.customer_id))) {
          return { rollback: true, status: 409, error: "Only tickets for the same customer can be merged." };
        }
        for (const sourceId of sources) {
          await client.query("UPDATE ticket_comments SET ticket_id = $2 WHERE ticket_id = $1", [sourceId, targetId]);
          await client.query("UPDATE ticket_attachments SET ticket_id = $2 WHERE ticket_id = $1 AND org_id = $3", [sourceId, targetId, actor.org_id]);
          await client.query("UPDATE ticket_time_entries SET ticket_id = $2 WHERE ticket_id = $1 AND org_id = $3", [sourceId, targetId, actor.org_id]);
          await client.query("DELETE FROM ticket_timers WHERE ticket_id = $1", [sourceId]);
          const closed = await client.query(
            `UPDATE tickets t SET status = 'resolved', merged_into_id = $2, updated_at = now()
             FROM (SELECT status FROM tickets WHERE id = $1) old
             WHERE t.id = $1
             RETURNING old.status AS old_status`,
            [sourceId, targetId],
          );
          await ticketEvent(actor.org_id, sourceId, "merged", { actorId: actor.id, detail: { into: targetId }, db: client });
          if (closed.rows[0].old_status !== "resolved") {
            await ticketEvent(actor.org_id, sourceId, "status", {
              actorId: actor.id,
              detail: { from: closed.rows[0].old_status, to: "resolved" },
              db: client,
            });
          }
        }
        await client.query("UPDATE tickets SET updated_at = now() WHERE id = $1", [targetId]);
        await ticketEvent(actor.org_id, targetId, "merged_from", { actorId: actor.id, detail: { tickets: sources }, db: client });
        return { ok: true };
      });
      if (outcome.error) return send(res, outcome.status, { error: outcome.error });
      await writeAudit(actor.org_id, actor.id, "ticket.merge", "ticket", String(targetId), { merged: sources });
      return send(res, 200, { targetId, merged: sources.length });
    }

    if (req.method === "POST" && url.pathname === "/v1/ticket-views") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!name) return send(res, 400, { error: "Name the view." });
      const shared = body.shared === true;
      if (shared && !canOperate(actor)) return send(res, 403, { error: "Only operators can share views with the team." });
      const count = await pool.query("SELECT count(*)::int AS n FROM ticket_saved_views WHERE user_id = $1", [actor.id]);
      if (count.rows[0].n >= 50) return send(res, 400, { error: "You can keep up to 50 saved views." });
      const created = await pool.query(
        `INSERT INTO ticket_saved_views (org_id, user_id, name, query, columns, shared)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [actor.org_id, actor.id, name, cleanViewQuery(body.query), cleanColumns(body.columns), shared],
      );
      await writeAudit(actor.org_id, actor.id, "ticket_view.create", "ticket_view", String(created.rows[0].id), { name, shared });
      return send(res, 201, { id: Number(created.rows[0].id) });
    }

    const ticketViewMatch = url.pathname.match(/^\/v1\/ticket-views\/(\d+)$/);
    if (req.method === "DELETE" && ticketViewMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const removed = await pool.query(
        `DELETE FROM ticket_saved_views
         WHERE id = $1 AND org_id = $2 AND (user_id = $3 OR (shared AND $4::boolean))
         RETURNING id, name`,
        [ticketViewMatch[1], actor.org_id, actor.id, canOperate(actor)],
      );
      if (!removed.rows[0]) return send(res, 404, { error: "View not found." });
      await writeAudit(actor.org_id, actor.id, "ticket_view.delete", "ticket_view", ticketViewMatch[1], { name: removed.rows[0].name });
      return send(res, 200, { ok: true });
    }

    if (req.method === "PUT" && url.pathname === "/v1/ticket-list/columns") {
      if (!(await requireTicketing(actor, res))) return;
      const body = await readJson(req);
      const columns = body.reset === true ? null : cleanColumns(body.columns);
      if (body.reset === true) {
        await pool.query("DELETE FROM ticket_list_prefs WHERE user_id = $1", [actor.id]);
        return send(res, 200, { columns: DEFAULT_COLUMNS });
      }
      if (!columns) return send(res, 400, { error: "Keep the Subject column." });
      await pool.query(
        `INSERT INTO ticket_list_prefs (user_id, org_id, columns) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET columns = EXCLUDED.columns, updated_at = now()`,
        [actor.id, actor.org_id, columns],
      );
      return send(res, 200, { columns });
    }

    if (req.method === "POST" && url.pathname === "/v1/attachments") {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const declared = headerNumber(req.headers["content-length"]);
      if (declared != null && declared > ATTACHMENT_LIMIT) return send(res, 413, { error: "Attachments can be up to 10 MB." });
      let rawName = "";
      try {
        rawName = decodeURIComponent(String(req.headers["x-df-name"] || ""));
      } catch {
        rawName = "";
      }
      const ticketHeader = String(req.headers["x-df-ticket"] || "");
      const ticketId = ticketHeader ? Number(ticketHeader) : null;
      if (ticketId != null && (!Number.isInteger(ticketId) || !(await ticketInOrg(ticketId, actor.org_id)))) {
        return send(res, 404, { error: "Ticket not found." });
      }
      let data;
      try {
        data = await readBytes(req, ATTACHMENT_LIMIT);
      } catch (error) {
        return send(res, error.status || 400, { error: error.status === 413 ? "Attachments can be up to 10 MB." : "The file was not uploaded." });
      }
      if (data.length === 0) return send(res, 400, { error: "Choose a file." });
      const image = imageType(data.subarray(0, 16));
      const name = attachmentName(rawName);
      const contentType = image || storedContentType(req.headers["x-df-type"]);
      const storageKey = `${actor.org_id}/${randomBytes(16).toString("hex")}`;
      const stored = join(ATTACHMENT_DIR, storageKey);
      await mkdir(dirname(stored), { recursive: true, mode: 0o700 });
      await writeFile(stored, data, { mode: 0o600, flag: "wx" });
      const inserted = await pool.query(
        `INSERT INTO ticket_attachments (org_id, ticket_id, uploaded_by, file_name, content_type, is_image, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, file_name, content_type, is_image, size_bytes`,
        [actor.org_id, ticketId, actor.id, name, contentType, Boolean(image), data.length, storageKey],
      );
      return send(res, 201, attachmentView(inserted.rows[0]));
    }

    const attachmentMatch = url.pathname.match(/^\/v1\/attachments\/(\d+)$/);
    if (req.method === "GET" && attachmentMatch) {
      if (!(await requireTicketing(actor, res))) return;
      const found = await pool.query(
        `SELECT id, file_name, content_type, is_image, size_bytes, storage_key
         FROM ticket_attachments
         WHERE id = $1 AND org_id = $2 AND (linked_at IS NOT NULL OR uploaded_by = $3)`,
        [attachmentMatch[1], actor.org_id, actor.id],
      );
      const row = found.rows[0];
      if (!row) return send(res, 404, { error: "Attachment not found." });
      const stored = join(ATTACHMENT_DIR, row.storage_key);
      try {
        await stat(stored);
      } catch {
        return send(res, 404, { error: "Attachment not found." });
      }
      res.writeHead(200, {
        "content-type": row.is_image ? row.content_type : "application/octet-stream",
        "content-length": String(row.size_bytes),
        "content-disposition": contentDisposition(row.file_name, row.is_image),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      });
      createReadStream(stored).pipe(res);
      return;
    }

    const ticketTimeMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)\/time$/);
    if (req.method === "POST" && ticketTimeMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const ticket = await ticketInOrg(ticketTimeMatch[1], actor.org_id);
      if (!ticket) return send(res, 404, { error: "Ticket not found." });
      const input = timeInput(await readJson(req));
      if (input.error) return send(res, 400, { error: input.error });
      const entry = await pool.query(
        `INSERT INTO ticket_time_entries (org_id, ticket_id, user_id, minutes, billable, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [actor.org_id, ticket.id, actor.id, input.minutes, input.billable, input.note],
      );
      const entryId = Number(entry.rows[0].id);
      await ticketEvent(actor.org_id, ticket.id, "time", {
        actorId: actor.id,
        detail: { entryId, minutes: input.minutes, billable: input.billable, note: input.note },
      });
      await writeAudit(actor.org_id, actor.id, "ticket.time", "ticket", String(ticket.id), { entryId, minutes: input.minutes });
      return send(res, 201, { id: entryId });
    }

    const ticketTimeEntryMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)\/time\/(\d+)$/);
    if (req.method === "DELETE" && ticketTimeEntryMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const found = await pool.query(
        "SELECT id, ticket_id, user_id, minutes FROM ticket_time_entries WHERE id = $1 AND ticket_id = $2 AND org_id = $3",
        [ticketTimeEntryMatch[2], ticketTimeEntryMatch[1], actor.org_id],
      );
      const entry = found.rows[0];
      if (!entry) return send(res, 404, { error: "Time entry not found." });
      if (Number(entry.user_id) !== Number(actor.id) && !canOperate(actor)) {
        return send(res, 403, { error: "Only the person who logged it or an admin can remove this time." });
      }
      await pool.query("DELETE FROM ticket_time_entries WHERE id = $1", [entry.id]);
      await ticketEvent(actor.org_id, entry.ticket_id, "time_removed", {
        actorId: actor.id,
        detail: { entryId: Number(entry.id), minutes: entry.minutes },
      });
      await writeAudit(actor.org_id, actor.id, "ticket.time_remove", "ticket", String(entry.ticket_id), { entryId: Number(entry.id) });
      return send(res, 200, { removed: true });
    }

    const ticketTimerMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)\/timer$/);
    if (req.method === "POST" && ticketTimerMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const ticket = await ticketInOrg(ticketTimerMatch[1], actor.org_id);
      if (!ticket) return send(res, 404, { error: "Ticket not found." });
      const body = await readJson(req);
      if (body.action === "start") {
        const started = await pool.query(
          `INSERT INTO ticket_timers (org_id, ticket_id, user_id) VALUES ($1, $2, $3)
           ON CONFLICT (ticket_id, user_id) DO UPDATE SET started_at = ticket_timers.started_at
           RETURNING started_at`,
          [actor.org_id, ticket.id, actor.id],
        );
        return send(res, 200, { startedAt: started.rows[0].started_at });
      }
      if (body.action !== "stop") return send(res, 400, { error: "Choose start or stop." });
      const stopped = await pool.query(
        "DELETE FROM ticket_timers WHERE ticket_id = $1 AND user_id = $2 RETURNING started_at",
        [ticket.id, actor.id],
      );
      if (!stopped.rows[0]) return send(res, 409, { error: "No timer is running on this ticket." });
      const minutes = timerMinutes(stopped.rows[0].started_at);
      const billable = body.billable !== false;
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const entry = await pool.query(
        `INSERT INTO ticket_time_entries (org_id, ticket_id, user_id, minutes, billable, note, source, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'timer', $7)
         RETURNING id`,
        [actor.org_id, ticket.id, actor.id, minutes, billable, note, stopped.rows[0].started_at],
      );
      const entryId = Number(entry.rows[0].id);
      await ticketEvent(actor.org_id, ticket.id, "time", {
        actorId: actor.id,
        detail: { entryId, minutes, billable, note, timer: true },
      });
      await writeAudit(actor.org_id, actor.id, "ticket.time", "ticket", String(ticket.id), { entryId, minutes, timer: true });
      return send(res, 200, { id: entryId, minutes });
    }

    const ticketCommentMatch = url.pathname.match(/^\/v1\/tickets\/(\d+)\/comments$/);
    if (req.method === "POST" && ticketCommentMatch) {
      if (!(await requireTicketing(actor, res, { deny: true }))) return;
      const body = await readJson(req);
      const text = typeof body.body === "string" ? body.body.trim() : "";
      const kind = body.kind === "note" ? "note" : "reply";
      const files = attachmentIds(body.attachmentIds);
      if (files == null) return send(res, 400, { error: "Attach up to 10 files at a time." });
      if (text.length > 4000 || (!text && files.length === 0)) {
        return send(res, 400, { error: kind === "note" ? "Enter a note." : "Enter a reply." });
      }
      const outcome = await inTransaction(async (client) => {
        const ticket = await client.query(
          "SELECT id, subject FROM tickets WHERE id = $1 AND org_id = $2 FOR UPDATE",
          [ticketCommentMatch[1], actor.org_id],
        );
        if (!ticket.rows[0]) return { status: 404, error: "Ticket not found." };
        const ticketId = Number(ticket.rows[0].id);
        const comment = await client.query(
          `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, body, kind)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [actor.org_id, ticketId, actor.id, text, kind],
        );
        const commentId = Number(comment.rows[0].id);
        if (!(await linkAttachments(client, actor, ticketId, commentId, files))) {
          return { status: 400, error: "An attachment was not found. Upload it again.", rollback: true };
        }
        await ticketEvent(actor.org_id, ticketId, kind, { actorId: actor.id, detail: { commentId }, db: client });
        await client.query("UPDATE tickets SET updated_at = now() WHERE id = $1", [ticketId]);
        return { ticketId, commentId, subject: ticket.rows[0].subject };
      });
      if (outcome.error) return send(res, outcome.status, { error: outcome.error });
      await writeAudit(actor.org_id, actor.id, kind === "note" ? "ticket.note" : "ticket.comment", "ticket", String(outcome.ticketId), {
        commentId: String(outcome.commentId),
        attachments: files.length,
      });
      await notifyWatchers(actor.org_id, outcome.ticketId, `${kind === "note" ? "New note" : "New reply"}: ${outcome.subject}`, actor.id);
      if (kind === "reply") {
        emailAgentReply(deskHelpers(), actor.org_id, outcome.ticketId, outcome.commentId, actor);
      }
      return send(res, 201, { id: outcome.commentId });
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
        const changeContact = Object.hasOwn(body, "contactId");
        const changeDevice = Object.hasOwn(body, "deviceId");
        const contactId = !changeContact || body.contactId == null || body.contactId === "" ? null : Number(body.contactId);
        const deviceId = !changeDevice || body.deviceId == null || body.deviceId === "" ? null : Number(body.deviceId);
        if ((contactId != null && !Number.isInteger(contactId)) || (deviceId != null && !Number.isInteger(deviceId))) {
          return send(res, 400, { error: "Choose a contact and device." });
        }
        const changeCategory = Object.hasOwn(body, "category");
        const changeTags = Object.hasOwn(body, "tags");
        const category = changeCategory ? cleanCategory(body.category) : null;
        const tags = changeTags ? cleanTags(body.tags) : null;
        const changeDue = Object.hasOwn(body, "dueAt");
        const changeChannel = Object.hasOwn(body, "channel") && body.channel != null && body.channel !== "";
        const changeCc = Object.hasOwn(body, "cc");
        const changeStatusId = Object.hasOwn(body, "statusId");
        const due = changeDue ? parseDueAt(body.dueAt) : { value: null };
        const channel = changeChannel ? parseChannel(body.channel) : { value: null };
        const cc = changeCc ? parseCc(body.cc) : { value: [] };
        const statusRef = changeStatusId ? parseStatusId(body.statusId) : { value: null };
        const inputError = [due, channel, cc, statusRef].find((item) => item.error);
        if (inputError) return send(res, 400, { error: inputError.error });
        let nextStatus = status;
        const outcome = await inTransaction(async (client) => {
          const current = await client.query(
            `SELECT id, subject, customer_id, status, priority, assignee_user_id, contact_id, device_id, category, tags,
                    due_at, channel, status_id,
                    ARRAY(SELECT contact_id FROM ticket_cc WHERE ticket_id = tickets.id ORDER BY contact_id) AS cc
             FROM tickets WHERE id = $1 AND org_id = $2 FOR UPDATE`,
            [ticketMatch[1], actor.org_id],
          );
          if (!current.rows[0]) return { status: 404, error: "Ticket not found." };
          const customerId = Number(current.rows[0].customer_id);
          if (contactId != null) {
            const contact = await client.query("SELECT id FROM contacts WHERE id = $1 AND customer_id = $2", [contactId, customerId]);
            if (!contact.rows[0]) return { status: 400, error: "Choose a contact on this ticket's account." };
          }
          if (statusRef.value != null) {
            const custom = await client.query("SELECT base FROM desk_statuses WHERE id = $1 AND org_id = $2", [statusRef.value, actor.org_id]);
            if (!custom.rows[0]) return { status: 400, error: "Choose a status." };
            nextStatus = custom.rows[0].base;
          }
          let ccNames = null;
          if (changeCc) {
            const found = cc.value.length
              ? await client.query(
                "SELECT id, name FROM contacts WHERE id = ANY($1::bigint[]) AND customer_id = $2 AND org_id = $3 ORDER BY lower(name)",
                [cc.value, customerId, actor.org_id],
              )
              : { rows: [] };
            if (found.rows.length !== cc.value.length) return { status: 400, error: "Only contacts on this account can be copied in." };
            ccNames = found.rows.map((row) => row.name);
          }
          let linked = null;
          if (deviceId != null) {
            linked = await linkDeviceToCustomer(client, actor.org_id, customerId, deviceId);
            if (linked.error) return linked;
          }
          await client.query(
            `UPDATE tickets
             SET status = $1, priority = $2, assignee_user_id = $3, updated_at = now(),
                 contact_id = CASE WHEN $4::boolean THEN $5::bigint ELSE contact_id END,
                 device_id = CASE WHEN $6::boolean THEN $7::bigint ELSE device_id END,
                 category = CASE WHEN $9::boolean THEN $10 ELSE category END,
                 tags = CASE WHEN $11::boolean THEN $12::text[] ELSE tags END,
                 due_at = CASE WHEN $13::boolean THEN $14::timestamptz ELSE due_at END,
                 sla_warned = CASE WHEN $13::boolean THEN array_remove(sla_warned, 'resolve') ELSE sla_warned END,
                 channel = CASE WHEN $15::boolean THEN $16 ELSE channel END,
                 status_id = CASE WHEN $17::boolean THEN $18::bigint WHEN status = $1 THEN status_id ELSE NULL END
             WHERE id = $8`,
            [
              nextStatus, priority, assigneeUserId, changeContact, contactId, changeDevice, deviceId, current.rows[0].id,
              changeCategory, category, changeTags, tags || [],
              changeDue, due.value, changeChannel, channel.value, changeStatusId, statusRef.value,
            ],
          );
          const before = current.rows[0];
          if (changeCc) {
            await client.query("DELETE FROM ticket_cc WHERE ticket_id = $1", [before.id]);
            if (cc.value.length) {
              await client.query(
                "INSERT INTO ticket_cc (org_id, ticket_id, contact_id) SELECT $1, $2, unnest($3::bigint[])",
                [actor.org_id, before.id, cc.value],
              );
            }
            const was = (before.cc || []).map(Number).sort((a, b) => a - b).join(",");
            if (was !== [...cc.value].sort((a, b) => a - b).join(",")) {
              await ticketEvent(actor.org_id, before.id, "cc", { actorId: actor.id, detail: { to: ccNames }, db: client });
            }
          }
          const dueBefore = before.due_at ? new Date(before.due_at).toISOString() : null;
          const dueAfter = due.value ? due.value.toISOString() : null;
          if (changeDue && dueBefore !== dueAfter) {
            await ticketEvent(actor.org_id, before.id, "due", { actorId: actor.id, detail: { from: dueBefore, to: dueAfter }, db: client });
          }
          if (changeChannel && before.channel !== channel.value) {
            await ticketEvent(actor.org_id, before.id, "channel", { actorId: actor.id, detail: { from: before.channel, to: channel.value }, db: client });
          }
          await ticketChangeEvents(
            actor.org_id,
            before.id,
            {
              status: before.status,
              priority: before.priority,
              assigneeUserId: before.assignee_user_id,
              contactId: before.contact_id,
              deviceId: before.device_id,
              category: before.category,
              tags: before.tags || [],
            },
            {
              status: nextStatus,
              priority,
              assigneeUserId,
              ...(changeContact ? { contactId } : {}),
              ...(changeDevice ? { deviceId } : {}),
              ...(changeCategory ? { category } : {}),
              ...(changeTags ? { tags } : {}),
            },
            { actorId: actor.id, db: client },
          );
          return {
            id: current.rows[0].id,
            customerId,
            linked,
            subject: before.subject,
            assigneeBefore: before.assignee_user_id == null ? null : Number(before.assignee_user_id),
            statusBefore: before.status,
          };
        });
        if (outcome.error) return send(res, outcome.status, { error: outcome.error });
        if (outcome.linked?.linked) {
          await writeAudit(actor.org_id, actor.id, "device.link", "device", String(deviceId), {
            customerId: outcome.customerId,
            siteId: outcome.linked.siteId,
          });
        }
        await writeAudit(actor.org_id, actor.id, "ticket.update", "ticket", String(outcome.id), {
          status: nextStatus,
          priority,
          assigneeUserId,
          ...(changeContact ? { contactId } : {}),
          ...(changeDevice ? { deviceId } : {}),
          ...(changeCategory ? { category } : {}),
          ...(changeTags ? { tags } : {}),
          ...(changeDue ? { dueAt: due.value ? due.value.toISOString() : null } : {}),
          ...(changeChannel ? { channel: channel.value } : {}),
          ...(changeCc ? { cc: cc.value } : {}),
          ...(changeStatusId ? { statusId: statusRef.value } : {}),
        });
        if (assigneeUserId != null && assigneeUserId !== outcome.assigneeBefore && assigneeUserId !== Number(actor.id)) {
          await deskNotify(deskHelpers(), {
            orgId: actor.org_id,
            event: "assigned",
            ticketId: Number(outcome.id),
            subject: outcome.subject,
            userIds: [assigneeUserId],
            actorId: actor.id,
          });
        }
        if (outcome.statusBefore !== nextStatus) {
          await notifyWatchers(actor.org_id, Number(outcome.id), `Status ${nextStatus}: ${outcome.subject}`, actor.id);
          if (nextStatus === "resolved") await deskHelpers().ticketResolved(actor.org_id, Number(outcome.id));
        }
        await runAutomations(deskHelpers(), actor.org_id, Number(outcome.id), "updated");
      }
      const ticket = await pool.query(
        `SELECT t.id, t.subject, t.status, t.priority, t.customer_id, c.name AS customer_name, c.sla_plan_id,
                t.category, t.tags, t.merged_into_id, t.migration_lock,
                (SELECT o.name FROM migration_requests m JOIN orgs o ON o.id = m.target_tenant_id WHERE m.id = t.migration_lock) AS moved_to,
                ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
                t.device_id, d.hostname AS device_hostname, d.os_name AS device_os_name,
                d.display_name AS device_display_name, d.users AS device_users,
                d.mesh_node_id IS NOT NULL AS device_has_remote,
                t.assignee_user_id, u.name AS assignee_name, u.email AS assignee_email,
                t.created_at, t.updated_at, t.channel, t.status_id, st.name AS status_label,
                ARRAY(SELECT contact_id FROM ticket_cc WHERE ticket_id = t.id ORDER BY contact_id) AS cc,
                ${TICKET_CLOCK_SQL}
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         LEFT JOIN devices d ON d.id = t.device_id
         LEFT JOIN users u ON u.id = t.assignee_user_id
         LEFT JOIN desk_statuses st ON st.id = t.status_id
         ${TICKET_CONTACT_JOIN}
         WHERE t.id = $1 AND t.org_id = $2`,
        [ticketMatch[1], actor.org_id],
      );
      if (!ticket.rows[0]) return send(res, 404, { error: "Ticket not found." });
      const license = await licenseQuery(actor.org_id);
      const comments = await pool.query(
        `SELECT tc.id, tc.body, tc.kind, tc.created_at, tc.author_label, u.name AS author_name
         FROM ticket_comments tc
         LEFT JOIN users u ON u.id = tc.author_user_id
         WHERE tc.ticket_id = $1
         ORDER BY tc.id`,
        [ticket.rows[0].id],
      );
      const timeline = await ticketTimeline(actor.org_id, ticket.rows[0].id, comments.rows);
      const time = await ticketTime(actor, ticket.rows[0].id);
      const users = await pool.query(
        "SELECT id, name, email FROM users WHERE org_id = $1 ORDER BY name",
        [actor.org_id],
      );
      const view = ticketView(ticket.rows[0]);
      const [accountContacts, deviceChoices, customerCounts, labels] = await Promise.all([
        pool.query(
          "SELECT id, name, email, phone, is_primary FROM contacts WHERE customer_id = $1 ORDER BY is_primary DESC, lower(name)",
          [ticket.rows[0].customer_id],
        ),
        pool.query(
          `SELECT d.id, d.hostname, d.display_name, d.contact_id, s.customer_id
           FROM devices d
           LEFT JOIN sites s ON s.id = d.site_id
           WHERE d.org_id = $1 AND (s.customer_id = $2 OR d.site_id IS NULL OR d.id = $3)
           ORDER BY lower(COALESCE(d.display_name, d.hostname))`,
          [actor.org_id, ticket.rows[0].customer_id, ticket.rows[0].device_id],
        ),
        pool.query(
          `SELECT (SELECT count(*)::int FROM devices d JOIN sites s ON s.id = d.site_id
                   WHERE s.customer_id = $1 AND d.org_id = $2) AS devices,
                  (SELECT count(*)::int FROM tickets t
                   WHERE t.customer_id = $1 AND t.org_id = $2 AND t.status <> 'resolved') AS open_tickets`,
          [ticket.rows[0].customer_id, actor.org_id],
        ),
        pool.query(
          `SELECT
             (SELECT array_agg(DISTINCT name ORDER BY name) FROM (
                SELECT category AS name FROM tickets WHERE org_id = $1 AND category IS NOT NULL
                UNION SELECT name FROM desk_categories WHERE org_id = $1) x) AS categories,
             (SELECT array_agg(DISTINCT name ORDER BY name) FROM (
                SELECT tag AS name FROM tickets, unnest(tags) AS tag WHERE org_id = $1
                UNION SELECT name FROM desk_tags WHERE org_id = $1) y) AS tags`,
          [actor.org_id],
        ),
      ]);
      const setup = await deskSetup(actor.org_id);
      const [links, watchers, rating] = await Promise.all([
        pool.query(
          `SELECT id, subject, status, 'parent' AS relation FROM tickets
           WHERE id = (SELECT parent_id FROM tickets WHERE id = $1) AND org_id = $2
           UNION ALL
           SELECT id, subject, status, 'child' FROM tickets WHERE parent_id = $1 AND org_id = $2
           ORDER BY relation DESC, id
           LIMIT 51`,
          [ticket.rows[0].id, actor.org_id],
        ),
        pool.query("SELECT user_id FROM ticket_watchers WHERE ticket_id = $1 ORDER BY created_at", [ticket.rows[0].id]),
        pool.query("SELECT rating, comment, updated_at FROM ticket_ratings WHERE ticket_id = $1", [ticket.rows[0].id]),
      ]);
      const ratingRow = rating.rows[0];
      const linkView = (row) => ({ id: Number(row.id), subject: row.subject, status: row.status });
      const parentRow = links.rows.find((row) => row.relation === "parent");
      const watcherIds = watchers.rows.map((row) => Number(row.user_id));
      const primaryContact = accountContacts.rows.find((row) => row.is_primary) || null;
      const latestJob = await pool.query(
        `SELECT id, command, status, exit_code, output, finished_at
         FROM jobs
         WHERE ticket_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [ticket.rows[0].id],
      );
      const job = latestJob.rows[0];
      const sla = slaFor(await slaBook(actor.org_id), ticket.rows[0].sla_plan_id);
      const remoteDesk = hasApp(license.rows[0]?.entitlements, "remote");
      return send(res, 200, {
        me: Number(actor.id),
        canRemote: remoteDesk && remoteAccess(license.rows[0]).canRemote,
        canRunCommands: remoteDesk && canOperate(actor),
        canPatch: patchAllowed(license.rows[0]),
        canReport: reportingAllowed(license.rows[0]),
        canMonitor: monitoringAllowed(license.rows[0]),
        canOperate: canOperate(actor),
        sla,
        clock: slaClock(ticket.rows[0], sla, new Date()),
        timeline,
        time,
        statuses: setup.statuses,
        priorityLabels: setup.priorityLabels,
        canned: setup.canned,
        ticket: {
          ...view,
          category: ticket.rows[0].category || null,
          tags: ticket.rows[0].tags || [],
          dueAt: ticket.rows[0].due_at,
          channel: ticket.rows[0].channel || "console",
          cc: (ticket.rows[0].cc || []).map(Number),
          mergedIntoId: ticket.rows[0].merged_into_id == null ? null : Number(ticket.rows[0].merged_into_id),
          movedTo: ticket.rows[0].migration_lock == null ? null : ticket.rows[0].moved_to || "another tenant",
          parent: parentRow ? linkView(parentRow) : null,
          children: links.rows.filter((row) => row.relation === "child").map(linkView),
          watchers: watcherIds,
          watching: watcherIds.includes(Number(actor.id)),
          rating: ratingRow ? { rating: ratingRow.rating, comment: ratingRow.comment || null, at: ratingRow.updated_at } : null,
          device: view.device
            ? {
              ...view.device,
              osName: ticket.rows[0].device_os_name,
              displayName: ticket.rows[0].device_display_name || view.device.hostname,
              users: Array.isArray(ticket.rows[0].device_users) ? ticket.rows[0].device_users : [],
              hasRemote: Boolean(ticket.rows[0].device_has_remote),
            }
            : null,
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
            kind: row.kind,
            createdAt: row.created_at,
            authorName: commentAuthor(row),
          })),
        },
        users: users.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })),
        contacts: accountContacts.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email || null, primary: row.is_primary })),
        devices: deviceChoices.rows.map(deviceChoice),
        categories: labels.rows[0].categories || [],
        tagChoices: labels.rows[0].tags || [],
        customerSummary: {
          id: Number(ticket.rows[0].customer_id),
          name: view.customer?.name || null,
          primaryContact: primaryContact
            ? { name: primaryContact.name, email: primaryContact.email || null, phone: primaryContact.phone || null }
            : null,
          deviceCount: remoteAccess(license.rows[0]).canRemote ? customerCounts.rows[0].devices : null,
          openTicketCount: customerCounts.rows[0].open_tickets,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/audit") {
      if (!requireActor(actor, res)) return;
      const action = url.searchParams.get("action");
      const orgId = actor.is_platform_admin ? null : actor.org_id || 0;
      const license = actor.org_id
        ? await licenseQuery(actor.org_id)
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
    if (error.message === "DF_MIGRATION_LOCKED") {
      return send(res, 409, { error: "This record was moved to another tenant and is now read-only." });
    }
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
    sweepSupport();
  }, 15000);
  runDueExports();
  sweepOffline();
  sweepBreaches();
  setTimeout(isolateTenantMesh, 30000);
  setInterval(isolateTenantMesh, 600000);
  setInterval(sweepTicketSessions, 60000);
  setInterval(sweepPendingAttachments, 3600000);
  const closePending = () => autoCloseSweep(deskHelpers()).catch((error) => console.error("auto-close failed", error.message));
  setTimeout(closePending, 90000);
  setInterval(closePending, 3600000);
  setTimeout(() => pollMailboxes(deskHelpers()), 45000);
  setInterval(() => pollMailboxes(deskHelpers()), 120000);
  setTimeout(writeDailySnapshots, 60000);
  setInterval(writeDailySnapshots, 600000);
  setInterval(sampleUptime, 5 * 60000);
  setTimeout(runDueSubscriptions, 120000);
  setInterval(runDueSubscriptions, 600000);
  recoverMigrations()
    .catch((error) => console.error(`migration recovery: ${error.message}`))
    .finally(() => setInterval(() => migrationTick(migrationHelpers()), 60000));
});
