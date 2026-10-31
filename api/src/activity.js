// The customer and device timeline: one append-only store that every feature writes to.

// Which app a group belongs to decides who sees it: core is always shown, the others need the app in the package.
export const ACTIVITY_GROUPS = {
  tickets: { app: "servicedesk", label: "Tickets" },
  time: { app: "servicedesk", label: "Time" },
  remote: { app: "remote", label: "Remote sessions" },
  commands: { app: "remote", label: "Commands and scripts" },
  alerts: { app: "remote", label: "Alerts" },
  patches: { app: "remote", label: "Patches" },
  agent: { app: "remote", label: "Agent" },
  devices: { app: "remote", label: "Device changes" },
  customer: { app: "core", label: "Customer and contacts" },
};

const STATUS_WORDS = { open: "Open", pending: "Pending", resolved: "Resolved" };
const status = (value) => STATUS_WORDS[value] || value || "none";
const minutes = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  if (total < 60) return `${total} min`;
  return total % 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total / 60} h`;
};
const clip = (value, max = 160) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Ticket kinds that other events already record on the customer and device timeline (with the ticket linked).
// They are stored for the ticket's own timeline and left out of the wider feeds.
export const TICKET_ONLY_TYPES = ["ticket.command", "ticket.command_result", "ticket.remote_start", "ticket.remote_end"];

const TICKET_LINES = {
  created: () => "created the ticket",
  reply: (d) => (d.email ? "replied by email" : "replied"),
  note: () => "added a note",
  status: (d) => `changed the status from ${status(d.from)} to ${status(d.to)}`,
  priority: (d) => `changed the priority from ${d.from || "none"} to ${d.to}`,
  assignee: (d) => (d.to ? `assigned the ticket to ${d.to}` : "unassigned the ticket"),
  contact: (d) => (d.to ? `set the contact to ${d.to}` : "removed the contact"),
  device: (d) => (d.to ? `set the affected device to ${d.to}` : "removed the affected device"),
  category: (d) => (d.to ? `set the category to ${d.to}` : "cleared the category"),
  tags: () => "updated the tags",
  due: (d) => (d.to ? "set a due date" : "cleared the due date"),
  channel: (d) => `set the channel to ${d.to}`,
  cc: () => "changed who is copied",
  csat: (d) => `rated the support ${d.rating}`,
  merged: (d) => `merged the ticket into #${d.into}`,
  merged_from: (d) => `merged ${(d.tickets || []).map((id) => `#${id}`).join(", ")} into the ticket`,
  parent: (d) => (d.to ? `linked the ticket under #${d.to}` : "removed the parent ticket"),
  sla_breach: (d) => `breached the ${d.target === "response" ? "response" : "resolve"} SLA`,
  sla_warning: (d) => `is close to the ${d.target === "response" ? "response" : "resolve"} SLA`,
  email: () => "emailed the customer",
  automation: (d) => `ran the "${d.rule}" automation`,
  migrated: () => "moved the ticket from another organisation",
  time: (d) => `logged ${minutes(d.minutes)}${d.billable === false ? " (not billable)" : ""}`,
  time_removed: (d) => `removed ${minutes(d.minutes)} of logged time`,
  remote_start: (d) => `started a remote session${d.user ? ` as ${d.user}` : ""}`,
  remote_end: (d) => (d.minutes ? `remote session ended after ${minutes(d.minutes)}` : "remote session ended"),
  command: (d) => `ran a command${d.command ? `: ${clip(d.command, 120)}` : ""}`,
  command_result: (d) => `command finished with exit code ${d.exitCode ?? "?"}`,
};

// The ticket timeline lives in the same store: the event keeps the ticket's own detail as its payload.
export function activityFromTicketEvent(kind, detail = {}) {
  const line = TICKET_LINES[kind];
  const group = kind === "time" || kind === "time_removed" ? "time" : "tickets";
  return {
    type: `ticket.${kind}`,
    group,
    summary: line ? line(detail || {}) : `ticket ${kind.replace(/_/g, " ")}`,
    payload: detail || {},
  };
}

// Who a ticket event is shown as: the user, an automation, or the system part that wrote it (such as "Alert monitor").
export function ticketActor(kind, actorId, label) {
  if (actorId != null) return { actorType: "user", actorId: Number(actorId), actorLabel: null };
  const automated = kind === "automation" || /automation|auto-close/i.test(String(label || ""));
  return { actorType: automated ? "automation" : "system", actorId: null, actorLabel: label || null };
}

// Audit actions that belong on a timeline, with how to describe them. ticket.* is left out: ticket events cover it.
const AUDIT_EVENTS = {
  "customer.create": { group: "customer", line: (d) => `added the customer${d.name ? ` ${d.name}` : ""}` },
  "customer.update": { group: "customer", line: () => "updated the customer details" },
  "customer.notes": { group: "customer", line: () => "updated the notes" },
  "customer.sla": { group: "customer", line: () => "updated the SLA and contract" },
  "customer.contact": { group: "customer", line: (d) => `set the primary contact${d.contactName ? ` to ${d.contactName}` : ""}` },
  "contact.create": { group: "customer", line: (d) => `added the contact ${d.name || ""}`.trim() },
  "contact.update": { group: "customer", line: (d) => `updated the contact ${d.name || ""}`.trim() },
  "contact.delete": { group: "customer", line: (d) => `removed the contact ${d.name || ""}`.trim() },
  "device.enroll": { group: "agent", type: "agent.installed", line: (d) => `installed the agent${d.hostname ? ` on ${d.hostname}` : ""}` },
  "device.remote_agent_missing": { group: "agent", type: "agent.remote_missing", line: () => "reported the remote support agent missing" },
  "device.remote_agent_blocked": { group: "agent", type: "agent.remote_blocked", line: () => "reported the remote support agent blocked by antivirus" },
  "device.remote_agent_stopped": { group: "agent", type: "agent.remote_stopped", line: () => "reported the remote support agent stopped" },
  "device.remote_agent_ok": { group: "agent", type: "agent.remote_ok", line: () => "reported the remote support agent running again" },
  "device.rename": { group: "devices", line: (d) => (d.name ? `renamed the device to ${d.name}` : "renamed the device") },
  "device.link": { group: "devices", line: () => "linked the device to this customer" },
  "device.unlink": { group: "devices", line: () => "unlinked the device from this customer" },
  "device.assign": { group: "devices", line: () => "changed who the device is assigned to" },
  "device.site": { group: "devices", line: (d) => (d.site ? `set the site to ${d.site}` : "cleared the site") },
  "remote.launch": { group: "remote", type: "remote.started", line: (d) => `started a remote session${d.user ? ` as ${d.user}` : ""}` },
  "remote.resume": { group: "remote", type: "remote.resumed", line: () => "reconnected the remote session after a restart" },
  "remote.end": { group: "remote", type: "remote.ended", line: () => "ended the remote session" },
  "support.start": { group: "remote", line: () => "started a quick support session" },
  "support.join": { group: "remote", line: (d) => `joined a quick support session${d.hostname ? ` on ${d.hostname}` : ""}` },
  "support.end": { group: "remote", line: () => "ended the quick support session" },
  "job.create": {
    group: "commands",
    type: (d) => (d.kind === "script" ? "script.run" : "command.run"),
    line: (d) => (d.kind === "script" ? `ran a PowerShell script (${d.length || "?"} characters)` : `ran a command${d.command ? `: ${clip(d.command, 120)}` : ""}`),
  },
  "terminal.open": { group: "commands", line: () => "opened a terminal" },
  "power.request": { group: "devices", line: (d) => `asked the device to ${d.action || "change power state"}` },
  "service.set": { group: "devices", line: (d) => `changed the service ${d.name || ""}`.trim() },
  "process.end": { group: "devices", line: (d) => `ended the process ${d.name || ""}`.trim() },
  "startup.set": { group: "devices", line: (d) => `changed the startup item ${d.name || ""}`.trim() },
  "file.upload": { group: "devices", line: (d) => `uploaded ${d.name || "a file"}` },
  "file.download": { group: "devices", line: (d) => `downloaded ${d.name || "a file"}` },
  "alert.fire": { group: "alerts", type: "alert.raised", line: (d) => `raised a ${METRIC_WORDS[d.metric] || "usage"} alert at ${d.value}% (limit ${d.threshold}%)` },
  "patch.push": { group: "patches", line: (d) => `queued ${d.count ? `${d.count} update${d.count === 1 ? "" : "s"}` : "updates"} to install` },
  "patch.deploy": {
    group: "patches",
    type: (d) => (d.status === "succeeded" ? "patch.installed" : "patch.failed"),
    line: (d) => `${d.status === "succeeded" ? "installed" : "failed to install"} ${d.packageName || "an update"}${d.status === "succeeded" && d.restartRequired ? " (restart needed)" : ""}`,
  },
  "patch.restart": { group: "patches", line: () => "restarted the device to finish updates" },
  "agent.update.request": { group: "agent", line: (d) => (d.to ? `asked the agent to update to ${d.to}` : "asked the agent to update") },
};

const METRIC_WORDS = { cpu: "CPU", memory: "memory", disk: "disk" };

// Turns one audit entry into a timeline event, or null when it does not belong on a timeline.
export function activityFromAudit({ action, targetType, targetId, detail = {}, actorId = null }) {
  const spec = AUDIT_EVENTS[action];
  if (!spec) return null;
  const d = detail || {};
  const event = {
    type: typeof spec.type === "function" ? spec.type(d) : spec.type || action,
    group: spec.group,
    summary: clip(spec.line(d), 240),
    actorType: actorId != null ? "user" : "system",
    actorId,
    actorLabel: null,
    customerId: null,
    deviceId: null,
    contactId: null,
    ticketId: d.ticketId != null && Number.isInteger(Number(d.ticketId)) ? Number(d.ticketId) : null,
    lookup: null,
    payload: {},
  };
  const id = Number(targetId);
  if (targetType === "customer") event.customerId = id;
  else if (targetType === "contact") event.contactId = id;
  else if (targetType === "device") event.deviceId = id;
  else if (["job", "alert", "patch_deploy", "support_session"].includes(targetType)) event.lookup = { table: targetType, id };
  if (d.deviceId != null && event.deviceId == null) event.deviceId = Number(d.deviceId);
  const customerRef = d.customerId ?? d.accountId;
  if (customerRef != null && event.customerId == null && Number.isInteger(Number(customerRef))) event.customerId = Number(customerRef);
  if (d.apiToken) {
    event.actorType = "api";
    event.actorLabel = `API token "${d.apiToken}"`;
  }
  if (targetType === "job") event.payload.jobId = id;
  if (targetType === "alert") event.payload.alertId = id;
  if (action === "job.create" && d.kind) event.payload.kind = d.kind;
  if (!Number.isInteger(id) && event.lookup) return null;
  return event;
}

const LOOKUP_SQL = {
  job: "SELECT device_id, ticket_id FROM jobs WHERE id = $1 AND org_id = $2",
  alert: "SELECT device_id, ticket_id FROM alerts WHERE id = $1 AND org_id = $2",
  patch_deploy: "SELECT device_id, NULL::bigint AS ticket_id FROM patch_deploys WHERE id = $1 AND org_id = $2",
  support_session: "SELECT NULL::bigint AS device_id, ticket_id FROM support_sessions WHERE id = $1 AND org_id = $2",
};

// Writes one event and returns its id (null when it was already recorded). The customer comes from the ticket, then
// the device's site, then the contact, and every id is checked against the organisation, so an event can never point
// into another tenant.
export async function recordActivity(db, orgId, event) {
  if (!event || orgId == null) return null;
  let { deviceId = null, ticketId = null } = event;
  if (event.lookup && LOOKUP_SQL[event.lookup.table]) {
    const found = await db.query(LOOKUP_SQL[event.lookup.table], [event.lookup.id, orgId]);
    if (found.rows[0]) {
      deviceId = deviceId ?? (found.rows[0].device_id == null ? null : Number(found.rows[0].device_id));
      ticketId = ticketId ?? (found.rows[0].ticket_id == null ? null : Number(found.rows[0].ticket_id));
    }
  }
  const app = ACTIVITY_GROUPS[event.group]?.app || "core";
  const saved = await db.query(
    `INSERT INTO activity_events (org_id, customer_id, device_id, ticket_id, contact_id, type, app, actor_type, actor_user_id,
                                  actor_label, summary, payload, source, source_id, created_at)
     SELECT $1, COALESCE(c.id, t.customer_id, s.customer_id, ct.customer_id), d.id, t.id, COALESCE(ct.id, t.contact_id),
            $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, COALESCE($15::timestamptz, now())
     FROM (SELECT 1) one
     LEFT JOIN customers c ON c.id = $2 AND c.org_id = $1
     LEFT JOIN tickets t ON t.id = $4 AND t.org_id = $1
     LEFT JOIN devices d ON d.id = COALESCE($3, t.device_id) AND d.org_id = $1
     LEFT JOIN sites s ON s.id = d.site_id
     LEFT JOIN contacts ct ON ct.id = $5 AND ct.org_id = $1
     ON CONFLICT (source, source_id) WHERE source IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      orgId,
      event.customerId ?? null,
      deviceId,
      ticketId,
      event.contactId ?? null,
      event.type,
      app,
      event.actorType || "system",
      event.actorType === "user" ? event.actorId ?? null : null,
      event.actorLabel ?? null,
      clip(event.summary, 240) || event.type,
      JSON.stringify(event.payload || {}),
      event.source ?? null,
      event.sourceId == null ? null : String(event.sourceId),
      event.at ?? null,
    ],
  );
  return saved.rows[0] ? Number(saved.rows[0].id) : null;
}

// Timeline writes never stop the action that caused them. On a client inside a transaction a savepoint keeps a
// failed write from aborting the transaction; outside one, SAVEPOINT just fails and the write goes ahead alone.
export async function recordActivitySafely(db, orgId, event) {
  if (!event) return;
  let savepoint = false;
  if (typeof db.release === "function") {
    try {
      await db.query("SAVEPOINT activity_write");
      savepoint = true;
    } catch {
      savepoint = false;
    }
  }
  try {
    await recordActivity(db, orgId, event);
    if (savepoint) await db.query("RELEASE SAVEPOINT activity_write");
  } catch (error) {
    if (savepoint) await db.query("ROLLBACK TO SAVEPOINT activity_write").catch(() => {});
    console.error(`activity: ${error.message}`);
  }
}

export const PAGE_SIZE = 50;

function cursorFrom(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)_(\d+)$/.exec(String(value || ""));
  return match ? { at: match[1], id: match[2] } : null;
}

export function cursorFor(row) {
  return `${new Date(row.created_at).toISOString()}_${row.id}`;
}

function dateFrom(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
}

// Builds the timeline query. org_id is always the first condition; the scope (customer or device) the second.
export function timelineQuery({ orgId, customerId = null, deviceId = null, apps = [], filters = {}, limit = PAGE_SIZE }) {
  if (orgId == null || (customerId == null && deviceId == null)) throw new Error("A timeline needs an organisation and a customer or device.");
  const values = [orgId];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = ["e.org_id = $1"];
  if (customerId != null) where.push(`e.customer_id = ${add(customerId)}`);
  if (deviceId != null) where.push(`e.device_id = ${add(deviceId)}`);
  const visible = ["core", ...apps.filter((app) => app === "remote" || app === "servicedesk")];
  where.push(`e.app = ANY(${add(visible)}::text[])`);
  where.push(`e.type <> ALL(${add(TICKET_ONLY_TYPES)}::text[])`);
  const groups = (Array.isArray(filters.groups) ? filters.groups : []).filter((group) => ACTIVITY_GROUPS[group]);
  if (groups.length) {
    const prefixes = groups.flatMap((group) => GROUP_TYPES[group]);
    where.push(`(${prefixes.map((prefix) => `e.type LIKE ${add(`${prefix}%`)}`).join(" OR ")})`);
  }
  if (filters.device != null && Number.isInteger(Number(filters.device))) where.push(`e.device_id = ${add(Number(filters.device))}`);
  if (filters.actor != null && Number.isInteger(Number(filters.actor))) where.push(`e.actor_user_id = ${add(Number(filters.actor))}`);
  const from = dateFrom(filters.from);
  const to = dateFrom(filters.to);
  if (from) where.push(`e.created_at >= ${add(from)}::date`);
  if (to) where.push(`e.created_at < ${add(to)}::date + 1`);
  const q = String(filters.q || "").trim().slice(0, 100);
  if (q) where.push(`e.summary ILIKE ${add(`%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)}`);
  const cursor = cursorFrom(filters.before);
  if (cursor) where.push(`(e.created_at, e.id) < (${add(cursor.at)}::timestamptz, ${add(cursor.id)}::bigint)`);
  const size = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 200);
  return {
    text: `SELECT e.id, e.type, e.app, e.actor_type, e.actor_label, e.summary, e.payload, e.created_at,
                  e.customer_id, e.device_id, e.ticket_id, e.contact_id, e.actor_user_id,
                  u.name AS actor_name, u.email AS actor_email,
                  COALESCE(d.display_name, d.hostname) AS device_name, t.subject AS ticket_subject, c.name AS customer_name
           FROM activity_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
           LEFT JOIN devices d ON d.id = e.device_id AND d.org_id = e.org_id
           LEFT JOIN tickets t ON t.id = e.ticket_id AND t.org_id = e.org_id
           LEFT JOIN customers c ON c.id = e.customer_id AND c.org_id = e.org_id
           WHERE ${where.join(" AND ")}
           ORDER BY e.created_at DESC, e.id DESC
           LIMIT ${size + 1}`,
    values,
    size,
  };
}

// One ticket's timeline, oldest first, in the shape the ticket page expects (kind and detail). Tickets merged into it,
// directly or through another merged ticket, add what happened to them before their merge, apart from their creation.
export function ticketTimelineQuery(orgId, ticketId) {
  if (orgId == null || ticketId == null) throw new Error("A ticket timeline needs an organisation and a ticket.");
  return {
    text: `WITH RECURSIVE family AS (
             SELECT id FROM tickets WHERE id = $2 AND org_id = $1
             UNION
             SELECT t.id FROM tickets t JOIN family f ON t.merged_into_id = f.id WHERE t.org_id = $1
           )
           SELECT e.id, substr(e.type, 8) AS kind, e.ticket_id, e.actor_user_id, e.actor_label, e.payload AS detail,
                  e.created_at, u.name AS actor_name
           FROM activity_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
           WHERE e.org_id = $1 AND e.ticket_id IN (SELECT id FROM family) AND e.type LIKE 'ticket.%'
             AND (e.ticket_id = $2 OR (e.type <> 'ticket.created' AND e.created_at < (
               SELECT min(m.created_at) FROM activity_events m
               WHERE m.org_id = $1 AND m.ticket_id = e.ticket_id AND m.type = 'ticket.merged')))
           ORDER BY e.created_at, e.id`,
    values: [orgId, ticketId],
  };
}

// The type prefixes in each group, for the type filter.
export const GROUP_TYPES = {
  tickets: ["ticket."],
  time: ["ticket.time"],
  remote: ["remote.", "support."],
  commands: ["command.", "script.", "terminal."],
  alerts: ["alert."],
  patches: ["patch."],
  agent: ["agent."],
  devices: ["device.", "power.", "service.", "process.", "startup.", "file."],
  customer: ["customer.", "contact."],
};

// The group an event type belongs to; time entries are checked before the wider ticket prefix.
export function groupOf(type) {
  const order = ["time", ...Object.keys(GROUP_TYPES).filter((key) => key !== "time")];
  return order.find((group) => GROUP_TYPES[group].some((prefix) => String(type).startsWith(prefix))) || "customer";
}

export function timelineView(rows, size) {
  const page = rows.slice(0, size);
  return {
    items: page.map((row) => ({
      id: Number(row.id),
      type: row.type,
      group: groupOf(row.type),
      at: row.created_at,
      actor: row.actor_type === "user" ? row.actor_name || row.actor_email || "Someone" : row.actor_label || (row.actor_type === "automation" ? "Automation" : "System"),
      actorType: row.actor_type,
      actorId: row.actor_user_id == null ? null : Number(row.actor_user_id),
      summary: row.summary,
      device: row.device_id == null ? null : { id: Number(row.device_id), name: row.device_name || null },
      ticket: row.ticket_id == null ? null : { id: Number(row.ticket_id), subject: row.ticket_subject || null },
      customer: row.customer_id == null ? null : { id: Number(row.customer_id), name: row.customer_name || null },
      payload: row.payload || {},
    })),
    next: rows.length > size ? cursorFor(page[page.length - 1]) : null,
  };
}
