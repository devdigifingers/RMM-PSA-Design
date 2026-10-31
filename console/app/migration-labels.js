export const MIGRATION_STATUS = {
  draft: "Draft",
  pending: "Waiting for approval",
  approved: "Approved",
  scheduled: "Scheduled",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  rolled_back: "Rolled back",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const MIGRATION_TABS = [
  ["pending", "Waiting"],
  ["scheduled", "Scheduled"],
  ["running", "Running"],
  ["completed", "Completed"],
  ["rolled_back", "Rolled back"],
  ["closed", "Closed"],
];

export const MODE_LABEL = { copy: "Copy", move: "Move" };

export const SCOPE_LABEL = {
  customers: "Customers and contacts",
  tickets: "Tickets with their history",
  devices: "Devices",
  settings: "Desk settings and SLA plans",
  users: "Users (listed only)",
};

const COUNT_LABEL = [
  ["customers", "new customers", "new customer"],
  ["customersMerged", "customers merged", "customer merged"],
  ["customersSkipped", "customers skipped", "customer skipped"],
  ["contacts", "new contacts", "new contact"],
  ["contactsMerged", "contacts merged", "contact merged"],
  ["devices", "devices", "device"],
  ["tickets", "tickets", "ticket"],
  ["comments", "comments", "comment"],
  ["attachments", "attachments", "attachment"],
  ["timeEntries", "time entries", "time entry"],
  ["activity", "timeline events", "timeline event"],
  ["slaPlans", "SLA plans", "SLA plan"],
  ["settings", "desk settings", "desk setting"],
];

export function countLines(counts = {}) {
  return COUNT_LABEL.filter(([key]) => Number(counts[key]) > 0).map(([key, many, one]) => `${counts[key]} ${Number(counts[key]) === 1 ? one : many}`);
}

export function scopeLine(scope = {}) {
  const parts = Object.keys(SCOPE_LABEL).filter((key) => scope[key]).map((key) => SCOPE_LABEL[key]);
  const which = scope.customerIds?.length ? ` · ${scope.customerIds.length} chosen customer${scope.customerIds.length === 1 ? "" : "s"}` : "";
  return `${parts.join(", ") || "Nothing"}${which}`;
}

export function statusLevel(status) {
  if (["failed", "declined", "expired", "cancelled"].includes(status)) return " is-full";
  if (["pending", "approved", "scheduled", "running"].includes(status)) return " is-near";
  return "";
}

const EVENT_LABEL = {
  submitted: "Request submitted",
  edited: "Request changed",
  approve: "Approved",
  decline: "Declined",
  approved_all: "All approvals in",
  cancelled: "Cancelled",
  expired: "Expired without all approvals",
  started: "Started",
  waiting_sessions: "Waiting for live sessions to end",
  approvals_missing: "Stopped: approvals no longer complete",
  changed_since_approval: "Sent back for approval: the data changed since the dry run",
  completed: "Completed",
  devices_repointed: "Devices re-pointed in remote access",
  failed: "Failed, nothing was changed",
  interrupted: "Interrupted by a restart, nothing was changed",
  rollback_requested: "Rollback requested",
  rollback_approved: "Rollback approved",
  rollback_cancelled: "Rollback request withdrawn",
  rolled_back: "Rolled back",
  rollback_failed: "Rollback failed",
  purged: "Source copies removed",
};

const SAST_MS = 2 * 3600000;

// datetime-local value in Johannesburg time (UTC+2, no daylight saving).
export function sastInput(value) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + SAST_MS).toISOString().slice(0, 16);
}

export function fromSastInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || "")) return null;
  return new Date(`${value}:00+02:00`).toISOString();
}

export function nextAfterHours(now = new Date()) {
  const local = new Date(now.getTime() + SAST_MS);
  const run = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 17));
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run.toISOString();
}

export function eventLabel(kind) {
  return EVENT_LABEL[kind] || kind.replace(/_/g, " ");
}
