import { pool } from "./db.js";
import { happiness } from "./csat.js";

const ZONE = "Africa/Johannesburg";

function minutes(value) {
  return value == null ? null : Math.round(Number(value));
}

async function overview(orgId, customerId) {
  const [counts, volume, times, ratings] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'open')::int AS open,
              count(*) FILTER (WHERE status = 'pending')::int AS on_hold
       FROM tickets WHERE customer_id = $1 AND org_id = $2 AND merged_into_id IS NULL`,
      [customerId, orgId],
    ),
    pool.query(
      `WITH months AS (
         SELECT m AS local_month, (m AT TIME ZONE $3) AS starts, ((m + interval '1 month') AT TIME ZONE $3) AS ends
         FROM generate_series(date_trunc('month', now() AT TIME ZONE $3) - interval '5 months',
                              date_trunc('month', now() AT TIME ZONE $3), interval '1 month') AS m
       )
       SELECT to_char(local_month, 'YYYY-MM') AS month,
              (SELECT count(*) FROM tickets t
               WHERE t.customer_id = $1 AND t.org_id = $2 AND t.merged_into_id IS NULL
                 AND t.created_at >= months.starts AND t.created_at < months.ends)::int AS created,
              (SELECT count(DISTINCT e.ticket_id) FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
               WHERE t.customer_id = $1 AND e.org_id = $2 AND e.kind = 'status' AND e.detail->>'to' = 'resolved'
                 AND e.created_at >= months.starts AND e.created_at < months.ends)::int AS resolved
       FROM months ORDER BY local_month`,
      [customerId, orgId, ZONE],
    ),
    pool.query(
      `WITH t AS (
         SELECT id, created_at FROM tickets
         WHERE customer_id = $1 AND org_id = $2 AND merged_into_id IS NULL AND created_at > now() - interval '6 months'
       ),
       first_reply AS (
         SELECT e.ticket_id, min(e.created_at) AS at FROM ticket_events e JOIN t ON t.id = e.ticket_id
         WHERE e.kind = 'reply' AND e.actor_user_id IS NOT NULL AND e.created_at > t.created_at
         GROUP BY e.ticket_id
       ),
       first_resolve AS (
         SELECT e.ticket_id, min(e.created_at) AS at FROM ticket_events e JOIN t ON t.id = e.ticket_id
         WHERE e.kind = 'status' AND e.detail->>'to' = 'resolved'
         GROUP BY e.ticket_id
       ),
       asks AS (
         SELECT c.ticket_id, c.created_at AS asked,
                (SELECT min(a.created_at) FROM ticket_events a
                 WHERE a.ticket_id = c.ticket_id AND a.kind = 'reply' AND a.actor_user_id IS NOT NULL AND a.created_at > c.created_at) AS answered
         FROM ticket_events c JOIN t ON t.id = c.ticket_id
         WHERE c.kind = 'created' OR (c.kind = 'reply' AND c.actor_user_id IS NULL)
       )
       SELECT (SELECT avg(extract(epoch FROM fr.at - t.created_at) / 60) FROM t JOIN first_reply fr ON fr.ticket_id = t.id) AS first_response,
              (SELECT avg(extract(epoch FROM answered - asked) / 60) FROM asks WHERE answered IS NOT NULL) AS response,
              (SELECT avg(extract(epoch FROM rs.at - t.created_at) / 60) FROM t JOIN first_resolve rs ON rs.ticket_id = t.id) AS resolution`,
      [customerId, orgId],
    ),
    pool.query(
      `SELECT r.rating, count(*)::int AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
       WHERE t.customer_id = $1 AND r.org_id = $2 GROUP BY r.rating`,
      [customerId, orgId],
    ),
  ]);
  const ratingCounts = Object.fromEntries(ratings.rows.map((row) => [row.rating, row.n]));
  return {
    total: counts.rows[0].total,
    open: counts.rows[0].open,
    onHold: counts.rows[0].on_hold,
    happiness: happiness(ratingCounts),
    volume: volume.rows.map((row) => ({ month: row.month, created: row.created, resolved: row.resolved })),
    averages: {
      firstResponseMinutes: minutes(times.rows[0].first_response),
      responseMinutes: minutes(times.rows[0].response),
      resolutionMinutes: minutes(times.rows[0].resolution),
    },
  };
}

const HISTORY_KINDS = ["created", "status", "merged", "csat", "parent"];

async function history(orgId, customerId) {
  const rows = await pool.query(
    `SELECT * FROM (
       SELECT 'ticket' AS source, e.kind AS action, e.created_at, e.detail, e.ticket_id, t.subject,
              COALESCE(u.name, e.actor_label, 'System') AS actor
       FROM ticket_events e
       JOIN tickets t ON t.id = e.ticket_id
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE t.customer_id = $1 AND e.org_id = $2 AND e.kind = ANY($3::text[])
       UNION ALL
       SELECT 'audit', a.action, a.created_at, a.detail, NULL, NULL, COALESCE(u.name, 'System')
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.org_id = $2 AND (
         (a.target_type = 'customer' AND a.target_id = $1::text)
         OR (a.target_type = 'contact' AND (a.detail->>'accountId' = $1::text
             OR a.target_id IN (SELECT id::text FROM contacts WHERE customer_id = $1)))
         OR (a.target_type = 'device' AND a.action IN ('device.link', 'device.unlink') AND a.detail->>'customerId' = $1::text)
       )
     ) x
     ORDER BY created_at DESC
     LIMIT 100`,
    [customerId, orgId, HISTORY_KINDS],
  );
  return rows.rows.map((row) => ({
    source: row.source,
    action: row.action,
    at: row.created_at,
    actor: row.actor,
    ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
    subject: row.subject || null,
    from: row.detail?.from ?? null,
    to: row.detail?.to ?? null,
    rating: row.detail?.rating ?? null,
    name: row.detail?.name ?? null,
  }));
}

async function attachments(orgId, customerId) {
  const rows = await pool.query(
    `SELECT a.id, a.file_name, a.content_type, a.is_image, a.size_bytes, a.created_at, a.ticket_id, t.subject,
            COALESCE(u.name, tc.author_label, 'Customer') AS uploader
     FROM ticket_attachments a
     JOIN tickets t ON t.id = a.ticket_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     LEFT JOIN ticket_comments tc ON tc.id = a.comment_id
     WHERE t.customer_id = $1 AND a.org_id = $2 AND a.linked_at IS NOT NULL
     ORDER BY a.created_at DESC
     LIMIT 200`,
    [customerId, orgId],
  );
  return rows.rows.map((row) => ({
    id: Number(row.id),
    name: row.file_name,
    isImage: row.is_image,
    size: row.size_bytes,
    createdAt: row.created_at,
    ticketId: Number(row.ticket_id),
    ticketSubject: row.subject,
    uploader: row.uploader,
  }));
}

async function deskDevices(orgId, customerId) {
  const rows = await pool.query(
    `SELECT d.id, d.hostname, d.display_name, d.os_name, d.last_seen_at, ct.name AS contact_name,
            (SELECT count(*)::int FROM tickets t WHERE t.device_id = d.id AND t.org_id = d.org_id AND t.merged_into_id IS NULL AND t.status <> 'resolved') AS open_tickets
     FROM devices d
     JOIN sites s ON s.id = d.site_id
     LEFT JOIN contacts ct ON ct.id = d.contact_id
     WHERE s.customer_id = $1 AND d.org_id = $2
     ORDER BY lower(COALESCE(d.display_name, d.hostname))`,
    [customerId, orgId],
  );
  return rows.rows.map((row) => ({
    id: Number(row.id),
    hostname: row.hostname,
    displayName: row.display_name || row.hostname,
    osName: row.os_name || null,
    lastSeenAt: row.last_seen_at,
    contactName: row.contact_name || null,
    openTickets: row.open_tickets,
  }));
}

async function ratings(orgId, customerId) {
  const rows = await pool.query(
    `SELECT r.ticket_id, r.rating, r.comment, r.updated_at, t.subject
     FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id
     WHERE t.customer_id = $1 AND r.org_id = $2
     ORDER BY r.updated_at DESC LIMIT 20`,
    [customerId, orgId],
  );
  return rows.rows.map((row) => ({
    ticketId: Number(row.ticket_id),
    subject: row.subject,
    rating: row.rating,
    comment: row.comment || null,
    at: row.updated_at,
  }));
}

// Extra Service Desk tabs on the customer page. Devices only when the tenant also has Remote Desk.
export async function customerInsights(orgId, customerId, { devices = false } = {}) {
  const [over, past, files, kit, rated] = await Promise.all([
    overview(orgId, customerId),
    history(orgId, customerId),
    attachments(orgId, customerId),
    devices ? deskDevices(orgId, customerId) : null,
    ratings(orgId, customerId),
  ]);
  return { overview: over, history: past, attachments: files, ratings: rated, ...(kit ? { deskDevices: kit } : {}) };
}
