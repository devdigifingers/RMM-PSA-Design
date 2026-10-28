export const EVENT_GROUPS = {
  created: "changes",
  status: "changes",
  priority: "changes",
  assignee: "changes",
  contact: "changes",
  device: "changes",
  reply: "replies",
  note: "notes",
  sla_breach: "sla",
  remote_start: "remote",
  remote_end: "remote",
  command: "remote",
  command_result: "remote",
  time: "time",
  time_removed: "time",
  email: "email",
};

export const TIMELINE_FILTERS = ["all", "replies", "notes", "changes", "remote", "time", "sla", "email"];

// Only these kinds may ever reach a customer (emails, portal); everything else is internal.
const CUSTOMER_KINDS = new Set(["created", "reply", "status"]);

const CHANGE_FIELDS = [
  ["status", "status"],
  ["priority", "priority"],
  ["assignee", "assigneeUserId"],
  ["contact", "contactId"],
  ["device", "deviceId"],
];

export const ATTACHMENT_LIMIT = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_POST = 10;

export function eventGroup(kind) {
  return EVENT_GROUPS[kind] || "changes";
}

export function timelineFilter(value) {
  return TIMELINE_FILTERS.includes(value) ? value : "all";
}

function idOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

// Fields missing from `after` were not part of the change and are skipped.
export function ticketChanges(before, after) {
  const changes = [];
  for (const [kind, key] of CHANGE_FIELDS) {
    if (!Object.hasOwn(after, key)) continue;
    const numeric = key !== "status" && key !== "priority";
    const from = numeric ? idOrNull(before[key]) : before[key] ?? null;
    const to = numeric ? idOrNull(after[key]) : after[key] ?? null;
    if (from !== to) changes.push({ kind, from, to });
  }
  return changes;
}

export function actorName(row) {
  return row.actor_name || row.actor_label || "System";
}

export function commentAuthor(row) {
  return row.author_name || row.author_label || "System";
}

export function timelineItem(row, lookups = {}) {
  const detail = row.detail || {};
  const item = {
    id: Number(row.id),
    kind: row.kind,
    group: eventGroup(row.kind),
    actor: actorName(row),
    automatic: row.actor_user_id == null,
    createdAt: row.created_at,
  };
  if (row.kind === "reply" || row.kind === "note") {
    const comment = lookups.comments?.get(Number(detail.commentId));
    item.body = comment ? comment.body : "";
    item.attachments = lookups.attachments?.get(Number(detail.commentId)) || [];
    return item;
  }
  if (row.kind === "assignee") {
    item.from = userLabel(lookups.users, detail.from);
    item.to = userLabel(lookups.users, detail.to);
    return item;
  }
  if (row.kind === "contact") {
    item.from = lookups.contacts?.get(idOrNull(detail.from)) || (idOrNull(detail.from) == null ? null : "a removed contact");
    item.to = lookups.contacts?.get(idOrNull(detail.to)) || (idOrNull(detail.to) == null ? null : "a removed contact");
    return item;
  }
  if (row.kind === "device") {
    item.from = lookups.devices?.get(idOrNull(detail.from)) || (idOrNull(detail.from) == null ? null : "another device");
    item.to = lookups.devices?.get(idOrNull(detail.to)) || (idOrNull(detail.to) == null ? null : "another device");
    return item;
  }
  if (row.kind === "remote_start") {
    item.device = lookups.devices?.get(idOrNull(detail.deviceId)) || null;
    item.user = detail.user || null;
    return item;
  }
  for (const key of ["from", "to", "minutes", "billable", "note", "command", "exitCode", "output", "template", "target", "subject"]) {
    if (Object.hasOwn(detail, key)) item[key] = detail[key];
  }
  return item;
}

function userLabel(users, value) {
  const id = idOrNull(value);
  if (id == null) return null;
  return users?.get(id) || "a removed user";
}

export function publicTimeline(items) {
  return items.filter((item) => CUSTOMER_KINDS.has(item.kind)).map((item) => {
    const { attachments, ...rest } = item;
    return item.kind === "reply" ? { ...rest, attachments: attachments || [] } : rest;
  });
}

const IMAGE_SIGNATURES = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];

// Only sniffed raster formats are ever served inline; SVG and everything else download.
export function imageType(head) {
  if (!head || head.length < 12) return null;
  for (const [type, bytes] of IMAGE_SIGNATURES) {
    if (bytes.every((byte, index) => head[index] === byte)) return type;
  }
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function safeFileName(value) {
  const base = String(value || "").split(/[\\/]/).pop() || "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").trim().slice(0, 120);
  return clean && clean !== "." && clean !== ".." ? clean : "attachment";
}

export function storedContentType(value) {
  const type = String(value || "").toLowerCase().split(";")[0].trim();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type) && type.length <= 100 ? type : "application/octet-stream";
}

export function contentDisposition(name, inline) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function attachmentIds(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const ids = [...new Set(list.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
  return ids.length > ATTACHMENTS_PER_POST ? null : ids;
}

export function timeInput(body) {
  const minutes = Number(body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return { error: "Enter between 1 and 1440 minutes." };
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > 500) return { error: "Keep the note under 500 characters." };
  return { minutes, billable: body?.billable !== false, note: note || null };
}

export function timerMinutes(startedAt, now = new Date()) {
  const elapsed = (now.getTime() - new Date(startedAt).getTime()) / 60000;
  return Math.min(1440, Math.max(1, Math.round(elapsed)));
}

export function timeTotals(entries) {
  let total = 0;
  let billable = 0;
  for (const entry of entries) {
    total += Number(entry.minutes) || 0;
    if (entry.billable) billable += Number(entry.minutes) || 0;
  }
  return { totalMinutes: total, billableMinutes: billable };
}
