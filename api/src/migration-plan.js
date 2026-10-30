// Pure planning for tenant migrations: input parsing, the dry run, approval rules and expiry.

export const SCOPE_KEYS = ["customers", "tickets", "devices", "settings", "users"];
export const MODES = ["copy", "move"];
export const RESOLUTIONS = ["merge", "rename", "skip"];
export const APPROVAL_ROLES = ["source_owner", "target_owner", "platform_admin"];
export const EXPIRY_DAYS = 7;
export const ROLLBACK_DAYS = 30;
export const RENAME_SUFFIX = " (migrated)";

const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE_OFFSET_HOURS = 2;
const AFTER_HOURS = 19;

export class IsolationError extends Error {}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function idList(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.map(Number))];
  return ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids.sort((a, b) => a - b) : undefined;
}

export function parseRequestInput(body = {}) {
  const sourceId = Number(body.sourceId);
  const targetId = Number(body.targetId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) return { error: "Choose the source tenant." };
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return { error: "Choose the target tenant." };
  if (sourceId === targetId) return { error: "The source and target tenants must be different." };
  const mode = MODES.includes(body.mode) ? body.mode : null;
  if (!mode) return { error: "Choose Copy or Move." };
  const raw = body.scope && typeof body.scope === "object" ? body.scope : {};
  const scope = Object.fromEntries(SCOPE_KEYS.map((key) => [key, raw[key] === true]));
  const customerIds = idList(raw.customerIds);
  if (customerIds === undefined) return { error: "The customer list is not valid." };
  scope.customerIds = customerIds && customerIds.length ? customerIds : null;
  if (!SCOPE_KEYS.some((key) => scope[key])) return { error: "Choose at least one kind of data to migrate." };
  if ((scope.tickets || scope.devices) && !scope.customers) {
    return { error: "Tickets and devices belong to customers, so include customers and contacts too." };
  }
  const resolutions = {};
  if (body.resolutions && typeof body.resolutions === "object") {
    for (const [key, value] of Object.entries(body.resolutions)) {
      if (!/^(customer|contact|device|sla_plan):\d{1,18}$/.test(key) || !RESOLUTIONS.includes(value)) {
        return { error: "A conflict resolution is not valid." };
      }
      resolutions[key] = value;
    }
  }
  const acknowledged = Array.isArray(body.acknowledged)
    ? [...new Set(body.acknowledged.filter((key) => typeof key === "string" && /^[a-z_]{1,40}$/.test(key)))].sort()
    : [];
  let scheduleAt = null;
  if (body.scheduleAt != null && body.scheduleAt !== "") {
    const when = new Date(body.scheduleAt);
    if (Number.isNaN(when.getTime())) return { error: "The schedule date is not valid." };
    scheduleAt = when.toISOString();
  }
  return { value: { sourceId, targetId, mode, scope, resolutions, acknowledged, scheduleAt } };
}

// The next 19:00 in Africa/Johannesburg (UTC+2 all year).
export function defaultSchedule(now = new Date()) {
  const local = new Date(now.getTime() + ZONE_OFFSET_HOURS * 3600000);
  const run = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), AFTER_HOURS - ZONE_OFFSET_HOURS));
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run.toISOString();
}

function assertTenant(rows, orgId, label) {
  for (const row of rows || []) {
    if (Number(row.org_id) !== Number(orgId)) throw new IsolationError(`${label} row ${row.id} belongs to another tenant.`);
  }
}

function conflictOptions(type) {
  return type === "device" ? ["rename", "skip", "merge"] : RESOLUTIONS;
}

function defaultResolution(type) {
  return type === "device" ? "rename" : "merge";
}

// source/target hold rows already filtered to their tenant; anything else is an isolation failure.
export function buildPlan({ request, source, target, sourceLicense, targetLicense, names = {} }) {
  const { sourceId, targetId, mode, scope, resolutions = {}, acknowledged = [] } = request;
  for (const key of ["customers", "contacts", "sites", "devices", "tickets", "slaPlans", "users"]) {
    assertTenant(source[key], sourceId, `Source ${key}`);
  }
  for (const key of ["customers", "contacts", "devices", "slaPlans"]) assertTenant(target[key], targetId, `Target ${key}`);

  const errors = [];
  if (sourceId === targetId) errors.push("The source and target tenants must be different.");
  if (!sourceLicense?.active) errors.push(`${names.source || "The source tenant"} is not active.`);
  if (!targetLicense?.active) errors.push(`${names.target || "The target tenant"} is not active.`);
  if (scope.devices && mode === "copy") errors.push("Devices can only be moved, not copied: an agent reports to one tenant.");

  const conflicts = [];
  const resolve = (type, row, match, label) => {
    const key = `${type}:${row.id}`;
    const resolution = resolutions[key] || defaultResolution(type);
    conflicts.push({ key, type, sourceId: Number(row.id), targetId: Number(match.id), label, resolution, options: conflictOptions(type) });
    return resolution;
  };

  const chosen = scope.customerIds ? new Set(scope.customerIds.map(Number)) : null;
  const customers = scope.customers ? source.customers.filter((row) => !chosen || chosen.has(Number(row.id))) : [];
  if (chosen && scope.customers) {
    const known = new Set(source.customers.map((row) => Number(row.id)));
    if ([...chosen].some((id) => !known.has(id))) errors.push("A chosen customer does not belong to the source tenant.");
  }
  const targetCustomers = new Map(target.customers.map((row) => [lower(row.name), row]));
  const customerAction = new Map();
  for (const row of customers) {
    const match = targetCustomers.get(lower(row.name));
    customerAction.set(Number(row.id), match ? resolve("customer", row, match, `Customer "${row.name}" already exists`) : "create");
  }
  const movedCustomers = new Set([...customerAction].filter(([, action]) => action !== "skip").map(([id]) => id));

  const targetContacts = new Map();
  for (const row of target.contacts) if (lower(row.email)) targetContacts.set(lower(row.email), row);
  const contactAction = new Map();
  for (const row of source.contacts) {
    if (!movedCustomers.has(Number(row.customer_id))) continue;
    const match = lower(row.email) ? targetContacts.get(lower(row.email)) : null;
    contactAction.set(Number(row.id), match ? resolve("contact", row, match, `Contact email ${row.email} is already used`) : "create");
  }

  const siteCustomer = new Map(source.sites.map((row) => [Number(row.id), Number(row.customer_id)]));
  const deviceAction = new Map();
  if (scope.devices && mode === "move") {
    const targetHosts = new Map(target.devices.map((row) => [lower(row.hostname), row]));
    for (const row of source.devices) {
      const customerId = row.site_id == null ? null : siteCustomer.get(Number(row.site_id));
      const inScope = customerId == null ? !chosen : movedCustomers.has(customerId);
      if (!inScope) continue;
      const match = targetHosts.get(lower(row.hostname));
      deviceAction.set(Number(row.id), match ? resolve("device", row, match, `Device ${row.hostname} already exists`) : "move");
    }
  }
  const movedDevices = [...deviceAction].filter(([, action]) => action === "move" || action === "rename").map(([id]) => id);

  const tickets = scope.tickets ? source.tickets.filter((row) => movedCustomers.has(Number(row.customer_id))) : [];

  const slaAction = new Map();
  if (scope.settings) {
    const targetPlans = new Map(target.slaPlans.map((row) => [lower(row.name), row]));
    for (const row of source.slaPlans) {
      const match = targetPlans.get(lower(row.name));
      slaAction.set(Number(row.id), match ? resolve("sla_plan", row, match, `SLA plan "${row.name}" already exists`) : "create");
    }
  }
  const missing = (from = [], into = []) => {
    const have = new Set(into.map(lower));
    return from.filter((name) => !have.has(lower(name))).length;
  };
  const settingsAdded = scope.settings
    ? {
      categories: missing(source.settings?.categories, target.settings?.categories),
      tags: missing(source.settings?.tags, target.settings?.tags),
      cannedReplies: missing(source.settings?.cannedReplies, target.settings?.cannedReplies),
      holidays: missing(source.settings?.holidays, target.settings?.holidays),
    }
    : null;

  const sum = (key) => tickets.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const created = (map) => [...map.values()].filter((action) => action === "create" || action === "rename").length;
  const counts = {
    customers: created(customerAction),
    customersMerged: [...customerAction.values()].filter((action) => action === "merge").length,
    customersSkipped: [...customerAction.values()].filter((action) => action === "skip").length,
    contacts: created(contactAction),
    contactsMerged: [...contactAction.values()].filter((action) => action === "merge").length,
    devices: movedDevices.length,
    tickets: tickets.length,
    comments: sum("comments"),
    events: sum("events"),
    attachments: sum("attachments"),
    timeEntries: sum("time_entries"),
    slaPlans: created(slaAction),
    settings: settingsAdded ? Object.values(settingsAdded).reduce((a, b) => a + b, 0) : 0,
    users: scope.users ? source.users.length : 0,
  };

  const blocked = [];
  const features = new Set(targetLicense?.features || []);
  if (scope.tickets && tickets.length && !features.has("ticketing")) {
    blocked.push({ key: "tickets_unlicensed", label: `${names.target || "The target"} has no Service Desk. Tickets are stored but hidden until it gets one.` });
  }
  if (scope.devices && movedDevices.length && !features.has("enrollment")) {
    blocked.push({ key: "devices_unlicensed", label: `${names.target || "The target"} has no Remote Desk. Moved devices are stored but cannot be managed.` });
  }
  if (scope.devices && targetLicense?.devicesLeft != null && movedDevices.length > targetLicense.devicesLeft) {
    blocked.push({ key: "devices_over_cap", label: `Moving ${movedDevices.length} devices goes over the target's device limit (${Math.max(0, targetLicense.devicesLeft)} left).` });
  }
  for (const item of blocked) item.acknowledged = acknowledged.includes(item.key);

  const users = scope.users
    ? source.users.map((row) => ({
      name: row.name,
      email: row.email,
      outcome: "skipped",
      reason: "Already has an account. One email address belongs to one tenant, so invite them to the target from its Users tab.",
    }))
    : [];

  return {
    counts,
    conflicts,
    blocked,
    errors,
    users,
    settingsAdded,
    ticketNumbers: {
      count: tickets.length,
      sample: tickets.slice(0, 5).map((row) => Number(row.id)),
      note: "Tickets get new numbers in the target when the migration runs. Each keeps \"Migrated from DF-#n\" on its timeline.",
    },
    selection: {
      customers: Object.fromEntries(customerAction),
      contacts: Object.fromEntries(contactAction),
      devices: Object.fromEntries(deviceAction),
      slaPlans: Object.fromEntries(slaAction),
      tickets: tickets.map((row) => Number(row.id)),
    },
    ready: errors.length === 0 && blocked.every((item) => item.acknowledged) && Object.values(counts).some((n) => n > 0),
  };
}

// What the approver and history pages show; the selection stays server-side.
export function planSummary(plan) {
  const { selection, ...rest } = plan;
  return rest;
}

export function significantChange(before, after) {
  if (!before || !after) return true;
  if ((after.errors || []).length) return true;
  for (const [key, was] of Object.entries(before.counts || {})) {
    const now = Number(after.counts?.[key]) || 0;
    if (Math.abs(now - was) > Math.max(2, Math.ceil(was * 0.1))) return true;
  }
  const keys = (list) => new Set((list || []).map((item) => item.key));
  const oldConflicts = keys(before.conflicts);
  if ((after.conflicts || []).some((item) => !oldConflicts.has(item.key))) return true;
  const oldBlocked = keys(before.blocked);
  return (after.blocked || []).some((item) => !oldBlocked.has(item.key));
}

export function requestFingerprint({ scope, mode, scheduleAt, resolutions, acknowledged }) {
  const sorted = (object) => Object.fromEntries(Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    scope: sorted(scope),
    mode,
    scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
    resolutions: sorted(resolutions),
    acknowledged: [...(acknowledged || [])].sort(),
  });
}

export function approvalSummary(approvals, requestedBy) {
  const live = (approvals || []).filter((row) => !row.cleared_at);
  const byRole = Object.fromEntries(APPROVAL_ROLES.map((role) => [role, live.find((row) => row.role === role) || null]));
  const declined = live.find((row) => row.decision === "declined") || null;
  const complete = !declined
    && APPROVAL_ROLES.every((role) => byRole[role]?.decision === "approved")
    && Number(byRole.platform_admin.user_id) !== Number(requestedBy);
  return { byRole, declined, complete };
}

// Roles this user may still decide on this request.
export function eligibleRoles({ user, request, sourceApprovers = [], targetApprovers = [], approvals = [] }) {
  if (!user || user.impersonating) return [];
  const { byRole } = approvalSummary(approvals, request.requested_by);
  const roles = [];
  if (user.isPlatformAdmin && Number(user.id) !== Number(request.requested_by)) roles.push("platform_admin");
  if (!user.isPlatformAdmin && sourceApprovers.map(Number).includes(Number(user.id))) roles.push("source_owner");
  if (!user.isPlatformAdmin && targetApprovers.map(Number).includes(Number(user.id))) roles.push("target_owner");
  return roles.filter((role) => !byRole[role]);
}

export function isExpired(request, now = new Date()) {
  if (request.status !== "pending") return false;
  return now.getTime() - new Date(request.submitted_at).getTime() > EXPIRY_DAYS * DAY_MS;
}

export function rollbackOpen(request, now = new Date()) {
  if (request.status !== "completed" || request.purged_at) return false;
  if (request.mode === "copy") return true;
  return now.getTime() - new Date(request.completed_at).getTime() < ROLLBACK_DAYS * DAY_MS;
}

export function purgeDue(request, now = new Date()) {
  return request.status === "completed" && request.mode === "move" && !request.purged_at
    && now.getTime() - new Date(request.completed_at).getTime() >= ROLLBACK_DAYS * DAY_MS;
}

export function renamed(name, taken = []) {
  const used = new Set(taken.map(lower));
  let candidate = `${name}${RENAME_SUFFIX}`;
  for (let n = 2; used.has(lower(candidate)); n += 1) candidate = `${name} (migrated ${n})`;
  return candidate;
}
