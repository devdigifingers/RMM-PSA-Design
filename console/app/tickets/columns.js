export const COLUMN_LABELS = {
  sla: "SLA",
  id: "ID",
  subject: "Subject",
  contact: "Contact Name",
  account: "Account",
  device: "Device",
  category: "Category",
  tags: "Tags",
  created: "Created",
  lastActivity: "Last Activity",
  due: "Due Date",
  status: "Status",
  priority: "Priority",
  owner: "Ticket Owner",
  channel: "Channel",
};

export const VIEW_LABELS = {
  all: "All Tickets",
  mine: "My Open Tickets",
  unassigned: "Unassigned Open Tickets",
  open: "Open Tickets",
  pending: "Pending Tickets",
  overdue: "Overdue Tickets",
  resolved: "Resolved Tickets",
};

export const STATUS_LABELS = { open: "Open", pending: "Pending", resolved: "Resolved" };
export const PRIORITY_LABELS = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const CHANNEL_LABELS = { console: "Console", alert: "Alert", automatic: "Automatic", support: "Remote Support" };
export const SLA_LABELS = { ok: "On track", soon: "Due soon", breached: "Breached" };

export const LIST_PARAMS = [
  "view", "q", "status", "priority", "owner", "customer", "device", "channel", "category", "tag",
  "created_from", "created_to", "due_from", "due_to", "sla", "sort", "dir", "page",
];

export const FILTER_PARAMS = [
  "status", "priority", "owner", "customer", "device", "channel", "category", "tag",
  "created_from", "created_to", "due_from", "due_to", "sla",
];

export function shortcutBlocked(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  if (!target || target === document.body) return false;
  if (event.key === "Enter" && ["A", "BUTTON", "INPUT"].includes(target.tagName)) return true;
  if (target.tagName === "INPUT" && (target.type === "checkbox" || target.type === "radio")) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    || Boolean(target.closest?.("dialog[open], .desk-pop"));
}

export function duration(minutes) {
  const total = Math.abs(Math.round(minutes));
  if (total < 60) return `${total}m`;
  if (total < 48 * 60) return `${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}`;
  return `${Math.floor(total / 1440)}d`;
}
