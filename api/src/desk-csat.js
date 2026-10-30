import { pool } from "./db.js";
import { csatValid, RATINGS } from "./csat.js";

async function ratedTicket(ticketId, signature, key) {
  const found = await pool.query(
    `SELECT t.id, t.org_id, t.subject, o.name AS org_name, r.rating, r.comment
     FROM tickets t
     JOIN orgs o ON o.id = t.org_id
     LEFT JOIN ticket_ratings r ON r.ticket_id = t.id
     WHERE t.id = $1`,
    [ticketId],
  );
  const row = found.rows[0];
  if (!row || !csatValid(key, row.org_id, row.id, signature)) return null;
  return row;
}

// Public: the signed link in the resolved email is the only credential.
// h: { send, readJson, writeAudit, ticketEvent, csatKey }.
export async function handleCsat(req, res, url, h) {
  const match = url.pathname.match(/^\/v1\/public\/csat\/(\d{1,12})$/);
  if (!match) return false;
  const ticketId = Number(match[1]);
  if (req.method === "GET") {
    const row = await ratedTicket(ticketId, url.searchParams.get("s"), h.csatKey());
    if (!row) return h.send(res, 404, { error: "This rating link is not valid." }), true;
    h.send(res, 200, { orgName: row.org_name, subject: row.subject, rating: row.rating || null, comment: row.comment || "" });
    return true;
  }
  if (req.method !== "POST") return false;
  const body = await h.readJson(req);
  const row = await ratedTicket(ticketId, body.s, h.csatKey());
  if (!row) return h.send(res, 404, { error: "This rating link is not valid." }), true;
  if (!RATINGS.includes(body.rating)) return h.send(res, 400, { error: "Choose Good, OK or Bad." }), true;
  const hasComment = typeof body.comment === "string";
  const comment = hasComment ? body.comment.trim().slice(0, 1000) : null;
  const saved = await pool.query(
    `INSERT INTO ticket_ratings (ticket_id, org_id, rating, comment) VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticket_id) DO UPDATE SET rating = EXCLUDED.rating,
       comment = CASE WHEN $5::boolean THEN EXCLUDED.comment ELSE ticket_ratings.comment END, updated_at = now()
     RETURNING (xmax = 0) AS created`,
    [ticketId, row.org_id, body.rating, comment || null, hasComment],
  );
  const changed = saved.rows[0].created || row.rating !== body.rating || (hasComment && (comment || "") !== (row.comment || ""));
  if (changed) {
    await h.ticketEvent(row.org_id, ticketId, "csat", {
      label: "Customer",
      detail: { rating: body.rating, ...(comment ? { note: comment } : {}) },
    });
    await h.writeAudit(row.org_id, null, "ticket.csat", "ticket", String(ticketId), { rating: body.rating, comment: Boolean(comment) });
  }
  h.send(res, 200, { ok: true, rating: body.rating });
  return true;
}
