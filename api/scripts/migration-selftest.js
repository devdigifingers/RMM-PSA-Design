// End-to-end check of tenant migration against a scratch database.
// Run: PGDATABASE=<name>_selftest ATTACHMENT_DIR=/tmp/<dir> node scripts/migration-selftest.js
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]) delete process.env[key];
if (!String(process.env.PGDATABASE || "").endsWith("_selftest")) {
  console.error("Refusing to run: PGDATABASE must end in _selftest.");
  process.exit(2);
}
if (!process.env.ATTACHMENT_DIR || !process.env.ATTACHMENT_DIR.startsWith("/tmp/")) {
  console.error("Refusing to run: ATTACHMENT_DIR must be under /tmp.");
  process.exit(2);
}

const { pool } = await import("../src/db.js");
const { migrationTick } = await import("../src/migrations.js");

const schema = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql"), "utf8");
await pool.query(schema);

const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const id = async (sql, params) => Number((await one(sql, params)).id);
const h = { ensureTenantMesh: async () => ({ mesh_group_id: "mesh//test" }), meshControl: async () => "", meshOk: () => true };

const suite = await one("SELECT id FROM packages WHERE code = 'SUITE'");
async function tenant(name) {
  const org = await id("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, name.toLowerCase().replace(/\W+/g, "-")]);
  await pool.query("INSERT INTO licenses (org_id, plan, package_id, no_expiry) VALUES ($1, 'standard', $2, true)", [org, suite.id]);
  for (const role of ["owner", "admin", "tech"]) await pool.query("INSERT INTO roles (org_id, name) VALUES ($1, $2)", [org, role]);
  const owner = await id("INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id", [org, `owner@${org}.test`, `${name} Owner`]);
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE org_id = $2 AND name = 'owner'", [owner, org]);
  return { org, owner };
}

async function seed(orgId, prefix, { withDevice = true } = {}) {
  const plan = await id("INSERT INTO sla_plans (org_id, name, response_minutes, resolve_minutes) VALUES ($1, 'Gold', 60, 480) RETURNING id", [orgId]);
  await pool.query("INSERT INTO desk_categories (org_id, name) VALUES ($1, 'Network'), ($1, $2)", [orgId, `${prefix} Printers`]);
  const customer = await id("INSERT INTO customers (org_id, name, email, sla_plan_id) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, `${prefix} Corp`, `info@${prefix}.test`, plan]);
  const shared = await id("INSERT INTO customers (org_id, name) VALUES ($1, 'Shared Name Ltd') RETURNING id", [orgId]);
  const site = await id("INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Main') RETURNING id", [orgId, customer]);
  await pool.query("INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Main')", [orgId, shared]);
  const contact = await id("INSERT INTO contacts (org_id, customer_id, name, email, is_primary) VALUES ($1, $2, 'Pat', $3, true) RETURNING id", [orgId, customer, `pat@${prefix}.test`]);
  await pool.query("INSERT INTO contacts (org_id, customer_id, name, email) VALUES ($1, $2, 'Sam', 'sam@shared.test')", [orgId, shared]);
  let device = null;
  if (withDevice) {
    device = await id("INSERT INTO devices (org_id, site_id, hostname, display_name, contact_id) VALUES ($1, $2, $3, $3, $4) RETURNING id", [orgId, site, `${prefix}-PC1`, contact]);
    await pool.query("INSERT INTO device_samples (org_id, device_id, cpu_percent) VALUES ($1, $2, 10), ($1, $2, 20)", [orgId, device]);
  }
  const tickets = [];
  for (const [subject, status] of [[`${prefix} printer`, "open"], [`${prefix} email`, "pending"], [`${prefix} old`, "resolved"]]) {
    const ticket = await id(
      "INSERT INTO tickets (org_id, customer_id, device_id, contact_id, subject, status, priority) VALUES ($1, $2, $3, $4, $5, $6, 'normal') RETURNING id",
      [orgId, customer, device, contact, subject, status],
    );
    const comment = await id("INSERT INTO ticket_comments (org_id, ticket_id, body) VALUES ($1, $2, 'Looking into it') RETURNING id", [orgId, ticket]);
    await pool.query(
      `INSERT INTO activity_events (org_id, customer_id, ticket_id, type, app, actor_type, summary, payload)
       VALUES ($1, $2, $3, 'ticket.created', 'servicedesk', 'system', 'created the ticket', '{}'),
              ($1, $2, $3, 'ticket.reply', 'servicedesk', 'system', 'replied', $4::jsonb)`,
      [orgId, customer, ticket, JSON.stringify({ commentId: comment })],
    );
    await pool.query("INSERT INTO ticket_time_entries (org_id, ticket_id, minutes) VALUES ($1, $2, 15)", [orgId, ticket]);
    tickets.push(ticket);
  }
  const key = `${orgId}/selftest-${prefix}`;
  await mkdir(dirname(join(process.env.ATTACHMENT_DIR, key)), { recursive: true });
  await writeFile(join(process.env.ATTACHMENT_DIR, key), "hello");
  await pool.query(
    "INSERT INTO ticket_attachments (org_id, ticket_id, file_name, content_type, size_bytes, storage_key, linked_at) VALUES ($1, $2, 'a.txt', 'text/plain', 5, $3, now())",
    [orgId, tickets[0], key],
  );
  await pool.query("UPDATE tickets SET parent_id = $2 WHERE id = $1", [tickets[1], tickets[0]]);
  return { customer, shared, contact, device, tickets, plan };
}

const TABLES = ["customers", "contacts", "sites", "devices", "device_samples", "tickets", "ticket_comments", "activity_events",
  "ticket_time_entries", "ticket_attachments", "sla_plans", "desk_categories"];

async function snapshot(orgId) {
  const out = {};
  for (const table of TABLES) {
    const rows = (await pool.query(`SELECT * FROM ${table} WHERE org_id = $1 ORDER BY id`, [orgId])).rows;
    out[table] = rows.map((row) => {
      const copy = { ...row };
      delete copy.updated_at;
      return copy;
    });
  }
  return JSON.parse(JSON.stringify(out));
}

async function approveAll(requestId, sourceOwner, targetOwner, admin) {
  for (const [role, user] of [["source_owner", sourceOwner], ["target_owner", targetOwner], ["platform_admin", admin]]) {
    await pool.query("INSERT INTO migration_approvals (request_id, role, user_id, decision) VALUES ($1, $2, $3, 'approved')", [requestId, role, user]);
  }
  await pool.query("UPDATE migration_requests SET status = 'approved' WHERE id = $1", [requestId]);
}

async function request(source, target, requester, { mode, scope, resolutions = {} }) {
  const { dryRun } = await import("../src/migrations.js");
  const { planSummary } = await import("../src/migration-plan.js");
  const { plan } = await dryRun(pool, { sourceId: source, targetId: target, mode, scope, resolutions, acknowledged: [] });
  assert.equal(plan.ready, true, `dry run not ready: ${JSON.stringify(plan.errors)} ${JSON.stringify(plan.blocked)}`);
  return id(
    `INSERT INTO migration_requests (source_tenant_id, target_tenant_id, scope, mode, resolutions, status, requested_by, dry_run_snapshot)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, 'pending', $6, $7::jsonb) RETURNING id`,
    [source, target, JSON.stringify(scope), mode, JSON.stringify(resolutions), requester, JSON.stringify(planSummary(plan))],
  );
}

const status = async (requestId) => (await one("SELECT status, result FROM migration_requests WHERE id = $1", [requestId]));

const A = await tenant("Alpha Source");
const B = await tenant("Beta Target");
const C = await tenant("Gamma Bystander");
const requester = await id("INSERT INTO users (email, name, password_hash, is_platform_admin, platform_role) VALUES ('admin1@df.test', 'Admin One', 'x', true, 'super') RETURNING id");
const second = await id("INSERT INTO users (email, name, password_hash, is_platform_admin, platform_role) VALUES ('admin2@df.test', 'Admin Two', 'x', true, 'super') RETURNING id");
const a = await seed(A.org, "alpha");
await seed(B.org, "beta", { withDevice: false });
await seed(C.org, "gamma");

const sourceBefore = await snapshot(A.org);
const targetBefore = await snapshot(B.org);
const bystanderBefore = await snapshot(C.org);

// Move with a merge (Shared Name Ltd), rename (sla plan "Gold") and the default contact merge.
const sharedSource = a.shared;
const goldSource = a.plan;
const moveId = await request(A.org, B.org, requester, {
  mode: "move",
  scope: { customers: true, tickets: true, devices: true, settings: true, users: false, customerIds: null },
  resolutions: { [`customer:${sharedSource}`]: "merge", [`sla_plan:${goldSource}`]: "rename" },
});
await migrationTick(h);
assert.equal((await status(moveId)).status, "pending", "a request without approvals must not run");
await approveAll(moveId, A.owner, B.owner, second);
await migrationTick(h);
const moved = await status(moveId);
assert.equal(moved.status, "completed", `move did not complete: ${JSON.stringify(moved.result)}`);

const targetAfter = await snapshot(B.org);
assert.equal(targetAfter.customers.length, targetBefore.customers.length + 1, "one new customer, one merged");
assert.ok(targetAfter.sla_plans.some((row) => row.name === "Gold (migrated)"), "renamed SLA plan");
assert.equal(targetAfter.tickets.length, targetBefore.tickets.length + 3);
assert.ok(targetAfter.activity_events.some((row) => row.type === "ticket.migrated" && row.payload.from === a.tickets[0]), "migrated marker");
const printerCopy = targetAfter.tickets.find((row) => row.subject === "alpha printer").id;
const copiedReply = targetAfter.activity_events.find((row) => row.type === "ticket.reply" && String(row.ticket_id) === String(printerCopy));
assert.ok(copiedReply, "ticket history copied with the ticket");
assert.equal(targetAfter.ticket_comments.find((row) => String(row.id) === String(copiedReply.payload.commentId))?.body, "Looking into it", "reply points at the copied comment");
assert.equal(targetAfter.devices.length, 1, "device moved");
assert.equal(targetAfter.device_samples.length, 2, "device history followed");
const copiedFile = targetAfter.ticket_attachments.find((row) => row.file_name === "a.txt" && !row.storage_key.includes("beta"));
assert.ok(copiedFile.storage_key.startsWith(`${B.org}/`), "attachment copied into target storage");
assert.equal(await readFile(join(process.env.ATTACHMENT_DIR, copiedFile.storage_key), "utf8"), "hello");
const newParent = targetAfter.tickets.find((row) => row.subject === "alpha email").parent_id;
assert.equal(targetAfter.tickets.find((row) => row.id === newParent).subject, "alpha printer", "parent link remapped");
const lockedRows = (await one("SELECT count(*)::int AS n FROM tickets WHERE org_id = $1 AND migration_lock = $2", [A.org, moveId])).n;
assert.equal(lockedRows, 3, "source tickets are read-only");
await assert.rejects(pool.query("UPDATE tickets SET subject = 'x' WHERE id = $1", [a.tickets[0]]), /DF_MIGRATION_LOCKED/);
await assert.rejects(pool.query("INSERT INTO ticket_comments (org_id, ticket_id, body) VALUES ($1, $2, 'x')", [A.org, a.tickets[0]]), /DF_MIGRATION_LOCKED/);
await assert.rejects(pool.query(
  "INSERT INTO activity_events (org_id, ticket_id, type, app, actor_type, summary) VALUES ($1, $2, 'ticket.note', 'servicedesk', 'system', 'x')",
  [A.org, a.tickets[0]],
), /DF_MIGRATION_LOCKED/);
assert.deepEqual(await snapshot(C.org), bystanderBefore, "bystander untouched after move");

// A change in the target after the move, kept by the rollback.
const targetTicket = targetAfter.tickets.find((row) => row.subject === "alpha printer").id;
await pool.query("INSERT INTO ticket_comments (org_id, ticket_id, body, created_at) VALUES ($1, $2, 'Fixed in target', now() + interval '1 second')", [B.org, targetTicket]);
await pool.query("UPDATE migration_requests SET rollback_requested_by = $2, rollback_requested_at = now(), rollback_keep = true, rollback_approved_by = $3, rollback_approved_at = now() WHERE id = $1", [moveId, requester, second]);
await migrationTick(h);
assert.equal((await status(moveId)).status, "rolled_back");

const sourceRestored = await snapshot(A.org);
const kept = sourceRestored.ticket_comments.filter((row) => row.body === "Fixed in target");
assert.equal(kept.length, 1, "kept change copied back");
sourceRestored.ticket_comments = sourceRestored.ticket_comments.filter((row) => row.body !== "Fixed in target");
assert.deepEqual(sourceRestored, sourceBefore, "source restored exactly");
assert.deepEqual(await snapshot(B.org), targetBefore, "target back to how it was");
assert.deepEqual(await snapshot(C.org), bystanderBefore, "bystander untouched after rollback");

// Copy one customer with a skip, then roll the copy back.
const copyId = await request(A.org, B.org, requester, {
  mode: "copy",
  scope: { customers: true, tickets: true, devices: false, settings: false, users: false, customerIds: [a.customer, sharedSource] },
  resolutions: { [`customer:${sharedSource}`]: "skip" },
});
await approveAll(copyId, A.owner, B.owner, second);
await migrationTick(h);
assert.equal((await status(copyId)).status, "completed");
const sourceAfterCopy = await snapshot(A.org);
sourceAfterCopy.ticket_comments = sourceAfterCopy.ticket_comments.filter((row) => row.body !== "Fixed in target");
assert.deepEqual(sourceAfterCopy, sourceBefore, "copy leaves the source alone");
const afterCopy = await snapshot(B.org);
assert.equal(afterCopy.customers.length, targetBefore.customers.length + 1, "skipped customer not copied");
assert.equal(afterCopy.contacts.filter((row) => row.email === "sam@shared.test").length, 1, "skipped customer's contact stayed behind");
await pool.query("UPDATE migration_requests SET rollback_requested_by = $2, rollback_requested_at = now(), rollback_keep = false, rollback_approved_by = $3, rollback_approved_at = now() WHERE id = $1", [copyId, requester, second]);
await migrationTick(h);
assert.equal((await status(copyId)).status, "rolled_back");
assert.deepEqual(await snapshot(B.org), targetBefore, "copy rollback removes the copies");
assert.deepEqual(await snapshot(C.org), bystanderBefore, "bystander untouched throughout");

const events = (await one("SELECT count(*)::int AS n FROM migration_events")).n;
await assert.rejects(pool.query("DELETE FROM migration_events"), /append-only/);
await assert.rejects(pool.query("DELETE FROM activity_events"), /append-only/);
await assert.rejects(pool.query("INSERT INTO ticket_events (org_id, ticket_id, kind) VALUES ($1, $2, 'note')", [A.org, a.tickets[0]]), /retired/);
console.log(`migration self-test passed (${events} migration events)`);
await pool.end();
