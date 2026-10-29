export const PAGE_SIZE = 50;
export const EXPORT_LIMIT = 5000;

export const LIST_COLUMNS = [
  "sla",
  "id",
  "subject",
  "contact",
  "account",
  "device",
  "category",
  "tags",
  "created",
  "lastActivity",
  "due",
  "status",
  "priority",
  "owner",
  "channel",
];

export const DEFAULT_COLUMNS = ["sla", "id", "subject", "contact", "account", "device", "lastActivity", "due", "status", "priority", "owner", "channel"];

const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
const STATUS_RANK = { open: 0, pending: 1, resolved: 2 };
const SLA_RANK = { breached: 0, soon: 1, ok: 2, none: 3 };
const STATUSES = new Set(["open", "pending", "resolved"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CHANNELS = new Set(["console", "alert", "automatic", "support"]);
const SLA_STATES = new Set(["ok", "soon", "breached"]);
const DAY = 24 * 60 * 60 * 1000;

export const BUILTIN_VIEWS = [
  { id: "all", match: () => true },
  { id: "mine", match: (ticket, me) => ticket.assignee?.id === me && ticket.status !== "resolved" },
  { id: "unassigned", match: (ticket) => !ticket.assignee && ticket.status !== "resolved" },
  { id: "open", match: (ticket) => ticket.status === "open" },
  { id: "pending", match: (ticket) => ticket.status === "pending" },
  { id: "overdue", match: (ticket) => ticket.overdue },
  { id: "resolved", match: (ticket) => ticket.status === "resolved" },
];

const SORT_KEYS = {
  id: (ticket) => ticket.id,
  subject: (ticket) => text(ticket.subject),
  contact: (ticket) => text(ticket.customer?.contactName),
  account: (ticket) => text(ticket.customer?.name),
  device: (ticket) => text(ticket.device?.hostname),
  category: (ticket) => text(ticket.category),
  tags: (ticket) => text((ticket.tags || []).join(",")),
  created: (ticket) => time(ticket.createdAt),
  lastActivity: (ticket) => time(ticket.lastActivityAt),
  due: (ticket) => (ticket.dueAt ? time(ticket.dueAt) : Number.MAX_SAFE_INTEGER),
  sla: (ticket) => SLA_RANK[ticket.sla?.state || "none"] * 1e15 + (ticket.sla?.dueAt ? time(ticket.sla.dueAt) : 0),
  status: (ticket) => STATUS_RANK[ticket.status] ?? 9,
  priority: (ticket) => PRIORITY_RANK[ticket.priority] ?? -1,
  owner: (ticket) => text(ticket.assignee?.name) || "\uffff",
  channel: (ticket) => text(ticket.channel),
};

export const SORTABLE = new Set(Object.keys(SORT_KEYS));

function text(value) {
  return String(value || "").toLowerCase();
}

function time(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function list(value, allowed) {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter((item) => allowed.has(item)))];
}

function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function day(value, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const start = new Date(`${value}T00:00:00+02:00`);
  if (!Number.isFinite(start.getTime())) return null;
  return end ? new Date(start.getTime() + DAY) : start;
}

export function parseListQuery(params) {
  const get = (key) => (typeof params.get === "function" ? params.get(key) : params[key]) ?? "";
  const owner = String(get("owner"));
  const sort = SORTABLE.has(String(get("sort"))) ? String(get("sort")) : "lastActivity";
  const dirRaw = String(get("dir"));
  const page = Number(get("page"));
  return {
    view: BUILTIN_VIEWS.some((view) => view.id === get("view")) ? String(get("view")) : "all",
    q: String(get("q")).trim().slice(0, 100),
    status: list(get("status"), STATUSES),
    priority: list(get("priority"), PRIORITIES),
    owner: owner === "me" || owner === "none" ? owner : id(owner),
    customer: id(get("customer")),
    device: id(get("device")),
    channel: CHANNELS.has(String(get("channel"))) ? String(get("channel")) : null,
    category: String(get("category")).trim().slice(0, 60) || null,
    tag: String(get("tag")).trim().slice(0, 30) || null,
    createdFrom: day(get("created_from"), false),
    createdTo: day(get("created_to"), true),
    dueFrom: day(get("due_from"), false),
    dueTo: day(get("due_to"), true),
    sla: SLA_STATES.has(String(get("sla"))) ? String(get("sla")) : null,
    sort,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "lastActivity" || sort === "created" || sort === "id" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function slaState(ticket, targets, now = new Date()) {
  if (!targets || ticket.status === "resolved" || !ticket.createdAt) return { state: "none" };
  const created = time(ticket.createdAt);
  const checks = [];
  if (!ticket.firstResponseAt) checks.push({ target: "response", minutes: targets.responseMinutes });
  checks.push({ target: "resolve", minutes: targets.resolveMinutes });
  let worst = null;
  for (const check of checks) {
    const total = Number(check.minutes) * 60000;
    if (!(total > 0)) continue;
    const due = created + total;
    const left = due - now.getTime();
    const state = left < 0 ? "breached" : left < total * 0.25 ? "soon" : "ok";
    const candidate = { state, target: check.target, dueAt: new Date(due).toISOString(), minutesLeft: Math.round(left / 60000) };
    if (!worst || SLA_RANK[state] < SLA_RANK[worst.state] || (state === worst.state && due < time(worst.dueAt))) worst = candidate;
  }
  return worst || { state: "none" };
}

function matchesSearch(ticket, needle) {
  if (!needle) return true;
  return [
    String(ticket.id),
    ticket.subject,
    ticket.customer?.name,
    ticket.customer?.contactName,
    ticket.device?.hostname,
    ticket.assignee?.name,
    ticket.category,
    ...(ticket.tags || []),
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

function inRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const ms = time(value);
  return (!from || ms >= from.getTime()) && (!to || ms < to.getTime());
}

export function filterTickets(tickets, filters, me) {
  const view = BUILTIN_VIEWS.find((item) => item.id === filters.view) || BUILTIN_VIEWS[0];
  const needle = filters.q.toLowerCase().replace(/^#/, "");
  const tag = filters.tag?.toLowerCase();
  const category = filters.category?.toLowerCase();
  return tickets.filter((ticket) => view.match(ticket, me)
    && matchesSearch(ticket, needle)
    && (!filters.status.length || filters.status.includes(ticket.status))
    && (!filters.priority.length || filters.priority.includes(ticket.priority))
    && (filters.owner == null
      || (filters.owner === "me" && ticket.assignee?.id === me)
      || (filters.owner === "none" && !ticket.assignee)
      || (typeof filters.owner === "number" && ticket.assignee?.id === filters.owner))
    && (filters.customer == null || ticket.customer?.id === filters.customer)
    && (filters.device == null || ticket.device?.id === filters.device)
    && (!filters.channel || ticket.channel === filters.channel)
    && (!category || text(ticket.category) === category)
    && (!tag || (ticket.tags || []).some((item) => item.toLowerCase() === tag))
    && inRange(ticket.createdAt, filters.createdFrom, filters.createdTo)
    && inRange(ticket.dueAt, filters.dueFrom, filters.dueTo)
    && (!filters.sla || ticket.sla?.state === filters.sla));
}

export function viewCounts(tickets, me) {
  return Object.fromEntries(BUILTIN_VIEWS.map((view) => [view.id, tickets.filter((ticket) => view.match(ticket, me)).length]));
}

export function sortTickets(tickets, sort, dir) {
  const key = SORT_KEYS[sort] || SORT_KEYS.lastActivity;
  const sign = dir === "asc" ? 1 : -1;
  return tickets.slice().sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -sign;
    if (left > right) return sign;
    return b.id - a.id;
  });
}

export function pageOf(tickets, page) {
  const pages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: tickets.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    total: tickets.length,
  };
}

export function cleanColumns(value) {
  if (!Array.isArray(value)) return null;
  const columns = [...new Set(value.map(String))].filter((column) => LIST_COLUMNS.includes(column));
  if (!columns.includes("subject")) return null;
  return columns;
}

export function cleanCategory(value) {
  const category = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return category || null;
}

export function cleanTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const tags = [];
  for (const item of raw) {
    const tag = String(item ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === 10) break;
  }
  return tags;
}

export function cleanViewQuery(value) {
  const params = new URLSearchParams(String(value || "").replace(/^\?/, ""));
  const keep = new URLSearchParams();
  for (const key of ["view", "q", "status", "priority", "owner", "customer", "device", "channel", "category", "tag", "created_from", "created_to", "due_from", "due_to", "sla", "sort", "dir"]) {
    const item = params.get(key);
    if (item) keep.set(key, item.slice(0, 200));
  }
  return keep.toString();
}

export function csvCell(value) {
  const raw = String(value ?? "");
  const text = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const CSV_COLUMNS = [
  ["ID", (ticket) => ticket.id],
  ["Subject", (ticket) => ticket.subject],
  ["Status", (ticket) => ticket.status],
  ["Priority", (ticket) => ticket.priority],
  ["Customer", (ticket) => ticket.customer?.name],
  ["Contact", (ticket) => ticket.customer?.contactName],
  ["Device", (ticket) => ticket.device?.hostname],
  ["Owner", (ticket) => ticket.assignee?.name],
  ["Category", (ticket) => ticket.category],
  ["Tags", (ticket) => (ticket.tags || []).join("; ")],
  ["Channel", (ticket) => ticket.channel],
  ["SLA", (ticket) => ticket.sla?.state === "none" ? "" : ticket.sla?.state],
  ["Created", (ticket) => ticket.createdAt ? new Date(ticket.createdAt).toISOString() : ""],
  ["Last activity", (ticket) => ticket.lastActivityAt ? new Date(ticket.lastActivityAt).toISOString() : ""],
  ["Due", (ticket) => ticket.dueAt || ""],
];

export function ticketsCsv(tickets) {
  const lines = [CSV_COLUMNS.map(([label]) => csvCell(label)).join(",")];
  for (const ticket of tickets) lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(ticket))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
