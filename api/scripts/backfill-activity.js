// Fills the customer and device timeline from history recorded before it existed. Safe to run again: every row
// has a source key, so rows already copied are skipped. Customers are matched by where devices are now.
import { activityFromAudit, activityFromTicketEvent, recordActivity, ticketActor } from "../src/activity.js";
import { pool } from "../src/db.js";

const BATCH = 500;

async function each(sql, handle, db = pool) {
  let after = 0;
  let count = 0;
  for (;;) {
    const rows = (await db.query(sql, [after, BATCH])).rows;
    if (!rows.length) return count;
    for (const row of rows) {
      await handle(row);
      count += 1;
    }
    after = rows[rows.length - 1].id;
  }
}

const audits = await each(
  `SELECT id, org_id, actor_user_id, action, target_type, target_id, detail, created_at FROM audit_events
   WHERE id > $1 AND org_id IS NOT NULL ORDER BY id LIMIT $2`,
  async (row) => {
    const event = activityFromAudit({
      action: row.action, targetType: row.target_type, targetId: row.target_id, detail: row.detail, actorId: row.actor_user_id,
    });
    if (event) await recordActivity(pool, row.org_id, { ...event, source: "audit", sourceId: row.id, at: row.created_at });
  },
);

// The retired ticket_events table, copied whole: the ticket page reads its history from the timeline now. Runs as a
// migration job so tickets locked by a tenant migration keep their history too, and so earlier copies can be fixed.
const client = await pool.connect();
let tickets = 0;
let filled = 0;
let mergeCopies = 0;
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('df.migration', 'activity-backfill', true)");
  tickets = await each(
    `SELECT id, org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at FROM ticket_events
     WHERE id > $1 ORDER BY id LIMIT $2`,
    async (row) => {
      await recordActivity(client, row.org_id, {
        ...activityFromTicketEvent(row.kind, row.detail),
        ticketId: Number(row.ticket_id),
        ...ticketActor(row.kind, row.actor_user_id, row.actor_label),
        source: "ticket_event",
        sourceId: row.id,
        at: row.created_at,
      });
    },
    client,
  );
  filled = (await client.query(
    `UPDATE activity_events a SET payload = te.detail
     FROM ticket_events te
     WHERE a.source = 'ticket_event' AND a.source_id = te.id::text AND a.payload = '{}'::jsonb AND te.detail <> '{}'::jsonb`,
  )).rowCount;
  // A merge used to copy the merged ticket's history onto the kept ticket; the ticket page now reads it in place.
  mergeCopies = (await client.query("DELETE FROM activity_events WHERE source = 'ticket_event' AND payload ? 'mergedFrom'")).rowCount;
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}

const jobs = await each(
  `SELECT j.id, j.org_id, j.device_id, j.ticket_id, j.kind, j.exit_code, j.finished_at, d.hostname FROM jobs j
   JOIN devices d ON d.id = j.device_id
   WHERE j.id > $1 AND j.status = 'finished' AND j.finished_at IS NOT NULL ORDER BY j.id LIMIT $2`,
  async (row) => {
    const script = row.kind === "script";
    await recordActivity(pool, row.org_id, {
      type: script ? "script.finished" : "command.finished",
      group: "commands",
      summary: `${script ? "script" : "command"} ${row.exit_code === 0 ? "finished" : "failed"} with exit code ${row.exit_code}`,
      actorType: "system",
      actorLabel: row.hostname || "Device agent",
      deviceId: Number(row.device_id),
      ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
      payload: { jobId: Number(row.id), exitCode: row.exit_code },
      source: "job_result",
      sourceId: row.id,
      at: row.finished_at,
    });
  },
);

const total = await pool.query("SELECT count(*)::int AS n, count(customer_id)::int AS linked FROM activity_events");
console.log(`read ${audits} audit rows, ${tickets} ticket events, ${jobs} finished jobs`);
console.log(`filled in the detail of ${filled} ticket events, removed ${mergeCopies} copies made by merges`);
console.log(`timeline now has ${total.rows[0].n} events, ${total.rows[0].linked} linked to a customer`);
await pool.end();
