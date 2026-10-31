import { AsyncLocalStorage } from "node:async_hooks";
import { activityFromAudit, recordActivitySafely } from "./activity.js";

const requestContext = new AsyncLocalStorage();

function header(value, max) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, max) : null;
}

export function enterRequest(req, ip) {
  requestContext.enterWith({
    ip: ip && ip !== "unknown" ? ip : null,
    userAgent: header(req.headers["x-df-user-agent"], 300) || header(req.headers["user-agent"], 300),
    role: null,
  });
}

export function setRequestRole(actor) {
  const store = requestContext.getStore();
  if (!store || !actor) return;
  if (actor.impersonating) store.role = "platform_admin_as_tenant";
  else if (actor.is_platform_admin) store.role = "platform_admin";
  else {
    const roles = actor.roles || [];
    store.role = ["owner", "admin", "tech"].find((role) => roles.includes(role)) || roles[0] || null;
  }
}

export function auditMeta() {
  const store = requestContext.getStore();
  return { role: store?.role ?? null, ip: store?.ip ?? null, userAgent: store?.userAgent ?? null };
}

export async function insertAudit(db, orgId, actorId, action, targetType, targetId, detail) {
  const meta = auditMeta();
  const result = await db.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail, actor_role, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     RETURNING id`,
    [
      orgId,
      actorId,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      JSON.stringify(detail || {}),
      meta.role,
      meta.ip,
      meta.userAgent,
    ],
  );
  const event = orgId == null ? null : activityFromAudit({ action, targetType, targetId, detail, actorId });
  if (event) await recordActivitySafely(db, orgId, { ...event, source: "audit", sourceId: result.rows[0].id });
  return result;
}
