export const PLATFORM_ROLES = ["super", "admin", "support"];
export const PLATFORM_ROLE_LABEL = { super: "Super admin", admin: "Platform admin", support: "Support (read-only)" };

// Support accounts may still sign out, look after their own login and mark notices read.
const SUPPORT_WRITES = [/^\/v1\/logout$/, /^\/v1\/account(\/|$)/, /^\/v1\/notices\/devices\/\d+(\/read)?$/, /^\/v1\/notifications(\/|$)/];

export function supportBlocked(actor, method, pathname) {
  if (!actor?.is_platform_admin || actor.platform_role !== "support") return false;
  if (method === "GET" || method === "HEAD") return false;
  return !SUPPORT_WRITES.some((pattern) => pattern.test(pathname));
}

export function mfaSetupNeeded(user, now = Date.now()) {
  if (user.mfa_enabled_at) return false;
  if (user.is_platform_admin) return Boolean(user.platform_mfa_due_at && new Date(user.platform_mfa_due_at).getTime() <= now);
  return user.require_mfa === true;
}

export function parsePlatformInvite(body) {
  const name = typeof body?.name === "string" ? body.name.replace(/[\r\n\t]+/g, " ").trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (!name || name.length > 120) return { error: "Enter the person's full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  if (!PLATFORM_ROLES.includes(role)) return { error: "Choose a level." };
  return { value: { name, email, role } };
}

// Returns an error message when the change would leave the platform without an active super admin.
export function lastSuperGuard(supers, targetId, nextRole, nextActive) {
  const others = supers.filter((row) => Number(row.id) !== Number(targetId));
  const targetIsSuper = supers.some((row) => Number(row.id) === Number(targetId));
  if (!targetIsSuper) return null;
  if (nextRole === "super" && nextActive) return null;
  return others.length ? null : "This is the last active super admin. Make someone else a super admin first.";
}
