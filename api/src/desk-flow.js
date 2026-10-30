import { pool } from "./db.js";
import { applyAutomations, parseAutomation } from "./desk-automation.js";
import { deskNotify, notifyWatchers } from "./desk-settings.js";
import { ticketChanges } from "./ticket-events.js";

const DEFAULT_OPTIONS = { autoCloseDays: null, alertTickets: false, brandColor: "#8B5CF6", signature: "", csatEnabled: false };
const MAX_AUTOMATIONS = 50;
const MAX_WATCHERS = 20;

export async function deskOptions(orgId) {
  const row = await pool.query("SELECT auto_close_days, alert_tickets, brand_color, signature, csat_enabled FROM desk_options WHERE org_id = $1", [orgId]);
  if (!row.rows[0]) return { ...DEFAULT_OPTIONS };
  return {
    autoCloseDays: row.rows[0].auto_close_days,
    alertTickets: row.rows[0].alert_tickets,
    brandColor: row.rows[0].brand_color,
    signature: row.rows[0].signature || "",
    csatEnabled: row.rows[0].csat_enabled,
  };
}

function automationView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    trigger: row.trigger,
    conditions: row.conditions || [],
    actions: row.actions || [],
    enabled: row.enabled,
    position: row.position,
  };
}

async function ticketForRules(orgId, ticketId) {
  const found = await pool.query(
    `SELECT t.id, t.subject, t.status, t.priority, t.channel, t.category, t.tags, t.customer_id,
            t.assignee_user_id, c.sla_plan_id AS plan_id
     FROM tickets t
     JOIN customers c ON c.id = t.customer_id
     WHERE t.id = $1 AND t.org_id = $2 AND t.merged_into_id IS NULL`,
    [ticketId, orgId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    ...row,
    customer_id: Number(row.customer_id),
    plan_id: row.plan_id == null ? null : Number(row.plan_id),
    assignee_user_id: row.assignee_user_id == null ? null : String(row.assignee_user_id),
    tags: row.tags || [],
  };
}

// Changes made here never re-trigger automations, so rules cannot loop.
// h: { writeAudit, ticketEvent }.
export async function runAutomations(h, orgId, ticketId, trigger) {
  try {
    const rules = await pool.query(
      `SELECT id, name, conditions, actions, enabled FROM desk_automations
       WHERE org_id = $1 AND trigger = $2 AND enabled
       ORDER BY position, id`,
      [orgId, trigger],
    );
    if (!rules.rows.length) return [];
    const before = await ticketForRules(orgId, ticketId);
    if (!before) return [];
    const { ticket: after, fired } = applyAutomations(before, rules.rows);
    if (!fired.length) return [];
    if (after.assignee_user_id !== before.assignee_user_id) {
      const user = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND org_id = $2 AND disabled_at IS NULL",
        [after.assignee_user_id, orgId],
      );
      if (!user.rows[0]) after.assignee_user_id = before.assignee_user_id;
    }
    await pool.query(
      `UPDATE tickets
       SET status = $1, priority = $2, category = $3, tags = $4::text[], assignee_user_id = $5::bigint,
           status_id = CASE WHEN status = $1 THEN status_id ELSE NULL END, updated_at = now()
       WHERE id = $6 AND org_id = $7`,
      [after.status, after.priority, after.category, after.tags, after.assignee_user_id, ticketId, orgId],
    );
    for (const rule of fired) {
      await h.ticketEvent(orgId, ticketId, "automation", {
        label: `Automation: ${rule.name}`,
        detail: { rule: rule.name, changes: rule.changes },
      });
    }
    const asFields = (ticket) => ({
      status: ticket.status,
      priority: ticket.priority,
      assigneeUserId: ticket.assignee_user_id,
      category: ticket.category,
      tags: ticket.tags,
    });
    for (const change of ticketChanges(asFields(before), asFields(after))) {
      await h.ticketEvent(orgId, ticketId, change.kind, { label: "Automation", detail: { from: change.from, to: change.to } });
    }
    await h.writeAudit(orgId, null, "ticket.automation", "ticket", String(ticketId), {
      trigger,
      rules: fired.map((rule) => rule.name),
    });
    if (after.assignee_user_id && after.assignee_user_id !== before.assignee_user_id) {
      await deskNotify(h, { orgId, event: "assigned", ticketId, subject: before.subject, userIds: [after.assignee_user_id] });
    }
    if (after.status === "resolved" && before.status !== "resolved") await h.ticketResolved?.(orgId, ticketId);
    return fired;
  } catch (error) {
    console.error("automation failed", error.message);
    return [];
  }
}

// Closes tickets left in Pending for longer than the tenant's auto-close setting.
export async function autoCloseSweep(h) {
  const due = await pool.query(
    `SELECT t.id, t.org_id, t.subject, o.auto_close_days
     FROM tickets t
     JOIN desk_options o ON o.org_id = t.org_id AND o.auto_close_days IS NOT NULL
     WHERE t.status = 'pending' AND t.merged_into_id IS NULL AND t.migration_lock IS NULL AND t.sla_paused_at IS NOT NULL
       AND t.sla_paused_at < now() - make_interval(days => o.auto_close_days)
     ORDER BY t.sla_paused_at
     LIMIT 200`,
  );
  for (const row of due.rows) {
    const closed = await pool.query(
      `UPDATE tickets SET status = 'resolved', status_id = NULL, updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [row.id],
    );
    if (!closed.rows[0]) continue;
    await h.ticketEvent(row.org_id, row.id, "status", {
      label: "Automation: auto-close",
      detail: { from: "pending", to: "resolved", autoClosed: row.auto_close_days },
    });
    await h.writeAudit(row.org_id, null, "ticket.auto_close", "ticket", String(row.id), { days: row.auto_close_days });
    await notifyWatchers(row.org_id, row.id, `Auto-closed after ${row.auto_close_days} days pending: ${row.subject}`);
    await h.ticketResolved?.(row.org_id, row.id);
  }
}

async function automationSetup(orgId) {
  const [options, rules, users, plans, customers] = await Promise.all([
    deskOptions(orgId),
    pool.query(
      "SELECT id, name, trigger, conditions, actions, enabled, position FROM desk_automations WHERE org_id = $1 ORDER BY trigger, position, id",
      [orgId],
    ),
    pool.query("SELECT id, name, email FROM users WHERE org_id = $1 AND disabled_at IS NULL ORDER BY lower(name)", [orgId]),
    pool.query("SELECT id, name FROM sla_plans WHERE org_id = $1 ORDER BY lower(name)", [orgId]),
    pool.query("SELECT id, name FROM customers WHERE org_id = $1 ORDER BY lower(name)", [orgId]),
  ]);
  return {
    options,
    automations: rules.rows.map(automationView),
    users: users.rows.map((row) => ({ id: Number(row.id), name: row.name || row.email })),
    plans: plans.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
  };
}

function parseOptions(body) {
  let autoCloseDays = null;
  if (body.autoCloseDays != null && body.autoCloseDays !== "") {
    autoCloseDays = Number(body.autoCloseDays);
    if (!Number.isInteger(autoCloseDays) || autoCloseDays < 1 || autoCloseDays > 90) {
      return { error: "Auto-close needs a number of days from 1 to 90, or leave it empty to switch it off." };
    }
  }
  const brandColor = String(body.brandColor || DEFAULT_OPTIONS.brandColor).trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(brandColor)) return { error: "Choose a brand colour like #8B5CF6." };
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (signature.length > 1000) return { error: "Keep the signature under 1000 characters." };
  return { value: { autoCloseDays, alertTickets: body.alertTickets === true, brandColor, signature, csatEnabled: body.csatEnabled === true } };
}

async function wouldLoop(childId, parentId) {
  let current = parentId;
  for (let depth = 0; depth < 25 && current != null; depth += 1) {
    if (String(current) === String(childId)) return true;
    const row = await pool.query("SELECT parent_id FROM tickets WHERE id = $1", [current]);
    current = row.rows[0]?.parent_id ?? null;
  }
  return current != null;
}

// h: { send, readJson, requireTicketing, canOperate, writeAudit, ticketEvent }.
export async function handleDeskFlow(req, res, url, actor, h) {
  const path = url.pathname;

  const watch = path.match(/^\/v1\/tickets\/(\d+)\/(watch|watchers|parent)$/);
  if (watch) {
    if (!["POST", "PUT", "DELETE"].includes(req.method)) return false;
    if (!(await h.requireTicketing(actor, res, { deny: true }))) return true;
    const ticket = await pool.query("SELECT id, subject FROM tickets WHERE id = $1 AND org_id = $2", [watch[1], actor.org_id]);
    if (!ticket.rows[0]) return h.send(res, 404, { error: "Ticket not found." }), true;
    const ticketId = Number(ticket.rows[0].id);
    if (watch[2] === "watch") {
      if (req.method === "DELETE") {
        await pool.query("DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2", [ticketId, actor.id]);
      } else {
        await pool.query(
          "INSERT INTO ticket_watchers (org_id, ticket_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [actor.org_id, ticketId, actor.id],
        );
      }
      h.send(res, 200, { watching: req.method !== "DELETE" });
      return true;
    }
    if (watch[2] === "watchers" && req.method === "PUT") {
      const body = await h.readJson(req);
      const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : []).map(Number).filter(Number.isSafeInteger))];
      if (ids.length > MAX_WATCHERS) return h.send(res, 400, { error: `Add up to ${MAX_WATCHERS} watchers.` }), true;
      const valid = ids.length
        ? await pool.query("SELECT id FROM users WHERE id = ANY($1::bigint[]) AND org_id = $2 AND disabled_at IS NULL", [ids, actor.org_id])
        : { rows: [] };
      if (valid.rows.length !== ids.length) return h.send(res, 400, { error: "Choose watchers in this organisation." }), true;
      await pool.query("DELETE FROM ticket_watchers WHERE ticket_id = $1 AND NOT (user_id = ANY($2::bigint[]))", [ticketId, ids]);
      if (ids.length) {
        await pool.query(
          `INSERT INTO ticket_watchers (org_id, ticket_id, user_id)
           SELECT $1, $2, unnest($3::bigint[]) ON CONFLICT DO NOTHING`,
          [actor.org_id, ticketId, ids],
        );
      }
      await h.writeAudit(actor.org_id, actor.id, "ticket.watchers", "ticket", String(ticketId), { watchers: ids.length });
      h.send(res, 200, { watchers: ids });
      return true;
    }
    if (watch[2] === "parent" && req.method === "PUT") {
      const body = await h.readJson(req);
      const raw = body.parentId == null || body.parentId === "" ? null : Number(String(body.parentId).replace(/^#/, ""));
      if (raw != null && !Number.isSafeInteger(raw)) return h.send(res, 400, { error: "Enter a ticket number." }), true;
      if (raw === ticketId) return h.send(res, 400, { error: "A ticket cannot be its own parent." }), true;
      let parent = null;
      if (raw != null) {
        const found = await pool.query("SELECT id, subject FROM tickets WHERE id = $1 AND org_id = $2 AND merged_into_id IS NULL", [raw, actor.org_id]);
        if (!found.rows[0]) return h.send(res, 404, { error: `Ticket #${raw} was not found.` }), true;
        if (await wouldLoop(ticketId, raw)) return h.send(res, 400, { error: "That would make the tickets parents of each other." }), true;
        parent = found.rows[0];
      }
      const before = await pool.query("SELECT parent_id FROM tickets WHERE id = $1", [ticketId]);
      const from = before.rows[0].parent_id == null ? null : Number(before.rows[0].parent_id);
      if (from === raw) return h.send(res, 200, { parentId: raw }), true;
      await pool.query("UPDATE tickets SET parent_id = $1, updated_at = now() WHERE id = $2", [raw, ticketId]);
      await h.ticketEvent(actor.org_id, ticketId, "parent", { actorId: actor.id, detail: { from, to: raw } });
      await h.writeAudit(actor.org_id, actor.id, "ticket.parent", "ticket", String(ticketId), { from, to: raw });
      h.send(res, 200, { parentId: raw, parentSubject: parent?.subject || null });
      return true;
    }
    return false;
  }

  if (path !== "/v1/desk/automation" && path !== "/v1/desk/options" && !path.startsWith("/v1/desk/automations")) return false;

  if (req.method === "GET" && path === "/v1/desk/automation") {
    if (!(await h.requireTicketing(actor, res))) return true;
    h.send(res, 200, { ...(await automationSetup(actor.org_id)), canEdit: h.canOperate(actor) });
    return true;
  }
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return false;
  if (!(await h.requireTicketing(actor, res))) return true;
  if (!h.canOperate(actor)) {
    h.send(res, 403, { error: "Only an owner or admin can change Service Desk settings." });
    return true;
  }
  const orgId = actor.org_id;

  if (req.method === "PUT" && path === "/v1/desk/options") {
    const parsed = parseOptions(await h.readJson(req));
    if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
    const o = parsed.value;
    await pool.query(
      `INSERT INTO desk_options (org_id, auto_close_days, alert_tickets, brand_color, signature, csat_enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id) DO UPDATE SET auto_close_days = EXCLUDED.auto_close_days, alert_tickets = EXCLUDED.alert_tickets,
         brand_color = EXCLUDED.brand_color, signature = EXCLUDED.signature, csat_enabled = EXCLUDED.csat_enabled, updated_at = now()`,
      [orgId, o.autoCloseDays, o.alertTickets, o.brandColor, o.signature || null, o.csatEnabled],
    );
    await h.writeAudit(orgId, actor.id, "desk.options_update", "org", String(orgId), {
      autoCloseDays: o.autoCloseDays,
      alertTickets: o.alertTickets,
      brandColor: o.brandColor,
      csatEnabled: o.csatEnabled,
    });
    h.send(res, 200, o);
    return true;
  }

  const rule = path.match(/^\/v1\/desk\/automations(?:\/(\d+))?$/);
  if (!rule) return false;
  if (req.method === "DELETE" && rule[1]) {
    const removed = await pool.query("DELETE FROM desk_automations WHERE id = $1 AND org_id = $2 RETURNING name", [rule[1], orgId]);
    if (!removed.rows[0]) return h.send(res, 404, { error: "Automation not found." }), true;
    await h.writeAudit(orgId, actor.id, "desk.automation_delete", "desk_automation", rule[1], { name: removed.rows[0].name });
    h.send(res, 200, { ok: true });
    return true;
  }
  const parsed = parseAutomation(await h.readJson(req));
  if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
  const a = parsed.value;
  if (req.method === "POST" && !rule[1]) {
    const count = await pool.query("SELECT count(*)::int AS n FROM desk_automations WHERE org_id = $1", [orgId]);
    if (count.rows[0].n >= MAX_AUTOMATIONS) return h.send(res, 400, { error: `You can keep up to ${MAX_AUTOMATIONS} automations.` }), true;
    const saved = await pool.query(
      `INSERT INTO desk_automations (org_id, name, trigger, conditions, actions, enabled, position)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7) RETURNING id`,
      [orgId, a.name, a.trigger, JSON.stringify(a.conditions), JSON.stringify(a.actions), a.enabled, a.position],
    );
    await h.writeAudit(orgId, actor.id, "desk.automation_create", "desk_automation", String(saved.rows[0].id), a);
    h.send(res, 201, { id: Number(saved.rows[0].id) });
    return true;
  }
  if (req.method === "PUT" && rule[1]) {
    const saved = await pool.query(
      `UPDATE desk_automations
       SET name = $1, trigger = $2, conditions = $3::jsonb, actions = $4::jsonb, enabled = $5, position = $6, updated_at = now()
       WHERE id = $7 AND org_id = $8 RETURNING id`,
      [a.name, a.trigger, JSON.stringify(a.conditions), JSON.stringify(a.actions), a.enabled, a.position, rule[1], orgId],
    );
    if (!saved.rows[0]) return h.send(res, 404, { error: "Automation not found." }), true;
    await h.writeAudit(orgId, actor.id, "desk.automation_update", "desk_automation", rule[1], a);
    h.send(res, 200, { id: Number(rule[1]) });
    return true;
  }
  return false;
}
