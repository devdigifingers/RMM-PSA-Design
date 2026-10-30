import { pool } from "./db.js";
import { sendMail } from "./mail.js";
import { consoleUrl } from "./invites.js";
import { DEFAULT_HOURS, PRIORITIES, parseHours, zaHolidays } from "./sla-engine.js";

export const NOTIFY_EVENTS = ["new_ticket", "assigned", "customer_reply", "sla_warning", "sla_breach"];
const STATUS_BASES = new Set(["open", "pending", "resolved"]);
const PRIORITY_DEFAULT_LABELS = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
// Until a tenant saves its own rules, only the platform MAIL_TO inbox gets email (the old behaviour).
const DEFAULT_RULES = {
  new_ticket: { email: true, inApp: true },
  assigned: { email: false, inApp: true },
  customer_reply: { email: false, inApp: true },
  sla_warning: { email: false, inApp: true },
  sla_breach: { email: true, inApp: true },
};
const EVENT_TITLES = {
  new_ticket: "New ticket",
  assigned: "Assigned to you",
  customer_reply: "Customer replied",
  sla_warning: "SLA due soon",
  sla_breach: "SLA breach",
};

function cleanName(value, max) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > max) return null;
  return name;
}

function uniqueError(error) {
  return error?.code === "23505";
}

export async function deskSetup(orgId) {
  const [statuses, priorities, categories, tags, hours, holidays, canned, rules] = await Promise.all([
    pool.query("SELECT id, name, base, position FROM desk_statuses WHERE org_id = $1 ORDER BY position, lower(name)", [orgId]),
    pool.query("SELECT priority, label FROM desk_priorities WHERE org_id = $1", [orgId]),
    pool.query("SELECT id, name FROM desk_categories WHERE org_id = $1 ORDER BY lower(name)", [orgId]),
    pool.query("SELECT id, name FROM desk_tags WHERE org_id = $1 ORDER BY lower(name)", [orgId]),
    pool.query("SELECT enabled, hours FROM desk_business_hours WHERE org_id = $1", [orgId]),
    pool.query("SELECT id, to_char(day, 'YYYY-MM-DD') AS day, name FROM desk_holidays WHERE org_id = $1 ORDER BY day", [orgId]),
    pool.query("SELECT id, title, body, updated_at FROM desk_canned_replies WHERE org_id = $1 ORDER BY lower(title)", [orgId]),
    pool.query("SELECT event, email, in_app FROM desk_notification_rules WHERE org_id = $1", [orgId]),
  ]);
  const labels = { ...PRIORITY_DEFAULT_LABELS };
  for (const row of priorities.rows) labels[row.priority] = row.label;
  const ruleMap = {};
  for (const event of NOTIFY_EVENTS) ruleMap[event] = { ...DEFAULT_RULES[event], custom: false };
  for (const row of rules.rows) ruleMap[row.event] = { email: row.email, inApp: row.in_app, custom: true };
  return {
    statuses: statuses.rows.map((row) => ({ id: Number(row.id), name: row.name, base: row.base, position: row.position })),
    priorityLabels: labels,
    categories: categories.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    tags: tags.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    businessHours: {
      enabled: Boolean(hours.rows[0]?.enabled),
      hours: hours.rows[0]?.hours || DEFAULT_HOURS,
    },
    holidays: holidays.rows.map((row) => ({ id: Number(row.id), day: row.day, name: row.name })),
    canned: canned.rows.map((row) => ({ id: Number(row.id), title: row.title, body: row.body, updatedAt: row.updated_at })),
    rules: ruleMap,
  };
}

async function notificationRule(orgId, event) {
  const row = await pool.query("SELECT email, in_app FROM desk_notification_rules WHERE org_id = $1 AND event = $2", [orgId, event]);
  if (!row.rows[0]) return { ...DEFAULT_RULES[event], custom: false };
  return { email: row.rows[0].email, inApp: row.rows[0].in_app, custom: true };
}

async function managerIds(orgId) {
  const rows = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.name IN ('owner', 'admin')
     WHERE u.org_id = $1 AND u.disabled_at IS NULL`,
    [orgId],
  );
  return rows.rows.map((row) => String(row.id));
}

async function watcherIds(ticketId) {
  if (ticketId == null) return [];
  const rows = await pool.query("SELECT user_id FROM ticket_watchers WHERE ticket_id = $1", [ticketId]);
  return rows.rows.map((row) => String(row.user_id));
}

// Watchers hear about every change in-app; the configurable rules don't apply to them.
export async function notifyWatchers(orgId, ticketId, title, actorId = null) {
  try {
    const skip = actorId == null ? null : String(actorId);
    const users = (await watcherIds(ticketId)).filter((id) => id !== skip);
    if (!users.length) return;
    await pool.query(
      `INSERT INTO user_notifications (org_id, user_id, ticket_id, kind, title)
       SELECT $1, u.id, $3, 'watch', $4 FROM users u
       WHERE u.id = ANY($2::bigint[]) AND u.org_id = $1 AND u.disabled_at IS NULL`,
      [orgId, users, ticketId, String(title).slice(0, 240)],
    );
  } catch {
    console.error("watcher notification failed");
  }
}

// In-app notifications go to userIds (or every owner/admin when empty) plus watchers, never to the person who acted.
// h: { writeAudit, ticketEvent }.
export async function deskNotify(h, { orgId, event, ticketId, subject, userIds = [], actorId = null }) {
  try {
    const rule = await notificationRule(orgId, event);
    if (!rule.email && !rule.inApp) return;
    const skip = actorId == null ? null : String(actorId);
    let users = [...new Set(userIds.filter((id) => id != null).map(String))].filter((id) => id !== skip);
    if (!users.length) users = (await managerIds(orgId)).filter((id) => id !== skip);
    if (event !== "new_ticket" && event !== "assigned") {
      users = [...new Set([...users, ...(await watcherIds(ticketId))])].filter((id) => id !== skip);
    }
    const title = `${EVENT_TITLES[event]}: ${subject}`.slice(0, 240);
    if (rule.inApp && users.length) {
      await pool.query(
        `INSERT INTO user_notifications (org_id, user_id, ticket_id, kind, title)
         SELECT $1, u.id, $3, $4, $5 FROM users u
         WHERE u.id = ANY($2::bigint[]) AND u.org_id = $1 AND u.disabled_at IS NULL`,
        [orgId, users, ticketId, event, title],
      );
    }
    if (!rule.email) return;
    let to = [];
    if (rule.custom) {
      const emails = await pool.query(
        "SELECT email FROM users WHERE id = ANY($1::bigint[]) AND org_id = $2 AND disabled_at IS NULL",
        [users, orgId],
      );
      to = emails.rows.map((row) => row.email);
    } else {
      to = String(process.env.MAIL_TO || "").split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (!to.length) return;
    const sent = await sendMail({
      to: to[0],
      cc: to.slice(1),
      subject: title,
      text: `${title}\n${consoleUrl()}/tickets/${ticketId}\n`,
    });
    if (!sent) return;
    await h.writeAudit(orgId, null, event === "sla_breach" ? "ticket.breach" : "ticket.mail", "ticket", String(ticketId), { event });
    await h.ticketEvent(orgId, ticketId, "email", { label: "Notifications", detail: { template: event, subject: title } });
  } catch {
    console.error("desk notification failed");
  }
}

async function listNotifications(orgId, userId) {
  const [rows, unread] = await Promise.all([
    pool.query(
      `SELECT id, ticket_id, kind, title, created_at, read_at
       FROM user_notifications
       WHERE org_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [orgId, userId],
    ),
    pool.query("SELECT count(*)::int AS n FROM user_notifications WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL", [orgId, userId]),
  ]);
  return {
    unread: unread.rows[0].n,
    items: rows.rows.map((row) => ({
      id: Number(row.id),
      ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
      kind: row.kind,
      title: row.title,
      createdAt: row.created_at,
      read: row.read_at != null,
    })),
  };
}

function holidayDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

// h: { send, readJson, requireTicketing, canOperate, writeAudit }.
export async function handleDeskSettings(req, res, url, actor, h) {
  const path = url.pathname;
  if (path === "/v1/notifications" || path === "/v1/notifications/read") {
    if (!actor) return h.send(res, 401, { error: "Login required." }), true;
    if (!actor.org_id) return h.send(res, 200, { unread: 0, items: [] }), true;
    if (req.method === "GET" && path === "/v1/notifications") {
      h.send(res, 200, await listNotifications(actor.org_id, actor.id));
      return true;
    }
    if (req.method === "POST" && path === "/v1/notifications/read") {
      const body = await h.readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isSafeInteger).slice(0, 200) : null;
      await pool.query(
        `UPDATE user_notifications SET read_at = now()
         WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL AND ($3::bigint[] IS NULL OR id = ANY($3::bigint[]))`,
        [actor.org_id, actor.id, ids],
      );
      h.send(res, 200, { ok: true });
      return true;
    }
    return false;
  }
  if (!path.startsWith("/v1/desk/")) return false;

  if (req.method === "GET" && path === "/v1/desk/setup") {
    if (!(await h.requireTicketing(actor, res))) return true;
    h.send(res, 200, { ...(await deskSetup(actor.org_id)), canEdit: h.canOperate(actor) });
    return true;
  }

  const write = ["POST", "PUT", "DELETE"].includes(req.method);
  if (!write) return false;
  if (!(await h.requireTicketing(actor, res))) return true;
  if (!h.canOperate(actor)) {
    h.send(res, 403, { error: "Only an owner or admin can change Service Desk settings." });
    return true;
  }
  const orgId = actor.org_id;
  const audit = (action, targetType, targetId, detail) => h.writeAudit(orgId, actor.id, action, targetType, String(targetId), detail);

  const status = path.match(/^\/v1\/desk\/statuses(?:\/(\d+))?$/);
  if (status) {
    if (req.method === "DELETE" && status[1]) {
      const removed = await pool.query("DELETE FROM desk_statuses WHERE id = $1 AND org_id = $2 RETURNING name", [status[1], orgId]);
      if (!removed.rows[0]) return h.send(res, 404, { error: "Status not found." }), true;
      await audit("desk.status_delete", "desk_status", status[1], { name: removed.rows[0].name });
      h.send(res, 200, { ok: true });
      return true;
    }
    const body = await h.readJson(req);
    const name = cleanName(body.name, 40);
    if (!name) return h.send(res, 400, { error: "Enter a status name (up to 40 characters)." }), true;
    if (!STATUS_BASES.has(body.base)) return h.send(res, 400, { error: "Choose whether the status counts as Open, Pending or Resolved." }), true;
    if (["open", "pending", "resolved"].includes(name.toLowerCase())) {
      return h.send(res, 400, { error: "Open, Pending and Resolved already exist. Choose another name." }), true;
    }
    const position = Number.isInteger(Number(body.position)) ? Math.max(0, Math.min(999, Number(body.position))) : 0;
    try {
      const saved = req.method === "POST" && !status[1]
        ? await pool.query("INSERT INTO desk_statuses (org_id, name, base, position) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, name, body.base, position])
        : req.method === "PUT" && status[1]
          ? await pool.query("UPDATE desk_statuses SET name = $1, base = $2, position = $3 WHERE id = $4 AND org_id = $5 RETURNING id", [name, body.base, position, status[1], orgId])
          : null;
      if (!saved) return false;
      if (!saved.rows[0]) return h.send(res, 404, { error: "Status not found." }), true;
      if (req.method === "PUT") {
        await pool.query("UPDATE tickets SET status = $1 WHERE status_id = $2 AND org_id = $3 AND status <> $1", [body.base, status[1], orgId]);
      }
      await audit(req.method === "POST" ? "desk.status_create" : "desk.status_update", "desk_status", saved.rows[0].id, { name, base: body.base });
      h.send(res, req.method === "POST" ? 201 : 200, { id: Number(saved.rows[0].id) });
    } catch (error) {
      if (!uniqueError(error)) throw error;
      h.send(res, 409, { error: "A status with that name already exists." });
    }
    return true;
  }

  if (req.method === "PUT" && path === "/v1/desk/priorities") {
    const body = await h.readJson(req);
    const labels = {};
    for (const key of PRIORITIES) {
      const label = cleanName(body.labels?.[key] ?? PRIORITY_DEFAULT_LABELS[key], 30);
      if (!label) return h.send(res, 400, { error: "Each priority needs a label of up to 30 characters." }), true;
      labels[key] = label;
    }
    for (const key of PRIORITIES) {
      await pool.query(
        `INSERT INTO desk_priorities (org_id, priority, label) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, priority) DO UPDATE SET label = EXCLUDED.label`,
        [orgId, key, labels[key]],
      );
    }
    await audit("desk.priorities_update", "org", orgId, { labels });
    h.send(res, 200, { labels });
    return true;
  }

  const listMatch = path.match(/^\/v1\/desk\/(categories|tags)(?:\/(\d+))?$/);
  if (listMatch) {
    const table = listMatch[1] === "categories" ? "desk_categories" : "desk_tags";
    const noun = listMatch[1] === "categories" ? "category" : "tag";
    if (req.method === "DELETE" && listMatch[2]) {
      const removed = await pool.query(`DELETE FROM ${table} WHERE id = $1 AND org_id = $2 RETURNING name`, [listMatch[2], orgId]);
      if (!removed.rows[0]) return h.send(res, 404, { error: `That ${noun} was not found.` }), true;
      await audit(`desk.${noun}_delete`, `desk_${noun}`, listMatch[2], { name: removed.rows[0].name });
      h.send(res, 200, { ok: true });
      return true;
    }
    if (req.method !== "POST" || listMatch[2]) return false;
    const body = await h.readJson(req);
    const max = noun === "category" ? 60 : 30;
    const name = cleanName(body.name, max);
    if (!name) return h.send(res, 400, { error: `Enter a ${noun} name (up to ${max} characters).` }), true;
    try {
      const saved = await pool.query(`INSERT INTO ${table} (org_id, name) VALUES ($1, $2) RETURNING id`, [orgId, name]);
      await audit(`desk.${noun}_create`, `desk_${noun}`, saved.rows[0].id, { name });
      h.send(res, 201, { id: Number(saved.rows[0].id) });
    } catch (error) {
      if (!uniqueError(error)) throw error;
      h.send(res, 409, { error: `That ${noun} already exists.` });
    }
    return true;
  }

  if (req.method === "PUT" && path === "/v1/desk/business-hours") {
    const body = await h.readJson(req);
    const parsed = parseHours(body.hours);
    if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
    const enabled = body.enabled === true;
    if (enabled && !Object.values(parsed.value).some((list) => list.length)) {
      return h.send(res, 400, { error: "Add opening times for at least one day, or switch business hours off." }), true;
    }
    await pool.query(
      `INSERT INTO desk_business_hours (org_id, enabled, hours) VALUES ($1, $2, $3)
       ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled, hours = EXCLUDED.hours, updated_at = now()`,
      [orgId, enabled, JSON.stringify(parsed.value)],
    );
    await audit("desk.hours_update", "org", orgId, { enabled, hours: parsed.value });
    h.send(res, 200, { enabled, hours: parsed.value });
    return true;
  }

  if (req.method === "POST" && path === "/v1/desk/holidays/load") {
    const body = await h.readJson(req);
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return h.send(res, 400, { error: "Choose a year." }), true;
    const list = zaHolidays(year);
    const added = await pool.query(
      `INSERT INTO desk_holidays (org_id, day, name)
       SELECT $1, d.day::date, d.name FROM jsonb_to_recordset($2::jsonb) AS d(day text, name text)
       ON CONFLICT (org_id, day) DO NOTHING
       RETURNING id`,
      [orgId, JSON.stringify(list)],
    );
    await audit("desk.holidays_load", "org", orgId, { year, added: added.rowCount });
    h.send(res, 200, { added: added.rowCount });
    return true;
  }

  const holiday = path.match(/^\/v1\/desk\/holidays(?:\/(\d+))?$/);
  if (holiday) {
    if (req.method === "DELETE" && holiday[1]) {
      const removed = await pool.query("DELETE FROM desk_holidays WHERE id = $1 AND org_id = $2 RETURNING to_char(day, 'YYYY-MM-DD') AS day", [holiday[1], orgId]);
      if (!removed.rows[0]) return h.send(res, 404, { error: "Holiday not found." }), true;
      await audit("desk.holiday_delete", "desk_holiday", holiday[1], { day: removed.rows[0].day });
      h.send(res, 200, { ok: true });
      return true;
    }
    if (req.method !== "POST" || holiday[1]) return false;
    const body = await h.readJson(req);
    const day = holidayDay(body.day);
    const name = cleanName(body.name, 80);
    if (!day) return h.send(res, 400, { error: "Choose a date." }), true;
    if (!name) return h.send(res, 400, { error: "Enter a holiday name (up to 80 characters)." }), true;
    try {
      const saved = await pool.query("INSERT INTO desk_holidays (org_id, day, name) VALUES ($1, $2, $3) RETURNING id", [orgId, day, name]);
      await audit("desk.holiday_create", "desk_holiday", saved.rows[0].id, { day, name });
      h.send(res, 201, { id: Number(saved.rows[0].id) });
    } catch (error) {
      if (!uniqueError(error)) throw error;
      h.send(res, 409, { error: "There is already a holiday on that date." });
    }
    return true;
  }

  const canned = path.match(/^\/v1\/desk\/canned(?:\/(\d+))?$/);
  if (canned) {
    if (req.method === "DELETE" && canned[1]) {
      const removed = await pool.query("DELETE FROM desk_canned_replies WHERE id = $1 AND org_id = $2 RETURNING title", [canned[1], orgId]);
      if (!removed.rows[0]) return h.send(res, 404, { error: "Canned reply not found." }), true;
      await audit("desk.canned_delete", "desk_canned_reply", canned[1], { title: removed.rows[0].title });
      h.send(res, 200, { ok: true });
      return true;
    }
    const body = await h.readJson(req);
    const title = cleanName(body.title, 80);
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!title) return h.send(res, 400, { error: "Enter a title (up to 80 characters)." }), true;
    if (!text || text.length > 4000) return h.send(res, 400, { error: "Enter the reply text (up to 4000 characters)." }), true;
    try {
      const saved = req.method === "POST" && !canned[1]
        ? await pool.query("INSERT INTO desk_canned_replies (org_id, title, body, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, title, text, actor.id])
        : req.method === "PUT" && canned[1]
          ? await pool.query("UPDATE desk_canned_replies SET title = $1, body = $2, updated_at = now() WHERE id = $3 AND org_id = $4 RETURNING id", [title, text, canned[1], orgId])
          : null;
      if (!saved) return false;
      if (!saved.rows[0]) return h.send(res, 404, { error: "Canned reply not found." }), true;
      await audit(req.method === "POST" ? "desk.canned_create" : "desk.canned_update", "desk_canned_reply", saved.rows[0].id, { title });
      h.send(res, req.method === "POST" ? 201 : 200, { id: Number(saved.rows[0].id) });
    } catch (error) {
      if (!uniqueError(error)) throw error;
      h.send(res, 409, { error: "A canned reply with that title already exists." });
    }
    return true;
  }

  if (req.method === "PUT" && path === "/v1/desk/notification-rules") {
    const body = await h.readJson(req);
    const rules = {};
    for (const event of NOTIFY_EVENTS) {
      const rule = body.rules?.[event] || {};
      rules[event] = { email: rule.email === true, inApp: rule.inApp === true };
    }
    for (const event of NOTIFY_EVENTS) {
      await pool.query(
        `INSERT INTO desk_notification_rules (org_id, event, email, in_app) VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, event) DO UPDATE SET email = EXCLUDED.email, in_app = EXCLUDED.in_app`,
        [orgId, event, rules[event].email, rules[event].inApp],
      );
    }
    await audit("desk.notifications_update", "org", orgId, { rules });
    h.send(res, 200, { rules });
    return true;
  }

  return false;
}
