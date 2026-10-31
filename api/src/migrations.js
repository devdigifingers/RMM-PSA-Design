import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { activityFromTicketEvent, recordActivity } from "./activity.js";
import { insertAudit } from "./audit.js";
import { pool } from "./db.js";
import { consoleUrl } from "./invites.js";
import { loadLicense } from "./license-store.js";
import { sendMail } from "./mail.js";
import {
  APPROVAL_ROLES,
  EXPIRY_DAYS,
  ROLLBACK_DAYS,
  approvalSummary,
  buildPlan,
  eligibleRoles,
  parseRequestInput,
  planSummary,
  purgeDue,
  renamed,
  requestFingerprint,
  rollbackOpen,
  significantChange,
} from "./migration-plan.js";

const ATTACHMENT_DIR = process.env.ATTACHMENT_DIR || "/var/lib/df-api/attachments";
const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const WAIT_WARN_MS = 10 * 60 * 1000;

export const MIGRATION_TABS = {
  pending: ["pending"],
  scheduled: ["approved", "scheduled"],
  running: ["running"],
  completed: ["completed", "failed"],
  rolled_back: ["rolled_back"],
  closed: ["expired", "cancelled", "declined", "draft"],
};

const ROLE_LABEL = { source_owner: "Source tenant", target_owner: "Target tenant", platform_admin: "Second platform admin" };

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------- Loading both sides ----------

function licenseFacts(effective, deviceCount) {
  if (!effective) return { active: false, features: [], devicesLeft: 0 };
  return {
    active: effective.entitlements.active,
    features: effective.entitlements.features,
    devicesLeft: effective.device_cap == null ? null : effective.device_cap - deviceCount,
  };
}

async function settingsOf(db, orgId) {
  const [categories, tags, canned, holidays] = await Promise.all([
    db.query("SELECT name FROM desk_categories WHERE org_id = $1", [orgId]),
    db.query("SELECT name FROM desk_tags WHERE org_id = $1", [orgId]),
    db.query("SELECT title FROM desk_canned_replies WHERE org_id = $1", [orgId]),
    db.query("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM desk_holidays WHERE org_id = $1", [orgId]),
  ]);
  return {
    categories: categories.rows.map((row) => row.name),
    tags: tags.rows.map((row) => row.name),
    cannedReplies: canned.rows.map((row) => row.title),
    holidays: holidays.rows.map((row) => row.day),
  };
}

async function loadSource(db, orgId) {
  const q = (sql) => db.query(sql, [orgId]).then((result) => result.rows);
  const [customers, contacts, sites, devices, tickets, slaPlans, users, settings] = await Promise.all([
    q("SELECT id, org_id, name FROM customers WHERE org_id = $1 AND migration_lock IS NULL ORDER BY id"),
    q("SELECT id, org_id, customer_id, name, email FROM contacts WHERE org_id = $1 AND migration_lock IS NULL ORDER BY id"),
    q("SELECT id, org_id, customer_id, name FROM sites WHERE org_id = $1 ORDER BY id"),
    q("SELECT id, org_id, site_id, hostname, display_name FROM devices WHERE org_id = $1 ORDER BY id"),
    q(`SELECT t.id, t.org_id, t.customer_id,
              (SELECT count(*)::int FROM ticket_comments c WHERE c.ticket_id = t.id AND c.org_id = t.org_id) AS comments,
              (SELECT count(*)::int FROM activity_events e WHERE e.ticket_id = t.id AND e.org_id = t.org_id AND e.type LIKE 'ticket.%') AS events,
              (SELECT count(*)::int FROM ticket_attachments a WHERE a.ticket_id = t.id AND a.org_id = t.org_id AND a.linked_at IS NOT NULL) AS attachments,
              (SELECT count(*)::int FROM ticket_time_entries te WHERE te.ticket_id = t.id AND te.org_id = t.org_id) AS time_entries
       FROM tickets t WHERE t.org_id = $1 AND t.migration_lock IS NULL ORDER BY t.id`),
    q("SELECT id, org_id, name FROM sla_plans WHERE org_id = $1 ORDER BY id"),
    q("SELECT id, org_id, name, email FROM users WHERE org_id = $1 AND is_platform_admin = false AND disabled_at IS NULL ORDER BY name"),
    settingsOf(db, orgId),
  ]);
  return { customers, contacts, sites, devices, tickets, slaPlans, users, settings };
}

async function loadTarget(db, orgId) {
  const q = (sql) => db.query(sql, [orgId]).then((result) => result.rows);
  const [customers, contacts, devices, slaPlans, settings] = await Promise.all([
    q("SELECT id, org_id, name FROM customers WHERE org_id = $1 AND migration_lock IS NULL"),
    q("SELECT id, org_id, email FROM contacts WHERE org_id = $1 AND migration_lock IS NULL AND email IS NOT NULL"),
    q("SELECT id, org_id, hostname FROM devices WHERE org_id = $1"),
    q("SELECT id, org_id, name FROM sla_plans WHERE org_id = $1"),
    settingsOf(db, orgId),
  ]);
  return { customers, contacts, devices, slaPlans, settings };
}

async function tenantNames(db, sourceId, targetId) {
  const rows = await db.query("SELECT id, name FROM orgs WHERE id = ANY($1::bigint[])", [[sourceId, targetId]]);
  const byId = new Map(rows.rows.map((row) => [Number(row.id), row.name]));
  if (!byId.has(Number(sourceId)) || !byId.has(Number(targetId))) throw fail(404, "Tenant not found.");
  return { source: byId.get(Number(sourceId)), target: byId.get(Number(targetId)) };
}

export async function dryRun(db, input) {
  const names = await tenantNames(db, input.sourceId, input.targetId);
  const [sourceLicense, targetLicense, source, target, deviceCount] = await Promise.all([
    loadLicense(db, input.sourceId),
    loadLicense(db, input.targetId),
    loadSource(db, input.sourceId),
    loadTarget(db, input.targetId),
    db.query("SELECT count(*)::int AS n FROM devices WHERE org_id = $1", [input.targetId]).then((r) => r.rows[0].n),
  ]);
  const plan = buildPlan({
    request: input,
    source,
    target,
    sourceLicense: licenseFacts(sourceLicense, 0),
    targetLicense: licenseFacts(targetLicense, deviceCount),
    names,
  });
  return { plan, names };
}

// ---------- Approvers, events, notifications ----------

// The tenant's owners decide; a tenant without an owner falls back to its admins.
export async function tenantApprovers(db, orgId) {
  const rows = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, r.name AS role
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.org_id = u.org_id
     WHERE u.org_id = $1 AND u.disabled_at IS NULL AND u.is_platform_admin = false AND r.name IN ('owner', 'admin')
     ORDER BY u.name`,
    [orgId],
  );
  const owners = rows.rows.filter((row) => row.role === "owner");
  const chosen = owners.length ? owners : rows.rows.filter((row) => row.role === "admin");
  return chosen.map((row) => ({ id: Number(row.id), name: row.name, email: row.email, role: row.role }));
}

async function platformAdmins(db) {
  const rows = await db.query("SELECT id, name, email FROM users WHERE is_platform_admin = true AND platform_role IN ('super', 'admin') AND disabled_at IS NULL ORDER BY id");
  return rows.rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email }));
}

async function logEvent(db, request, kind, actorId = null, detail = {}) {
  await db.query(
    "INSERT INTO migration_events (request_id, kind, actor_user_id, detail) VALUES ($1, $2, $3, $4::jsonb)",
    [request.id, kind, actorId, JSON.stringify(detail)],
  );
  const audit = { requestId: Number(request.id), source: Number(request.source_tenant_id), target: Number(request.target_tenant_id), ...detail };
  for (const orgId of [request.source_tenant_id, request.target_tenant_id]) {
    await insertAudit(db, orgId, actorId, `migration.${kind}`, "migration", String(request.id), audit);
  }
}

async function inApp(db, orgId, users, title) {
  for (const user of users) {
    await db.query(
      "INSERT INTO user_notifications (org_id, user_id, kind, title) VALUES ($1, $2, 'migration', $3)",
      [orgId, user.id, title.slice(0, 200)],
    );
  }
}

async function mail(to, subject, lines) {
  try {
    await sendMail({ to, subject, text: lines.join("\n") });
  } catch (error) {
    console.error(`migration mail: ${error.message}`);
  }
}

// who: "approvers" asks for decisions; "parties" reports progress to both tenants and the requester.
async function notifyParties(request, { title, lines, who = "parties" }) {
  try {
    const names = await tenantNames(pool, request.source_tenant_id, request.target_tenant_id);
    const [source, target, admins] = await Promise.all([
      tenantApprovers(pool, request.source_tenant_id),
      tenantApprovers(pool, request.target_tenant_id),
      platformAdmins(pool),
    ]);
    const heading = `${title}: ${names.source} to ${names.target}`;
    await inApp(pool, request.source_tenant_id, source, heading);
    await inApp(pool, request.target_tenant_id, target, heading);
    const tenantLink = `${consoleUrl()}/settings/org/migrations/${request.id}`;
    const adminLink = `${consoleUrl()}/control/migrations/${request.id}`;
    const sent = new Set();
    const send = async (person, link) => {
      if (!person.email || sent.has(person.email)) return;
      sent.add(person.email);
      await mail(person.email, heading, [`Hello ${person.name},`, "", ...lines, "", `Open it here (you will be asked to sign in): ${link}`]);
    };
    for (const person of [...source, ...target]) await send(person, tenantLink);
    const requester = admins.find((admin) => admin.id === Number(request.requested_by));
    if (who === "approvers") {
      for (const admin of admins) if (admin.id !== Number(request.requested_by)) await send(admin, adminLink);
    } else if (requester) {
      await send(requester, adminLink);
    }
  } catch (error) {
    console.error(`migration notify ${request.id}: ${error.message}`);
  }
}

async function setProgress(requestId, progress) {
  await pool.query("UPDATE migration_requests SET progress = $2::jsonb, updated_at = now() WHERE id = $1", [requestId, JSON.stringify(progress)]);
}

// ---------- Views ----------

function requestView(row) {
  const submitted = new Date(row.submitted_at);
  const completed = row.completed_at ? new Date(row.completed_at) : null;
  return {
    id: Number(row.id),
    source: { id: Number(row.source_tenant_id), name: row.source_name },
    target: { id: Number(row.target_tenant_id), name: row.target_name },
    scope: row.scope,
    mode: row.mode,
    resolutions: row.resolutions,
    acknowledged: row.acknowledged,
    scheduleAt: row.schedule_at,
    status: row.status,
    requestedBy: { id: Number(row.requested_by), name: row.requester_name },
    dryRun: row.dry_run_snapshot,
    progress: row.progress,
    result: row.result,
    submittedAt: row.submitted_at,
    expiresAt: row.status === "pending" ? new Date(submitted.getTime() + EXPIRY_DAYS * DAY_MS).toISOString() : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    purgedAt: row.purged_at,
    rollbackUntil: completed && row.mode === "move" ? new Date(completed.getTime() + ROLLBACK_DAYS * DAY_MS).toISOString() : null,
    rollback: row.rollback_requested_at
      ? {
        requestedBy: { id: Number(row.rollback_requested_by), name: row.rollback_requester_name },
        requestedAt: row.rollback_requested_at,
        keepChanges: row.rollback_keep === true,
        approvedBy: row.rollback_approved_by ? { id: Number(row.rollback_approved_by), name: row.rollback_approver_name } : null,
        approvedAt: row.rollback_approved_at,
      }
      : null,
    rolledBackAt: row.rolled_back_at,
  };
}

const REQUEST_SELECT = `
  SELECT m.*, s.name AS source_name, t.name AS target_name, u.name AS requester_name,
         ru.name AS rollback_requester_name, ra.name AS rollback_approver_name
  FROM migration_requests m
  JOIN orgs s ON s.id = m.source_tenant_id
  JOIN orgs t ON t.id = m.target_tenant_id
  LEFT JOIN users u ON u.id = m.requested_by
  LEFT JOIN users ru ON ru.id = m.rollback_requested_by
  LEFT JOIN users ra ON ra.id = m.rollback_approved_by`;

async function loadRequest(db, id, { lock = false } = {}) {
  const sql = lock ? "SELECT * FROM migration_requests WHERE id = $1 FOR UPDATE" : `${REQUEST_SELECT} WHERE m.id = $1`;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

async function liveApprovals(db, requestId) {
  const rows = await db.query(
    `SELECT a.*, u.name AS user_name FROM migration_approvals a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.request_id = $1 AND a.cleared_at IS NULL ORDER BY a.id`,
    [requestId],
  );
  return rows.rows;
}

function approvalsView(rows, { names = true } = {}) {
  return APPROVAL_ROLES.map((role) => {
    const row = rows.find((item) => item.role === role);
    return {
      role,
      label: ROLE_LABEL[role],
      decision: row?.decision || null,
      reason: row?.reason || null,
      decidedAt: row?.decided_at || null,
      by: row && names ? row.user_name : null,
    };
  });
}

// Changes made in the target after the run; rollback lists these before the admin chooses.
async function targetChanges(db, request) {
  if (request.status !== "completed" || !request.completed_at) return null;
  const params = [request.id, request.target_tenant_id, request.completed_at];
  const one = async (sql) => (await db.query(sql, params)).rows[0].n;
  const mapped = (type) => `SELECT target_id FROM migration_id_map WHERE request_id = $1 AND entity_type = '${type}' AND NOT merged`;
  const [comments, timeEntries, tickets, newTickets, newContacts] = await Promise.all([
    one(`SELECT count(*)::int AS n FROM ticket_comments WHERE org_id = $2 AND created_at > $3 AND ticket_id IN (${mapped("ticket")})`),
    one(`SELECT count(*)::int AS n FROM ticket_time_entries WHERE org_id = $2 AND created_at > $3 AND ticket_id IN (${mapped("ticket")})`),
    one(`SELECT count(*)::int AS n FROM tickets WHERE org_id = $2 AND updated_at > $3 AND id IN (${mapped("ticket")})`),
    one(`SELECT count(*)::int AS n FROM tickets WHERE org_id = $2 AND created_at > $3 AND customer_id IN (${mapped("customer")})
           AND id NOT IN (${mapped("ticket")})`),
    one(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $2 AND created_at > $3 AND customer_id IN (${mapped("customer")})
           AND id NOT IN (${mapped("contact")})`),
  ]);
  return { comments, timeEntries, tickets, newTickets, newContacts, total: comments + timeEntries + tickets + newTickets + newContacts };
}

// ---------- Decisions ----------

async function decide(actor, requestId, decision, reason, side) {
  const client = await pool.connect();
  let request;
  let outcome = null;
  try {
    await client.query("BEGIN");
    request = await loadRequest(client, requestId, { lock: true });
    if (!request) throw fail(404, "Migration request not found.");
    if (!actor.is_platform_admin && ![Number(request.source_tenant_id), Number(request.target_tenant_id)].includes(Number(actor.org_id))) {
      throw fail(404, "Migration request not found.");
    }
    if (request.status !== "pending") throw fail(409, "This request is no longer waiting for approval.");
    const approvals = await liveApprovals(client, request.id);
    const [sourceApprovers, targetApprovers] = await Promise.all([
      tenantApprovers(client, request.source_tenant_id),
      tenantApprovers(client, request.target_tenant_id),
    ]);
    const roles = eligibleRoles({
      user: { id: actor.id, isPlatformAdmin: actor.is_platform_admin === true, impersonating: Boolean(actor.impersonating) },
      request,
      sourceApprovers: sourceApprovers.map((row) => row.id),
      targetApprovers: targetApprovers.map((row) => row.id),
      approvals,
    }).filter((role) => (side === "platform" ? role === "platform_admin" : role !== "platform_admin"));
    if (!roles.length) {
      if (side === "platform" && Number(actor.id) === Number(request.requested_by)) {
        throw fail(403, "You made this request, so a different platform admin has to approve it.");
      }
      throw fail(403, "You cannot decide on this request, or you already have.");
    }
    if (decision === "declined" && !reason) throw fail(400, "Give a reason for declining.");
    for (const role of roles) {
      await client.query(
        "INSERT INTO migration_approvals (request_id, role, user_id, decision, reason) VALUES ($1, $2, $3, $4, $5)",
        [request.id, role, actor.id, decision, reason || null],
      );
      await logEvent(client, request, decision === "approved" ? "approve" : "decline", actor.id, { role, reason: reason || undefined });
    }
    if (decision === "declined") {
      await client.query("UPDATE migration_requests SET status = 'declined', updated_at = now() WHERE id = $1", [request.id]);
      outcome = "declined";
    } else {
      const summary = approvalSummary(await liveApprovals(client, request.id), request.requested_by);
      if (summary.complete) {
        const later = request.schedule_at && new Date(request.schedule_at).getTime() > Date.now();
        await client.query("UPDATE migration_requests SET status = $2, updated_at = now() WHERE id = $1", [request.id, later ? "scheduled" : "approved"]);
        await logEvent(client, request, "approved_all", null, { scheduleAt: request.schedule_at });
        outcome = later ? "scheduled" : "approved";
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (outcome === "declined") {
    await notifyParties(request, { title: "Migration declined", lines: [`The migration request was declined. Reason: ${reason}`] });
  } else if (outcome) {
    await notifyParties(request, {
      title: "Migration approved",
      lines: [outcome === "scheduled" ? `All approvals are in. It runs at ${new Date(request.schedule_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}.` : "All approvals are in. It runs within a few minutes."],
    });
  }
  return outcome;
}

// ---------- Copying ----------

class Run {
  constructor(client, request, plan, names) {
    this.c = client;
    this.request = request;
    this.plan = plan;
    this.names = names;
    this.src = Number(request.source_tenant_id);
    this.dst = Number(request.target_tenant_id);
    this.maps = { customer: new Map(), site: new Map(), contact: new Map(), device: new Map(), ticket: new Map(), comment: new Map(), sla_plan: new Map() };
    this.files = [];
    this.done = {};
    this.warnings = [];
    this.movedDevices = [];
  }

  async record(type, sourceId, targetId, merged = false, detail = null) {
    if (this.maps[type]) this.maps[type].set(Number(sourceId), Number(targetId));
    await this.c.query(
      `INSERT INTO migration_id_map (request_id, entity_type, source_id, target_id, merged, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [this.request.id, type, sourceId, targetId, merged, detail ? JSON.stringify(detail) : null],
    );
  }

  count(key, n = 1) {
    this.done[key] = (this.done[key] || 0) + n;
  }

  conflictTarget(key) {
    return this.plan.conflicts.find((item) => item.key === key)?.targetId;
  }

  async progress(phase) {
    await setProgress(this.request.id, { phase, done: this.done, totals: this.plan.counts });
  }

  async settings() {
    const { c, src, dst } = this;
    const taken = (await c.query("SELECT name FROM sla_plans WHERE org_id = $1", [dst])).rows.map((row) => row.name);
    for (const [id, action] of Object.entries(this.plan.selection.slaPlans)) {
      if (action === "skip") continue;
      if (action === "merge") {
        await this.record("sla_plan", id, this.conflictTarget(`sla_plan:${id}`), true);
        continue;
      }
      const row = (await c.query("SELECT * FROM sla_plans WHERE id = $1 AND org_id = $2", [id, src])).rows[0];
      if (!row) continue;
      const name = action === "rename" ? renamed(row.name, taken) : row.name;
      taken.push(name);
      const made = await c.query(
        `INSERT INTO sla_plans (org_id, name, response_minutes, resolve_minutes, priority_percent)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [dst, name, row.response_minutes, row.resolve_minutes, JSON.stringify(row.priority_percent)],
      );
      await this.record("sla_plan", id, made.rows[0].id);
      this.count("slaPlans");
    }
    const lists = [
      ["desk_category", "desk_categories", "name", ["name"]],
      ["desk_tag", "desk_tags", "name", ["name"]],
      ["desk_canned_reply", "desk_canned_replies", "title", ["title", "body"]],
      ["desk_holiday", "desk_holidays", "day", ["day", "name"]],
    ];
    for (const [type, table, key, columns] of lists) {
      const missing = await c.query(
        `SELECT s.id, ${columns.map((col) => `s.${col}`).join(", ")} FROM ${table} s
         WHERE s.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM ${table} t WHERE t.org_id = $2 AND lower(t.${key}::text) = lower(s.${key}::text))`,
        [src, dst],
      );
      for (const row of missing.rows) {
        const made = await c.query(
          `INSERT INTO ${table} (org_id, ${columns.join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
          [dst, ...columns.map((col) => row[col])],
        );
        await this.record(type, row.id, made.rows[0].id);
        this.count("settings");
      }
    }
  }

  async customers() {
    const { c, src, dst } = this;
    const ids = Object.keys(this.plan.selection.customers).map(Number);
    if (!ids.length) return;
    const taken = (await c.query("SELECT name FROM customers WHERE org_id = $1", [dst])).rows.map((row) => row.name);
    const rows = await c.query("SELECT * FROM customers WHERE org_id = $1 AND id = ANY($2::bigint[]) ORDER BY id", [src, ids]);
    for (const row of rows.rows) {
      const action = this.plan.selection.customers[row.id];
      if (action === "skip") continue;
      let targetId;
      if (action === "merge") {
        targetId = this.conflictTarget(`customer:${row.id}`);
        await this.record("customer", row.id, targetId, true);
        this.count("customersMerged");
      } else {
        const name = action === "rename" ? renamed(row.name, taken) : row.name;
        taken.push(name);
        const made = await c.query(
          `INSERT INTO customers (org_id, name, kind, website, email, phone, alt_phone, address, registration_number, vat_number,
                                  notes, sla_plan_id, contract_start, contract_end, contract_notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
          [dst, name, row.kind, row.website, row.email, row.phone, row.alt_phone, row.address, row.registration_number, row.vat_number,
            row.notes, row.sla_plan_id ? this.maps.sla_plan.get(Number(row.sla_plan_id)) ?? null : null,
            row.contract_start, row.contract_end, row.contract_notes, row.created_at],
        );
        targetId = Number(made.rows[0].id);
        await this.record("customer", row.id, targetId);
        this.count("customers");
      }
      const sites = await c.query("SELECT * FROM sites WHERE org_id = $1 AND customer_id = $2 ORDER BY id", [src, row.id]);
      for (const site of sites.rows) {
        const existing = await c.query(
          "SELECT id FROM sites WHERE org_id = $1 AND customer_id = $2 AND lower(name) = lower($3) LIMIT 1",
          [dst, targetId, site.name],
        );
        if (existing.rows[0]) {
          await this.record("site", site.id, existing.rows[0].id, true);
        } else {
          const made = await c.query("INSERT INTO sites (org_id, customer_id, name, created_at) VALUES ($1, $2, $3, $4) RETURNING id", [dst, targetId, site.name, site.created_at]);
          await this.record("site", site.id, made.rows[0].id);
        }
      }
    }
    await this.progress("customers");
  }

  async contacts() {
    const { c, src, dst } = this;
    const ids = Object.keys(this.plan.selection.contacts).map(Number);
    if (!ids.length) return;
    const rows = await c.query("SELECT * FROM contacts WHERE org_id = $1 AND id = ANY($2::bigint[]) ORDER BY id", [src, ids]);
    for (const row of rows.rows) {
      const action = this.plan.selection.contacts[row.id];
      if (action === "skip") continue;
      if (action === "merge") {
        await this.record("contact", row.id, this.conflictTarget(`contact:${row.id}`), true);
        this.count("contactsMerged");
        continue;
      }
      const customerId = this.maps.customer.get(Number(row.customer_id));
      if (!customerId) continue;
      let primary = row.is_primary;
      if (primary) {
        const has = await c.query("SELECT 1 FROM contacts WHERE customer_id = $1 AND is_primary", [customerId]);
        primary = !has.rows.length;
      }
      const made = await c.query(
        `INSERT INTO contacts (org_id, customer_id, name, email, phone, alt_phone, job_title, is_primary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [dst, customerId, action === "rename" ? `${row.name} (migrated)` : row.name, row.email, row.phone, row.alt_phone, row.job_title, primary, row.created_at],
      );
      await this.record("contact", row.id, made.rows[0].id);
      this.count("contacts");
    }
    await this.progress("contacts");
  }

  async devices() {
    const { c, src, dst } = this;
    const entries = Object.entries(this.plan.selection.devices);
    if (!entries.length) return;
    const hosts = (await c.query("SELECT display_name FROM devices WHERE org_id = $1", [dst])).rows.map((row) => row.display_name);
    for (const [id, action] of entries) {
      if (action === "skip") continue;
      if (action === "merge") {
        await this.record("device", id, this.conflictTarget(`device:${id}`), true);
        continue;
      }
      const row = (await c.query("SELECT id, site_id, contact_id, display_name, mesh_node_id FROM devices WHERE id = $1 AND org_id = $2", [id, src])).rows[0];
      if (!row) continue;
      const siteId = row.site_id ? this.maps.site.get(Number(row.site_id)) ?? null : null;
      const contactId = row.contact_id ? this.maps.contact.get(Number(row.contact_id)) ?? null : null;
      const displayName = action === "rename" ? renamed(row.display_name, hosts) : row.display_name;
      await c.query(
        "UPDATE devices SET org_id = $3, site_id = $4, contact_id = $5, display_name = $6 WHERE id = $1 AND org_id = $2",
        [row.id, src, dst, siteId, contactId, displayName],
      );
      await this.record("device", row.id, row.id, false, {
        siteId: row.site_id == null ? null : Number(row.site_id),
        contactId: row.contact_id == null ? null : Number(row.contact_id),
        displayName: row.display_name,
      });
      if (row.mesh_node_id) this.movedDevices.push(row.mesh_node_id);
      this.count("devices");
    }
    const moved = [...this.maps.device].filter(([from, to]) => from === to).map(([from]) => from);
    if (moved.length) await moveDeviceRows(c, moved, src, dst);
    await this.progress("devices");
  }

  async tickets() {
    const ids = this.plan.selection.tickets;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      await copyTickets(this.c, {
        from: this.src,
        to: this.dst,
        ids: batch,
        maps: this.maps,
        record: (type, from, to) => this.record(type, from, to),
        files: this.files,
        warnings: this.warnings,
        marker: { kind: "migrated", label: "Migration", detail: (row) => ({ from: Number(row.id), sourceTenant: this.names.source, requestId: Number(this.request.id) }) },
        counter: (key, n) => this.count(key, n),
      });
      await this.progress("tickets");
    }
    await relinkTickets(this.c, this.src, this.dst, ids, this.maps.ticket);
    const moved = [...this.maps.device].filter(([from, to]) => from === to).map(([from]) => from);
    if (moved.length) await relinkDeviceRows(this.c, moved, this.dst, this.maps.ticket, this.maps.customer);
  }

  async activity() {
    const copied = await copyActivity(this.c, { from: this.src, to: this.dst, requestId: this.request.id, maps: this.maps });
    this.count("activity", copied);
    await this.progress("activity");
  }

  async lockSource() {
    const { c, src } = this;
    const id = this.request.id;
    const lock = async (table, type) => {
      const ids = [...this.maps[type].keys()];
      if (ids.length) await c.query(`UPDATE ${table} SET migration_lock = $1 WHERE org_id = $2 AND id = ANY($3::bigint[])`, [id, src, ids]);
    };
    await lock("customers", "customer");
    await lock("contacts", "contact");
    await lock("tickets", "ticket");
  }
}

async function deviceTables(c) {
  const rows = await c.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name IN ('org_id', 'device_id') AND table_name NOT IN ('devices', 'tickets', 'activity_events')
     GROUP BY table_name HAVING count(*) = 2 ORDER BY table_name`,
  );
  return rows.rows.map((row) => row.table_name);
}

async function moveDeviceRows(c, deviceIds, from, to) {
  for (const table of await deviceTables(c)) {
    await c.query(`UPDATE ${table} SET org_id = $3 WHERE org_id = $2 AND device_id = ANY($1::bigint[])`, [deviceIds, from, to]);
  }
}

// Rows that followed a moved device still point at the old tenant's tickets and customers.
async function relinkDeviceRows(c, deviceIds, orgId, ticketMap, customerMap) {
  for (const table of ["jobs", "alerts", "remote_sessions"]) {
    const refs = await c.query(`SELECT DISTINCT ticket_id FROM ${table} WHERE org_id = $1 AND device_id = ANY($2::bigint[]) AND ticket_id IS NOT NULL`, [orgId, deviceIds]);
    for (const { ticket_id: ticketId } of refs.rows) {
      await c.query(`UPDATE ${table} SET ticket_id = $3 WHERE org_id = $1 AND device_id = ANY($2::bigint[]) AND ticket_id = $4`,
        [orgId, deviceIds, ticketMap.get(Number(ticketId)) ?? null, ticketId]);
    }
  }
  const refs = await c.query("SELECT DISTINCT customer_id FROM remote_sessions WHERE org_id = $1 AND device_id = ANY($2::bigint[]) AND customer_id IS NOT NULL", [orgId, deviceIds]);
  for (const { customer_id: customerId } of refs.rows) {
    await c.query("UPDATE remote_sessions SET customer_id = $3 WHERE org_id = $1 AND device_id = ANY($2::bigint[]) AND customer_id = $4",
      [orgId, deviceIds, customerMap.get(Number(customerId)) ?? null, customerId]);
  }
}

const pairs = (map) => [[...map.keys()], [...map.values()]];

// Copies the timeline of migrated customers and devices. Users belong to the old tenant, so only their names travel.
export async function copyActivity(c, { from, to, requestId, maps }) {
  const [customerFrom, customerTo] = pairs(maps.customer);
  const [deviceFrom, deviceTo] = pairs(maps.device);
  if (!customerFrom.length && !deviceFrom.length) return 0;
  const [ticketFrom, ticketTo] = pairs(maps.ticket);
  const [contactFrom, contactTo] = pairs(maps.contact);
  const [commentFrom, commentTo] = pairs(maps.comment || new Map());
  const result = await c.query(
    `INSERT INTO activity_events (org_id, customer_id, device_id, ticket_id, contact_id, type, app, actor_type, actor_label,
                                  summary, payload, source, source_id, created_at)
     SELECT $2, cm.t, dm.t, tm.t, km.t, e.type, e.app, e.actor_type, COALESCE(u.name, e.actor_label), e.summary,
            CASE WHEN e.payload ? 'commentId' THEN jsonb_set(e.payload, '{commentId}', COALESCE(to_jsonb(cc.t), 'null'::jsonb)) ELSE e.payload END,
            'migration', $11 || ':' || e.id, e.created_at
     FROM activity_events e
     LEFT JOIN unnest($3::bigint[], $4::bigint[]) AS cm (s, t) ON cm.s = e.customer_id
     LEFT JOIN unnest($5::bigint[], $6::bigint[]) AS dm (s, t) ON dm.s = e.device_id
     LEFT JOIN unnest($7::bigint[], $8::bigint[]) AS tm (s, t) ON tm.s = e.ticket_id
     LEFT JOIN unnest($9::bigint[], $10::bigint[]) AS km (s, t) ON km.s = e.contact_id
     LEFT JOIN unnest($12::bigint[], $13::bigint[]) AS cc (s, t) ON cc.s::text = e.payload->>'commentId'
     LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.org_id = $1 AND (cm.s IS NOT NULL OR dm.s IS NOT NULL)
       AND NOT (e.type LIKE 'ticket.%' AND tm.s IS NULL)
     ORDER BY e.created_at, e.id
     ON CONFLICT (source, source_id) WHERE source IS NOT NULL DO NOTHING`,
    [from, to, customerFrom, customerTo, deviceFrom, deviceTo, ticketFrom, ticketTo, contactFrom, contactTo, String(requestId), commentFrom, commentTo],
  );
  return result.rowCount;
}

// Undoes copyActivity. After a Move, what the moved records gathered in the target since goes back with them.
// Ticket history only goes back when the rollback keeps the target's ticket work; device and customer events always do.
export async function rollbackActivity(c, { src, dst, requestId, move, keep = false, customers, devices, tickets, contacts, comments = new Map() }) {
  await c.query("DELETE FROM activity_events WHERE org_id = $1 AND source = 'migration' AND source_id LIKE $2", [dst, `${requestId}:%`]);
  if (!move || (!customers.size && !devices.length)) return;
  const [customerFrom, customerTo] = pairs(customers);
  const [ticketFrom, ticketTo] = pairs(tickets);
  const [contactFrom, contactTo] = pairs(contacts);
  const [commentFrom, commentTo] = pairs(comments);
  await c.query(
    `UPDATE activity_events e SET
       org_id = $2,
       customer_id = (SELECT m.t FROM unnest($4::bigint[], $5::bigint[]) AS m (s, t) WHERE m.s = e.customer_id),
       ticket_id = (SELECT m.t FROM unnest($6::bigint[], $7::bigint[]) AS m (s, t) WHERE m.s = e.ticket_id),
       contact_id = (SELECT m.t FROM unnest($8::bigint[], $9::bigint[]) AS m (s, t) WHERE m.s = e.contact_id),
       payload = CASE WHEN e.payload ? 'commentId' THEN jsonb_set(e.payload, '{commentId}', COALESCE(
         (SELECT to_jsonb(m.t) FROM unnest($11::bigint[], $12::bigint[]) AS m (s, t) WHERE m.s::text = e.payload->>'commentId'),
         'null'::jsonb)) ELSE e.payload END,
       actor_label = COALESCE((SELECT u.name FROM users u WHERE u.id = e.actor_user_id), e.actor_label),
       actor_user_id = NULL
     WHERE e.org_id = $1 AND e.created_at > (SELECT completed_at FROM migration_requests WHERE id = $3)
       AND (e.customer_id = ANY($4::bigint[]) OR e.device_id = ANY($10::bigint[]))
       AND ($13::boolean OR e.type NOT LIKE 'ticket.%')`,
    [dst, src, requestId, customerFrom, customerTo, ticketFrom, ticketTo, contactFrom, contactTo, devices, commentFrom, commentTo, keep],
  );
}

async function newStorageKey(orgId, key, files, warnings) {
  const next = `${orgId}/${randomBytes(16).toString("hex")}`;
  try {
    await mkdir(dirname(join(ATTACHMENT_DIR, next)), { recursive: true });
    await copyFile(join(ATTACHMENT_DIR, key), join(ATTACHMENT_DIR, next));
    files.push(next);
    return next;
  } catch {
    warnings.push(`An attachment file was missing on disk and was not copied (${key.split("/").pop().slice(0, 8)}…).`);
    return null;
  }
}

// Copies tickets with their timeline from one tenant to another. Used forward and, for kept changes, in reverse.
async function copyTickets(c, { from, to, ids, maps, record, files, warnings, marker, counter = () => {} }) {
  if (!ids.length) return;
  const rows = await c.query("SELECT * FROM tickets WHERE org_id = $1 AND id = ANY($2::bigint[]) ORDER BY id", [from, ids]);
  for (const row of rows.rows) {
    const customerId = maps.customer.get(Number(row.customer_id));
    if (!customerId) continue;
    const made = await c.query(
      `INSERT INTO tickets (org_id, customer_id, device_id, contact_id, subject, status, priority, category, tags, due_at, channel,
                            sla_pauses, sla_warned, email_message_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16) RETURNING id`,
      [to, customerId, row.device_id ? maps.device.get(Number(row.device_id)) ?? null : null,
        row.contact_id ? maps.contact.get(Number(row.contact_id)) ?? null : null,
        row.subject, row.status, row.priority, row.category, row.tags, row.due_at, row.channel,
        JSON.stringify(row.sla_pauses || []), row.sla_warned, row.email_message_id, row.created_at, row.updated_at],
    );
    const newId = Number(made.rows[0].id);
    if (record) await record("ticket", row.id, newId);
    else maps.ticket.set(Number(row.id), newId);
    if (marker) {
      await recordActivity(c, to, {
        ...activityFromTicketEvent(marker.kind, marker.detail(row)),
        ticketId: newId,
        actorType: "system",
        actorLabel: marker.label,
      });
    }
    counter("tickets", 1);
  }
  const mapped = ids.filter((id) => maps.ticket.has(Number(id)));
  if (!mapped.length) return;
  const ticketOf = (id) => maps.ticket.get(Number(id));

  const comments = await c.query(
    `SELECT tc.*, u.name AS author_name FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.author_user_id
     WHERE tc.org_id = $1 AND tc.ticket_id = ANY($2::bigint[]) ORDER BY tc.id`,
    [from, mapped],
  );
  for (const row of comments.rows) {
    const made = await c.query(
      `INSERT INTO ticket_comments (org_id, ticket_id, author_label, body, kind, created_at, email_message_id, email_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [to, ticketOf(row.ticket_id), row.author_label || row.author_name || null, row.body, row.kind, row.created_at, row.email_message_id, row.email_from],
    );
    if (record) await record("comment", row.id, made.rows[0].id);
    else maps.comment.set(Number(row.id), Number(made.rows[0].id));
  }
  counter("comments", comments.rows.length);

  const attachments = await c.query(
    "SELECT * FROM ticket_attachments WHERE org_id = $1 AND ticket_id = ANY($2::bigint[]) AND linked_at IS NOT NULL ORDER BY id",
    [from, mapped],
  );
  for (const row of attachments.rows) {
    const key = await newStorageKey(to, row.storage_key, files, warnings);
    if (!key) continue;
    const made = await c.query(
      `INSERT INTO ticket_attachments (org_id, ticket_id, comment_id, file_name, content_type, is_image, size_bytes, storage_key, linked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [to, ticketOf(row.ticket_id), row.comment_id ? maps.comment.get(Number(row.comment_id)) ?? null : null,
        row.file_name, row.content_type, row.is_image, row.size_bytes, key, row.linked_at, row.created_at],
    );
    if (record) await record("attachment", row.id, made.rows[0].id);
    counter("attachments", 1);
  }

  const time = await c.query(
    `SELECT te.*, u.name AS user_name FROM ticket_time_entries te LEFT JOIN users u ON u.id = te.user_id
     WHERE te.org_id = $1 AND te.ticket_id = ANY($2::bigint[]) ORDER BY te.id`,
    [from, mapped],
  );
  for (const row of time.rows) {
    const note = row.user_name ? `${row.user_name}${row.note ? `: ${row.note}` : ""}` : row.note;
    await c.query(
      `INSERT INTO ticket_time_entries (org_id, ticket_id, minutes, billable, note, source, started_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [to, ticketOf(row.ticket_id), row.minutes, row.billable, note, row.source, row.started_at, row.created_at],
    );
  }
  counter("timeEntries", time.rows.length);

  const cc = await c.query("SELECT ticket_id, contact_id FROM ticket_cc WHERE org_id = $1 AND ticket_id = ANY($2::bigint[])", [from, mapped]);
  for (const row of cc.rows) {
    const contactId = maps.contact.get(Number(row.contact_id));
    if (contactId) {
      await c.query("INSERT INTO ticket_cc (org_id, ticket_id, contact_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [to, ticketOf(row.ticket_id), contactId]);
    }
  }
  const ratings = await c.query("SELECT * FROM ticket_ratings WHERE org_id = $1 AND ticket_id = ANY($2::bigint[])", [from, mapped]);
  for (const row of ratings.rows) {
    await c.query(
      `INSERT INTO ticket_ratings (ticket_id, org_id, rating, comment, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketOf(row.ticket_id), to, row.rating, row.comment, row.created_at, row.updated_at],
    );
  }
}

async function relinkTickets(c, from, to, ids, ticketMap) {
  const rows = await c.query(
    "SELECT id, merged_into_id, parent_id FROM tickets WHERE org_id = $1 AND id = ANY($2::bigint[]) AND (merged_into_id IS NOT NULL OR parent_id IS NOT NULL)",
    [from, ids],
  );
  for (const row of rows.rows) {
    const target = ticketMap.get(Number(row.id));
    if (!target) continue;
    await c.query("UPDATE tickets SET merged_into_id = $3, parent_id = $4 WHERE id = $1 AND org_id = $2", [
      target, to,
      row.merged_into_id ? ticketMap.get(Number(row.merged_into_id)) ?? null : null,
      row.parent_id ? ticketMap.get(Number(row.parent_id)) ?? null : null,
    ]);
  }
}

// Deletes tickets with everything hanging off them. Only ever called inside a migration transaction.
async function deleteTickets(c, orgId, ids, removedFiles) {
  if (!ids.length) return;
  const list = [ids];
  for (const table of ["jobs", "alerts", "support_sessions", "remote_sessions"]) {
    await c.query(`UPDATE ${table} SET ticket_id = NULL WHERE ticket_id = ANY($1::bigint[])`, list);
  }
  await c.query("UPDATE tickets SET merged_into_id = NULL WHERE merged_into_id = ANY($1::bigint[]) AND NOT (id = ANY($1::bigint[]))", list);
  const files = await c.query("DELETE FROM ticket_attachments WHERE org_id = $1 AND ticket_id = ANY($2::bigint[]) RETURNING storage_key", [orgId, ids]);
  removedFiles.push(...files.rows.map((row) => row.storage_key));
  await c.query("DELETE FROM activity_events WHERE org_id = $1 AND ticket_id = ANY($2::bigint[])", [orgId, ids]);
  for (const table of ["ticket_timers", "ticket_time_entries", "ticket_comments", "ticket_events", "ticket_cc", "ticket_watchers", "ticket_ratings", "user_notifications"]) {
    await c.query(`DELETE FROM ${table} WHERE ticket_id = ANY($1::bigint[])`, list);
  }
  await c.query("UPDATE tickets SET merged_into_id = NULL, parent_id = NULL WHERE id = ANY($1::bigint[])", list);
  await c.query("DELETE FROM tickets WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, ids]);
}

async function deleteContacts(c, orgId, ids) {
  if (!ids.length) return;
  await c.query("UPDATE tickets SET contact_id = NULL WHERE contact_id = ANY($1::bigint[])", [ids]);
  await c.query("UPDATE devices SET contact_id = NULL WHERE contact_id = ANY($1::bigint[])", [ids]);
  await c.query("DELETE FROM contacts WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, ids]);
}

async function deleteCustomers(c, orgId, ids) {
  if (!ids.length) return [];
  const busy = await c.query(
    `SELECT DISTINCT c.id FROM customers c
     WHERE c.id = ANY($1::bigint[]) AND (
       EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.id)
       OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id)
       OR EXISTS (SELECT 1 FROM devices d JOIN sites s ON s.id = d.site_id WHERE s.customer_id = c.id))`,
    [ids],
  );
  const kept = new Set(busy.rows.map((row) => Number(row.id)));
  const free = ids.filter((id) => !kept.has(Number(id)));
  if (free.length) {
    await c.query("UPDATE enroll_tokens SET customer_id = NULL WHERE customer_id = ANY($1::bigint[])", [free]);
    await c.query("DELETE FROM device_daily_stats WHERE customer_id = ANY($1::bigint[])", [free]);
    await c.query("DELETE FROM sites WHERE org_id = $1 AND customer_id = ANY($2::bigint[])", [orgId, free]);
    await c.query("DELETE FROM customers WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, free]);
  }
  return [...kept];
}

async function beginJob(client, requestId) {
  await client.query("BEGIN");
  await client.query("SELECT set_config('df.migration', $1, true)", [String(requestId)]);
}

async function removeFiles(keys) {
  for (const key of keys) await rm(join(ATTACHMENT_DIR, key), { force: true }).catch(() => {});
}

async function repointMesh(h, nodeIds, orgId) {
  if (!nodeIds.length) return { moved: 0, failed: 0 };
  let moved = 0;
  let failed = 0;
  try {
    const org = await h.ensureTenantMesh(orgId);
    for (const nodeId of nodeIds) {
      const out = await h.meshControl(["MoveToDeviceGroup", "--devid", nodeId, "--id", org.mesh_group_id]).catch(() => "");
      if (h.meshOk(out)) moved += 1;
      else failed += 1;
    }
  } catch {
    failed = nodeIds.length - moved;
  }
  return { moved, failed };
}

// ---------- Running ----------

async function runRequest(row, h) {
  const claimed = await pool.query(
    `UPDATE migration_requests SET status = 'running', started_at = now(), progress = '{"phase":"checking"}'::jsonb, updated_at = now()
     WHERE id = $1 AND status IN ('approved', 'scheduled') RETURNING *`,
    [row.id],
  );
  const request = claimed.rows[0];
  if (!request) return;
  const back = (status) => pool.query("UPDATE migration_requests SET status = $2, progress = '{}'::jsonb, updated_at = now() WHERE id = $1", [request.id, status]);

  const summary = approvalSummary(await liveApprovals(pool, request.id), request.requested_by);
  if (!summary.complete) {
    await back("pending");
    await logEvent(pool, request, "approvals_missing");
    return;
  }

  const input = {
    sourceId: Number(request.source_tenant_id),
    targetId: Number(request.target_tenant_id),
    mode: request.mode,
    scope: request.scope,
    resolutions: request.resolutions,
    acknowledged: request.acknowledged,
  };
  const { plan, names } = await dryRun(pool, input);

  const deviceIds = Object.entries(plan.selection.devices).filter(([, action]) => action === "move" || action === "rename").map(([id]) => Number(id));
  if (deviceIds.length) {
    const live = await pool.query(
      `SELECT count(*)::int AS n FROM remote_sessions
       WHERE device_id = ANY($1::bigint[]) AND (status = 'live' OR (status = 'launched' AND started_at > now() - interval '15 minutes'))`,
      [deviceIds],
    );
    if (live.rows[0].n > 0) {
      await back(request.schedule_at ? "scheduled" : "approved");
      if (!request.wait_warned_at || Date.now() - new Date(request.wait_warned_at).getTime() > WAIT_WARN_MS) {
        await pool.query("UPDATE migration_requests SET wait_warned_at = now() WHERE id = $1", [request.id]);
        await logEvent(pool, request, "waiting_sessions", null, { sessions: live.rows[0].n });
      }
      return;
    }
  }

  if (!plan.ready || significantChange(request.dry_run_snapshot, plan)) {
    await pool.query(
      `UPDATE migration_requests SET status = 'pending', submitted_at = now(), dry_run_snapshot = $2::jsonb, progress = '{}'::jsonb, updated_at = now()
       WHERE id = $1`,
      [request.id, JSON.stringify(planSummary(plan))],
    );
    await pool.query("UPDATE migration_approvals SET cleared_at = now() WHERE request_id = $1 AND cleared_at IS NULL", [request.id]);
    await logEvent(pool, request, "changed_since_approval", null, { counts: plan.counts });
    await notifyParties(request, {
      who: "approvers",
      title: "Migration needs approval again",
      lines: ["The data changed a lot since the request was approved, so it did not run. Check the new dry run and approve it again."],
    });
    return;
  }

  await logEvent(pool, request, "started", null, { counts: plan.counts });
  await notifyParties(request, { title: "Migration started", lines: ["The migration has started. You will get another message when it finishes."] });

  const client = await pool.connect();
  const run = new Run(client, request, plan, names);
  try {
    await beginJob(client, request.id);
    if (request.scope.settings) await run.settings();
    await run.customers();
    await run.contacts();
    if (request.mode === "move") await run.devices();
    await run.tickets();
    await run.activity();
    if (request.mode === "move") await run.lockSource();
    const result = { done: run.done, warnings: run.warnings, users: plan.users };
    await client.query(
      `UPDATE migration_requests SET status = 'completed', completed_at = now(), result = $2::jsonb,
              progress = $3::jsonb, updated_at = now() WHERE id = $1`,
      [request.id, JSON.stringify(result), JSON.stringify({ phase: "done", done: run.done, totals: plan.counts })],
    );
    await logEvent(client, request, "completed", null, { done: run.done, warnings: run.warnings.length });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await removeFiles(run.files);
    const message = String(error.message || "failed").slice(0, 300);
    console.error(`migration ${request.id}: ${message}`);
    await pool.query(
      "UPDATE migration_requests SET status = 'failed', result = $2::jsonb, updated_at = now() WHERE id = $1",
      [request.id, JSON.stringify({ error: "The migration stopped and nothing was changed.", detail: message })],
    );
    await logEvent(pool, request, "failed", null, { error: message });
    await notifyParties(request, { title: "Migration failed", lines: ["The migration stopped with an error. Nothing was changed in either tenant."] });
    return;
  } finally {
    client.release();
  }
  const mesh = await repointMesh(h, run.movedDevices, request.target_tenant_id);
  if (run.movedDevices.length) await logEvent(pool, request, "devices_repointed", null, mesh);
  await notifyParties(request, {
    title: "Migration completed",
    lines: [
      `The migration finished: ${run.done.customers || 0} customers, ${run.done.contacts || 0} contacts, ${run.done.tickets || 0} tickets and ${run.done.devices || 0} devices.`,
      request.mode === "move" ? `The original records stay read-only in ${names.source} for ${ROLLBACK_DAYS} days, then they are removed.` : "",
    ].filter(Boolean),
  });
}

async function mapRows(db, requestId, type) {
  const rows = await db.query("SELECT source_id, target_id, merged, detail FROM migration_id_map WHERE request_id = $1 AND entity_type = $2", [requestId, type]);
  return rows.rows.map((row) => ({ source: Number(row.source_id), target: Number(row.target_id), merged: row.merged, detail: row.detail }));
}

async function runRollback(request, h) {
  const claimed = await pool.query(
    `UPDATE migration_requests SET status = 'running', progress = '{"phase":"rollback"}'::jsonb, updated_at = now()
     WHERE id = $1 AND status = 'completed' AND rollback_approved_at IS NOT NULL AND rolled_back_at IS NULL RETURNING *`,
    [request.id],
  );
  const row = claimed.rows[0];
  if (!row) return;
  const src = Number(row.source_tenant_id);
  const dst = Number(row.target_tenant_id);
  const client = await pool.connect();
  const removed = [];
  const copied = [];
  const meshBack = [];
  const kept = {};
  try {
    await beginJob(client, row.id);
    const maps = {};
    for (const type of ["customer", "site", "contact", "device", "ticket", "sla_plan", "desk_category", "desk_tag", "desk_canned_reply", "desk_holiday"]) {
      maps[type] = await mapRows(client, row.id, type);
    }
    const created = (type) => maps[type].filter((item) => !item.merged).map((item) => item.target);
    const reverse = (type) => new Map(maps[type].map((item) => [item.target, item.source]));
    const since = row.completed_at;

    // After a Copy the target's own new work stays; its customers are kept wherever it still hangs off them.
    const move = row.mode === "move";
    const newTickets = move ? (await client.query(
      `SELECT id FROM tickets WHERE org_id = $1 AND created_at > $2 AND customer_id = ANY($3::bigint[]) AND NOT (id = ANY($4::bigint[]))`,
      [dst, since, created("customer"), created("ticket")],
    )).rows.map((item) => Number(item.id)) : [];
    const newContacts = move ? (await client.query(
      `SELECT * FROM contacts WHERE org_id = $1 AND created_at > $2 AND customer_id = ANY($3::bigint[]) AND NOT (id = ANY($4::bigint[]))`,
      [dst, since, created("customer"), created("contact")],
    )).rows : [];

    const keptTickets = new Map();
    const keptComments = new Map();
    if (move && row.rollback_keep) {
      const ticketBack = reverse("ticket");
      const customerBack = reverse("customer");
      const contactBack = reverse("contact");
      for (const contact of newContacts) {
        const customerId = customerBack.get(Number(contact.customer_id));
        if (!customerId) continue;
        const made = await client.query(
          "INSERT INTO contacts (org_id, customer_id, name, email, phone, alt_phone, job_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
          [src, customerId, contact.name, contact.email, contact.phone, contact.alt_phone, contact.job_title, contact.created_at],
        );
        contactBack.set(Number(contact.id), Number(made.rows[0].id));
        kept.contacts = (kept.contacts || 0) + 1;
      }
      const comments = await client.query(
        `SELECT tc.*, u.name AS author_name FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.author_user_id
         WHERE tc.org_id = $1 AND tc.created_at > $2 AND tc.ticket_id = ANY($3::bigint[]) ORDER BY tc.id`,
        [dst, since, created("ticket")],
      );
      for (const comment of comments.rows) {
        const made = await client.query(
          "INSERT INTO ticket_comments (org_id, ticket_id, author_label, body, kind, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [src, ticketBack.get(Number(comment.ticket_id)), comment.author_label || comment.author_name, comment.body, comment.kind, comment.created_at],
        );
        keptComments.set(Number(comment.id), Number(made.rows[0].id));
        kept.comments = (kept.comments || 0) + 1;
      }
      const time = await client.query(
        `SELECT te.*, u.name AS user_name FROM ticket_time_entries te LEFT JOIN users u ON u.id = te.user_id
         WHERE te.org_id = $1 AND te.created_at > $2 AND te.ticket_id = ANY($3::bigint[])`,
        [dst, since, created("ticket")],
      );
      for (const entry of time.rows) {
        await client.query(
          "INSERT INTO ticket_time_entries (org_id, ticket_id, minutes, billable, note, source, started_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [src, ticketBack.get(Number(entry.ticket_id)), entry.minutes, entry.billable,
            entry.user_name ? `${entry.user_name}${entry.note ? `: ${entry.note}` : ""}` : entry.note, entry.source, entry.started_at, entry.created_at],
        );
        kept.timeEntries = (kept.timeEntries || 0) + 1;
      }
      const changed = await client.query(
        "SELECT id, status, priority FROM tickets WHERE org_id = $1 AND updated_at > $2 AND id = ANY($3::bigint[])",
        [dst, since, created("ticket")],
      );
      for (const ticket of changed.rows) {
        await client.query("UPDATE tickets SET status = $3, priority = $4 WHERE id = $1 AND org_id = $2", [ticketBack.get(Number(ticket.id)), src, ticket.status, ticket.priority]);
        kept.tickets = (kept.tickets || 0) + 1;
      }
      const deviceBack = new Map(maps.device.map((item) => [item.target, item.merged ? null : item.source]));
      await copyTickets(client, {
        from: dst,
        to: src,
        ids: newTickets,
        maps: { customer: customerBack, contact: contactBack, device: deviceBack, ticket: keptTickets, comment: keptComments },
        record: null,
        files: copied,
        warnings: [],
        marker: { kind: "migrated", label: "Migration rollback", detail: (item) => ({ from: Number(item.id), rollback: true, requestId: Number(row.id) }) },
        counter: (key, n) => { if (key === "tickets") kept.newTickets = (kept.newTickets || 0) + n; },
      });
    }

    const own = (type) => new Map(maps[type].filter((item) => !item.merged).map((item) => [item.target, item.source]));
    await rollbackActivity(client, {
      src, dst, requestId: row.id, move, keep: Boolean(row.rollback_keep),
      customers: own("customer"),
      devices: maps.device.filter((item) => !item.merged).map((item) => item.source),
      tickets: new Map([...reverse("ticket"), ...keptTickets]),
      contacts: own("contact"),
      comments: keptComments,
    });

    await deleteTickets(client, dst, [...created("ticket"), ...newTickets], removed);

    const devices = maps.device.filter((item) => !item.merged);
    if (devices.length) {
      const ids = devices.map((item) => item.source);
      const ticketBack = reverse("ticket");
      for (const device of devices) {
        const current = (await client.query("SELECT mesh_node_id FROM devices WHERE id = $1 AND org_id = $2", [device.source, dst])).rows[0];
        if (!current) continue;
        await client.query(
          "UPDATE devices SET org_id = $3, site_id = $4, contact_id = $5, display_name = $6 WHERE id = $1 AND org_id = $2",
          [device.source, dst, src, device.detail?.siteId ?? null, device.detail?.contactId ?? null, device.detail?.displayName],
        );
        if (current.mesh_node_id) meshBack.push(current.mesh_node_id);
      }
      await moveDeviceRows(client, ids, dst, src);
      await relinkDeviceRows(client, ids, src, ticketBack, reverse("customer"));
    }

    await deleteContacts(client, dst, [...created("contact"), ...newContacts.map((item) => Number(item.id))]);
    await client.query("UPDATE devices SET site_id = NULL WHERE org_id = $1 AND site_id = ANY($2::bigint[])", [dst, created("site")]);
    await client.query("DELETE FROM sites WHERE org_id = $1 AND id = ANY($2::bigint[])", [dst, created("site")]);
    const leftover = await deleteCustomers(client, dst, created("customer"));
    await client.query("UPDATE customers SET sla_plan_id = NULL WHERE org_id = $1 AND sla_plan_id = ANY($2::bigint[])", [dst, created("sla_plan")]);
    await client.query("DELETE FROM sla_plans WHERE org_id = $1 AND id = ANY($2::bigint[])", [dst, created("sla_plan")]);
    for (const [type, table] of [["desk_category", "desk_categories"], ["desk_tag", "desk_tags"], ["desk_canned_reply", "desk_canned_replies"], ["desk_holiday", "desk_holidays"]]) {
      await client.query(`DELETE FROM ${table} WHERE org_id = $1 AND id = ANY($2::bigint[])`, [dst, created(type)]);
    }
    for (const table of ["customers", "contacts", "tickets"]) {
      await client.query(`UPDATE ${table} SET migration_lock = NULL WHERE org_id = $1 AND migration_lock = $2`, [src, row.id]);
    }
    await client.query(
      `UPDATE migration_requests SET status = 'rolled_back', rolled_back_at = now(), progress = '{"phase":"rolled_back"}'::jsonb, updated_at = now()
       WHERE id = $1`,
      [row.id],
    );
    await logEvent(client, row, "rolled_back", row.rollback_approved_by, { kept, customersLeftInTarget: leftover.length });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await removeFiles(copied);
    const message = String(error.message || "failed").slice(0, 300);
    console.error(`migration rollback ${row.id}: ${message}`);
    await pool.query("UPDATE migration_requests SET status = 'completed', progress = '{}'::jsonb, rollback_approved_at = NULL, rollback_approved_by = NULL, updated_at = now() WHERE id = $1", [row.id]);
    await logEvent(pool, row, "rollback_failed", null, { error: message });
    return;
  } finally {
    client.release();
  }
  await removeFiles(removed);
  const mesh = await repointMesh(h, meshBack, src);
  if (meshBack.length) await logEvent(pool, row, "devices_repointed", null, { ...mesh, rollback: true });
  await notifyParties(row, { title: "Migration rolled back", lines: ["The migration was rolled back. The source tenant's records are editable again and the copies in the target were removed."] });
}

async function runPurge(request) {
  const client = await pool.connect();
  const removed = [];
  try {
    await beginJob(client, request.id);
    const src = Number(request.source_tenant_id);
    const ids = async (table) => (await client.query(`SELECT id FROM ${table} WHERE org_id = $1 AND migration_lock = $2`, [src, request.id])).rows.map((row) => Number(row.id));
    const tickets = await ids("tickets");
    await deleteTickets(client, src, tickets, removed);
    const contacts = await ids("contacts");
    await deleteContacts(client, src, contacts);
    const customers = await ids("customers");
    const leftover = await deleteCustomers(client, src, customers);
    if (leftover.length) await client.query("UPDATE customers SET migration_lock = NULL WHERE id = ANY($1::bigint[])", [leftover]);
    const gone = customers.filter((id) => !leftover.includes(id));
    if (gone.length) await client.query("DELETE FROM activity_events WHERE org_id = $1 AND customer_id = ANY($2::bigint[])", [src, gone]);
    await client.query("UPDATE migration_requests SET purged_at = now(), updated_at = now() WHERE id = $1", [request.id]);
    await logEvent(client, request, "purged", null, { tickets: tickets.length, contacts: contacts.length, customers: customers.length - leftover.length, customersKept: leftover.length });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`migration purge ${request.id}: ${error.message}`);
    return;
  } finally {
    client.release();
  }
  await removeFiles(removed);
}

let tickRunning = false;

export async function migrationTick(h) {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const expired = await pool.query(
      `UPDATE migration_requests SET status = 'expired', updated_at = now()
       WHERE status = 'pending' AND submitted_at < now() - make_interval(days => $1) RETURNING *`,
      [EXPIRY_DAYS],
    );
    for (const request of expired.rows) {
      await logEvent(pool, request, "expired");
      await notifyParties(request, { title: "Migration request expired", lines: [`Nobody decided within ${EXPIRY_DAYS} days, so the request expired.`] });
    }
    const due = await pool.query(
      `SELECT * FROM migration_requests
       WHERE status IN ('approved', 'scheduled') AND (schedule_at IS NULL OR schedule_at <= now())
       ORDER BY id LIMIT 1`,
    );
    if (due.rows[0]) await runRequest(due.rows[0], h);
    const rollbacks = await pool.query(
      "SELECT * FROM migration_requests WHERE status = 'completed' AND rollback_approved_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY id LIMIT 1",
    );
    if (rollbacks.rows[0]) await runRollback(rollbacks.rows[0], h);
    const purges = await pool.query(
      `SELECT * FROM migration_requests WHERE status = 'completed' AND mode = 'move' AND purged_at IS NULL AND rollback_requested_at IS NULL
         AND completed_at < now() - make_interval(days => $1) ORDER BY id LIMIT 1`,
      [ROLLBACK_DAYS],
    );
    if (purges.rows[0] && purgeDue(purges.rows[0])) await runPurge(purges.rows[0]);
  } catch (error) {
    console.error(`migration tick: ${error.message}`);
  } finally {
    tickRunning = false;
  }
}

// A restart mid-run rolls the transaction back, so a 'running' row at startup changed nothing.
export async function recoverMigrations() {
  const stuck = await pool.query(
    `UPDATE migration_requests SET status = CASE WHEN rollback_approved_at IS NOT NULL AND completed_at IS NOT NULL THEN 'completed' ELSE 'failed' END,
            rollback_approved_at = CASE WHEN completed_at IS NOT NULL THEN NULL ELSE rollback_approved_at END,
            result = CASE WHEN completed_at IS NULL THEN '{"error":"The API restarted during the run. Nothing was changed."}'::jsonb ELSE result END,
            progress = '{}'::jsonb, updated_at = now()
     WHERE status = 'running' RETURNING *`,
  );
  for (const request of stuck.rows) await logEvent(pool, request, "interrupted");
}

// ---------- Counts for the console ----------

export async function platformWaiting(actorId) {
  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM migration_requests m
     WHERE m.status = 'pending' AND m.requested_by <> $1
       AND NOT EXISTS (SELECT 1 FROM migration_approvals a WHERE a.request_id = m.id AND a.role = 'platform_admin' AND a.cleared_at IS NULL)`,
    [actorId],
  );
  const rollbacks = await pool.query(
    "SELECT count(*)::int AS n FROM migration_requests WHERE status = 'completed' AND rollback_requested_at IS NOT NULL AND rollback_approved_at IS NULL AND rollback_requested_by <> $1",
    [actorId],
  );
  return rows.rows[0].n + rollbacks.rows[0].n;
}

export async function tenantWaiting(actor) {
  if (!actor?.org_id || actor.is_platform_admin || actor.impersonating) return 0;
  if (!(actor.roles || []).some((role) => role === "owner" || role === "admin")) return 0;
  const pending = await pool.query(
    "SELECT * FROM migration_requests WHERE status = 'pending' AND (source_tenant_id = $1 OR target_tenant_id = $1)",
    [actor.org_id],
  );
  if (!pending.rows.length) return 0;
  const approvers = (await tenantApprovers(pool, actor.org_id)).map((row) => row.id);
  let waiting = 0;
  for (const request of pending.rows) {
    const approvals = await liveApprovals(pool, request.id);
    const roles = eligibleRoles({
      user: { id: actor.id, isPlatformAdmin: false },
      request,
      sourceApprovers: Number(request.source_tenant_id) === Number(actor.org_id) ? approvers : [],
      targetApprovers: Number(request.target_tenant_id) === Number(actor.org_id) ? approvers : [],
      approvals,
    });
    if (roles.length) waiting += 1;
  }
  return waiting;
}

// ---------- Routes ----------

async function readReason(h, req) {
  const body = await h.readJson(req);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  return { body, reason };
}

async function detail(actor, row, { tenantView = false } = {}) {
  const approvals = await liveApprovals(pool, row.id);
  const [sourceApprovers, targetApprovers] = await Promise.all([
    tenantApprovers(pool, row.source_tenant_id),
    tenantApprovers(pool, row.target_tenant_id),
  ]);
  const myRoles = row.status === "pending"
    ? eligibleRoles({
      user: { id: actor.id, isPlatformAdmin: actor.is_platform_admin === true, impersonating: Boolean(actor.impersonating) },
      request: row,
      sourceApprovers: sourceApprovers.map((item) => item.id),
      targetApprovers: targetApprovers.map((item) => item.id),
      approvals,
    })
    : [];
  const view = { ...requestView(row), approvals: approvalsView(approvals, { names: !tenantView }), myRoles };
  if (tenantView) {
    const mine = Number(row.source_tenant_id) === Number(actor.org_id) ? "source" : "target";
    view.side = mine;
    view.requestedBy = { name: "Digital Fingers platform team" };
    const snapshot = row.dry_run_snapshot || {};
    view.dryRun = {
      counts: snapshot.counts || {},
      conflicts: (snapshot.conflicts || []).length,
      blocked: (snapshot.blocked || []).map((item) => item.label),
      ticketNumbers: { count: snapshot.ticketNumbers?.count || 0, note: snapshot.ticketNumbers?.note || "" },
    };
    view.resolutions = undefined;
    view.consent = `Your customers' data will be transferred to ${row.target_name}.`;
    return view;
  }
  const events = await pool.query(
    `SELECT e.id, e.kind, e.detail, e.created_at, u.name AS actor_name FROM migration_events e LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.request_id = $1 ORDER BY e.id DESC LIMIT 200`,
    [row.id],
  );
  view.events = events.rows.map((item) => ({ id: Number(item.id), kind: item.kind, detail: item.detail, at: item.created_at, actor: item.actor_name || null }));
  view.approvers = {
    source: sourceApprovers.map((item) => ({ name: item.name, role: item.role })),
    target: targetApprovers.map((item) => ({ name: item.name, role: item.role })),
  };
  view.targetChanges = await targetChanges(pool, row);
  view.canRollback = rollbackOpen(row) && !row.rollback_requested_at;
  view.canApproveRollback = Boolean(row.rollback_requested_at && !row.rollback_approved_at && Number(row.rollback_requested_by) !== Number(actor.id));
  view.canEdit = ["pending", "approved", "scheduled"].includes(row.status);
  return view;
}

async function listRequests({ tab, tenantId }) {
  const statuses = MIGRATION_TABS[tab] || null;
  const where = [];
  const params = [];
  if (statuses) {
    params.push(statuses);
    where.push(`m.status = ANY($${params.length}::text[])`);
  }
  if (tenantId) {
    params.push(tenantId);
    where.push(`(m.source_tenant_id = $${params.length} OR m.target_tenant_id = $${params.length})`);
  }
  const rows = await pool.query(`${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.id DESC LIMIT 200`, params);
  return rows.rows.map(requestView);
}

async function tabCounts(tenantId) {
  const rows = await pool.query(
    `SELECT status, count(*)::int AS n FROM migration_requests ${tenantId ? "WHERE source_tenant_id = $1 OR target_tenant_id = $1" : ""} GROUP BY status`,
    tenantId ? [tenantId] : [],
  );
  const byStatus = Object.fromEntries(rows.rows.map((row) => [row.status, row.n]));
  return Object.fromEntries(Object.entries(MIGRATION_TABS).map(([tab, statuses]) => [tab, statuses.reduce((total, status) => total + (byStatus[status] || 0), 0)]));
}

export async function handleMigrations(req, res, url, actor, h) {
  const { send } = h;
  const path = url.pathname;

  if (path.startsWith("/v1/platform/migrations")) {
    if (!h.requirePlatform(actor, res)) return true;

    if (req.method === "GET" && path === "/v1/platform/migrations") {
      const tab = Object.hasOwn(MIGRATION_TABS, url.searchParams.get("tab") || "") ? url.searchParams.get("tab") : null;
      const tenantId = Number(url.searchParams.get("tenant")) || null;
      const [items, counts, waiting] = await Promise.all([listRequests({ tab, tenantId }), tabCounts(tenantId), platformWaiting(actor.id)]);
      send(res, 200, { items, counts, waiting });
      return true;
    }

    if (req.method === "GET" && path === "/v1/platform/migrations/waiting") {
      send(res, 200, { waiting: await platformWaiting(actor.id) });
      return true;
    }

    if (req.method === "GET" && path === "/v1/platform/migrations/options") {
      const tenants = await pool.query("SELECT o.id, o.name FROM orgs o ORDER BY lower(o.name)");
      const list = [];
      for (const row of tenants.rows) {
        const license = await loadLicense(pool, row.id);
        list.push({ id: Number(row.id), name: row.name, active: Boolean(license?.entitlements.active) });
      }
      const sourceId = Number(url.searchParams.get("source")) || null;
      const customers = sourceId
        ? (await pool.query("SELECT id, name FROM customers WHERE org_id = $1 AND migration_lock IS NULL ORDER BY lower(name)", [sourceId])).rows
          .map((row) => ({ id: Number(row.id), name: row.name }))
        : [];
      send(res, 200, { tenants: list, customers });
      return true;
    }

    if (req.method === "POST" && path === "/v1/platform/migrations/dry-run") {
      const parsed = parseRequestInput(await h.readJson(req));
      if (parsed.error) return send(res, 400, { error: parsed.error }), true;
      const { plan, names } = await dryRun(pool, parsed.value);
      send(res, 200, { plan: planSummary(plan), names });
      return true;
    }

    if (req.method === "POST" && path === "/v1/platform/migrations") {
      const parsed = parseRequestInput(await h.readJson(req));
      if (parsed.error) return send(res, 400, { error: parsed.error }), true;
      const input = parsed.value;
      const { plan } = await dryRun(pool, input);
      if (!plan.ready) return send(res, 400, { error: "The dry run has problems to fix first.", plan: planSummary(plan) }), true;
      const made = await pool.query(
        `INSERT INTO migration_requests (source_tenant_id, target_tenant_id, scope, mode, resolutions, acknowledged, schedule_at, status, requested_by, dry_run_snapshot)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, 'pending', $8, $9::jsonb) RETURNING *`,
        [input.sourceId, input.targetId, JSON.stringify(input.scope), input.mode, JSON.stringify(input.resolutions), input.acknowledged,
          input.scheduleAt, actor.id, JSON.stringify(planSummary(plan))],
      );
      const request = made.rows[0];
      await logEvent(pool, request, "submitted", actor.id, { mode: input.mode, scope: input.scope, counts: plan.counts, scheduleAt: input.scheduleAt });
      await notifyParties(request, {
        who: "approvers",
        title: "Migration request awaiting your approval",
        lines: ["A platform admin asked to migrate data between your tenants. Open the request to see what moves, then approve or decline it.", `It expires in ${EXPIRY_DAYS} days.`],
      });
      send(res, 201, { id: Number(request.id) });
      return true;
    }

    const match = path.match(/^\/v1\/platform\/migrations\/(\d+)(?:\/([a-z-]+))?$/);
    if (!match) return false;
    const id = Number(match[1]);
    const action = match[2] || null;
    const row = await loadRequest(pool, id);
    if (!row) return send(res, 404, { error: "Migration request not found." }), true;

    if (req.method === "GET" && !action) {
      send(res, 200, await detail(actor, row));
      return true;
    }

    if (req.method === "PUT" && !action) {
      if (!["pending", "approved", "scheduled"].includes(row.status)) return send(res, 409, { error: "This request can no longer be changed." }), true;
      const body = await h.readJson(req);
      const parsed = parseRequestInput({ ...body, sourceId: row.source_tenant_id, targetId: row.target_tenant_id });
      if (parsed.error) return send(res, 400, { error: parsed.error }), true;
      const input = parsed.value;
      const { plan } = await dryRun(pool, input);
      if (!plan.ready) return send(res, 400, { error: "The dry run has problems to fix first.", plan: planSummary(plan) }), true;
      const before = requestFingerprint({ scope: row.scope, mode: row.mode, scheduleAt: row.schedule_at, resolutions: row.resolutions, acknowledged: row.acknowledged });
      const after = requestFingerprint(input);
      if (before === after) return send(res, 200, { id, changed: false }), true;
      await pool.query(
        `UPDATE migration_requests SET scope = $2::jsonb, mode = $3, resolutions = $4::jsonb, acknowledged = $5, schedule_at = $6,
                dry_run_snapshot = $7::jsonb, status = 'pending', submitted_at = now(), updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(input.scope), input.mode, JSON.stringify(input.resolutions), input.acknowledged, input.scheduleAt, JSON.stringify(planSummary(plan))],
      );
      const cleared = await pool.query("UPDATE migration_approvals SET cleared_at = now() WHERE request_id = $1 AND cleared_at IS NULL RETURNING id", [id]);
      await logEvent(pool, row, "edited", actor.id, { mode: input.mode, scope: input.scope, scheduleAt: input.scheduleAt, approvalsCleared: cleared.rows.length });
      await notifyParties(row, {
        who: "approvers",
        title: "Migration request changed",
        lines: ["The migration request was changed, so earlier approvals no longer count. Check it again and approve or decline."],
      });
      send(res, 200, { id, changed: true, approvalsCleared: cleared.rows.length });
      return true;
    }

    if (req.method !== "POST") return false;

    if (action === "approve" || action === "decline") {
      const { reason } = await readReason(h, req);
      const outcome = await decide(actor, id, action === "approve" ? "approved" : "declined", reason, "platform");
      send(res, 200, { ok: true, outcome });
      return true;
    }

    if (action === "cancel") {
      const updated = await pool.query(
        "UPDATE migration_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('pending', 'approved', 'scheduled', 'draft') RETURNING *",
        [id],
      );
      if (!updated.rows[0]) return send(res, 409, { error: "Only a request that has not run yet can be cancelled." }), true;
      await logEvent(pool, row, "cancelled", actor.id);
      await notifyParties(row, { title: "Migration cancelled", lines: ["The platform team cancelled the migration request. Nothing was changed."] });
      send(res, 200, { ok: true });
      return true;
    }

    if (action === "rollback") {
      if (!rollbackOpen(row)) return send(res, 409, { error: "This migration can no longer be rolled back." }), true;
      if (row.rollback_requested_at) return send(res, 409, { error: "A rollback is already waiting for approval." }), true;
      const body = await h.readJson(req);
      const keep = body.keepChanges === true;
      await pool.query(
        "UPDATE migration_requests SET rollback_requested_by = $2, rollback_requested_at = now(), rollback_keep = $3, updated_at = now() WHERE id = $1",
        [id, actor.id, keep],
      );
      await logEvent(pool, row, "rollback_requested", actor.id, { keepChanges: keep });
      send(res, 200, { ok: true });
      return true;
    }

    if (action === "rollback-approve") {
      if (!row.rollback_requested_at || row.rollback_approved_at) return send(res, 409, { error: "No rollback is waiting for approval." }), true;
      if (Number(row.rollback_requested_by) === Number(actor.id)) return send(res, 403, { error: "A different platform admin has to approve the rollback." }), true;
      if (!rollbackOpen(row)) return send(res, 409, { error: "This migration can no longer be rolled back." }), true;
      await pool.query("UPDATE migration_requests SET rollback_approved_by = $2, rollback_approved_at = now(), updated_at = now() WHERE id = $1", [id, actor.id]);
      await logEvent(pool, row, "rollback_approved", actor.id);
      send(res, 200, { ok: true });
      return true;
    }

    if (action === "rollback-cancel") {
      if (!row.rollback_requested_at || row.rollback_approved_at) return send(res, 409, { error: "No rollback is waiting." }), true;
      await pool.query(
        "UPDATE migration_requests SET rollback_requested_by = NULL, rollback_requested_at = NULL, rollback_keep = NULL, updated_at = now() WHERE id = $1",
        [id],
      );
      await logEvent(pool, row, "rollback_cancelled", actor.id);
      send(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  if (path === "/v1/migrations" || path.startsWith("/v1/migrations/")) {
    if (!actor) return send(res, 401, { error: "Login required." }), true;
    if (actor.is_platform_admin || !actor.org_id) return send(res, 404, { error: "Not found." }), true;

    if (req.method === "GET" && path === "/v1/migrations") {
      const rows = await pool.query(
        `${REQUEST_SELECT} WHERE (m.source_tenant_id = $1 OR m.target_tenant_id = $1) AND m.status <> 'draft' ORDER BY m.id DESC LIMIT 100`,
        [actor.org_id],
      );
      const items = [];
      for (const row of rows.rows) {
        const view = await detail(actor, row, { tenantView: true });
        items.push({ id: view.id, source: view.source, target: view.target, mode: view.mode, status: view.status, submittedAt: view.submittedAt, expiresAt: view.expiresAt, side: view.side, waitingForMe: view.myRoles.length > 0 });
      }
      send(res, 200, { items, canDecide: (await tenantApprovers(pool, actor.org_id)).some((item) => item.id === Number(actor.id)) });
      return true;
    }

    const match = path.match(/^\/v1\/migrations\/(\d+)(?:\/(approve|decline))?$/);
    if (!match) return false;
    const row = await loadRequest(pool, Number(match[1]));
    if (!row || ![Number(row.source_tenant_id), Number(row.target_tenant_id)].includes(Number(actor.org_id))) {
      return send(res, 404, { error: "Migration request not found." }), true;
    }
    if (req.method === "GET" && !match[2]) {
      send(res, 200, await detail(actor, row, { tenantView: true }));
      return true;
    }
    if (req.method === "POST" && match[2]) {
      const { reason } = await readReason(h, req);
      const outcome = await decide(actor, row.id, match[2] === "approve" ? "approved" : "declined", reason, "tenant");
      send(res, 200, { ok: true, outcome });
      return true;
    }
    return false;
  }

  return false;
}
