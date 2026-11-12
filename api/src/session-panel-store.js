// Database reads and writes for the customer-side Session Panel. Every query is scoped by the tenant (org) and, for
// the technician's session window, by the technician too, so one tenant can never see or steer another's session.

// The session a device's panel should show: the newest one not ended by the customer, while its session window is
// still checking in (or, before the first check-in, while it was launched in the last 12 hours).
export const PANEL_SESSION_SQL = `
  SELECT rs.id, rs.started_at, rs.paused_at, rs.tsid, rs.ticket_id, t.subject AS ticket_subject,
         u.name AS technician_name, o.name AS org_name,
         ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = rs.user_id) AS technician_roles
  FROM remote_sessions rs
  JOIN orgs o ON o.id = rs.org_id
  LEFT JOIN users u ON u.id = rs.user_id
  LEFT JOIN tickets t ON t.id = rs.ticket_id AND t.org_id = rs.org_id
  WHERE rs.device_id = $1 AND rs.org_id = $2 AND rs.ended_by IS NULL AND rs.status <> 'untracked'
    AND (rs.shell_seen_at > now() - interval '45 seconds'
         OR (rs.shell_seen_at IS NULL AND rs.status IN ('launched', 'live') AND rs.started_at > now() - interval '12 hours'))
  ORDER BY rs.id DESC
  LIMIT 1`;

export async function livePanelSession(db, deviceId, orgId) {
  return (await db.query(PANEL_SESSION_SQL, [deviceId, orgId])).rows[0] || null;
}

// A session the device's panel may pause, resume or end: it must belong to that device in that tenant.
export async function deviceSession(db, sessionId, deviceId, orgId) {
  const found = await db.query(
    `SELECT id, ticket_id, paused_at FROM remote_sessions
     WHERE id = $1 AND device_id = $2 AND org_id = $3 AND ended_by IS NULL`,
    [sessionId, deviceId, orgId],
  );
  return found.rows[0] || null;
}

// The technician's session window checking in. Only the technician's own session in their own tenant is touched.
export async function pingSession(db, { deviceId, orgId, userId, tsid = null, closed = false }) {
  const found = await db.query(
    `SELECT rs.id, rs.paused_at, rs.ended_by, d.support_panel
     FROM remote_sessions rs
     JOIN devices d ON d.id = rs.device_id AND d.org_id = rs.org_id
     WHERE rs.device_id = $1 AND rs.org_id = $2 AND rs.user_id = $3 AND rs.status <> 'untracked'
       AND rs.started_at > now() - interval '12 hours'
     ORDER BY rs.id DESC
     LIMIT 1`,
    [deviceId, orgId, userId],
  );
  const row = found.rows[0];
  if (!row) return { tracked: false };
  if (row.ended_by === "customer") return { tracked: true, endedBy: "customer" };
  if (closed) {
    await db.query("UPDATE remote_sessions SET shell_seen_at = now() - interval '1 hour' WHERE id = $1", [row.id]);
    return { tracked: true };
  }
  await db.query(
    `UPDATE remote_sessions
     SET shell_seen_at = now(), tsid = COALESCE($2, tsid),
         status = CASE WHEN status = 'ended' THEN 'live' ELSE status END,
         ended_at = CASE WHEN status = 'ended' THEN NULL ELSE ended_at END
     WHERE id = $1 AND ended_by IS NULL`,
    [row.id, tsid],
  );
  return { tracked: true, paused: row.paused_at != null, panel: row.support_panel?.state || null };
}
