// SLA clock maths. Pure: no database, so the ticket list, dashboard, sweeps and reports agree.
// Business hours are in South African time, which has no daylight saving, so a fixed UTC+2 offset is exact.

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const OFFSET = 2 * 60 * MINUTE;
const MAX_DAYS = 3 * 366;

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const DEFAULT_PRIORITY_PERCENT = { low: 100, normal: 100, high: 100, urgent: 100 };
export const DEFAULT_HOURS = {
  mon: [["08:00", "17:00"]],
  tue: [["08:00", "17:00"]],
  wed: [["08:00", "17:00"]],
  thu: [["08:00", "17:00"]],
  fri: [["08:00", "17:00"]],
  sat: [],
  sun: [],
};
// A target is "soon" when less than this share of it is left.
export const WARN_SHARE = 0.25;

function clockMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return String(value) === "24:00" ? 1440 : null;
}

// Returns { value: { mon: [["08:00","17:00"]], ... } } or { error }.
export function parseHours(input) {
  const out = {};
  for (const day of WEEKDAYS) {
    const list = Array.isArray(input?.[day]) ? input[day] : [];
    const windows = [];
    for (const pair of list.slice(0, 4)) {
      if (!Array.isArray(pair) || pair.length !== 2) return { error: "Each opening time needs a start and an end." };
      const start = clockMinutes(pair[0]);
      const end = clockMinutes(pair[1]);
      if (start == null || end == null) return { error: "Use 24-hour times such as 08:00 and 17:00." };
      if (end <= start) return { error: "Each closing time must be after its opening time." };
      windows.push([String(pair[0]), String(pair[1])]);
    }
    windows.sort((a, b) => clockMinutes(a[0]) - clockMinutes(b[0]));
    for (let i = 1; i < windows.length; i += 1) {
      if (clockMinutes(windows[i][0]) < clockMinutes(windows[i - 1][1])) return { error: "Opening times on the same day overlap." };
    }
    out[day] = windows;
  }
  return { value: out };
}

export function percentFrom(input) {
  const out = { ...DEFAULT_PRIORITY_PERCENT };
  for (const key of PRIORITIES) {
    const value = Number(input?.[key]);
    if (Number.isInteger(value) && value >= 5 && value <= 500) out[key] = value;
  }
  return out;
}

// Strict form for user input: { value } or { error }. Missing input keeps the defaults.
export function parsePercent(input) {
  if (input == null) return { value: { ...DEFAULT_PRIORITY_PERCENT } };
  if (typeof input !== "object") return { error: "Priority percentages must be numbers." };
  const out = {};
  for (const key of PRIORITIES) {
    const value = input[key] == null || input[key] === "" ? 100 : Number(input[key]);
    if (!Number.isInteger(value) || value < 5 || value > 500) {
      return { error: "Each priority percentage must be a whole number from 5 to 500." };
    }
    out[key] = value;
  }
  return { value: out };
}

function localDay(ms) {
  return Math.floor((ms + OFFSET) / DAY) * DAY - OFFSET;
}

function dayLabel(dayStart) {
  return new Date(dayStart + OFFSET).toISOString().slice(0, 10);
}

function weekday(dayStart) {
  return WEEKDAYS[new Date(dayStart + OFFSET).getUTCDay()];
}

// null means "around the clock". holidays: iterable of "YYYY-MM-DD".
export function calendarFrom(hours, holidays = []) {
  if (!hours) return null;
  const windows = {};
  let any = false;
  for (const day of WEEKDAYS) {
    windows[day] = (hours[day] || [])
      .map(([start, end]) => [clockMinutes(start) * MINUTE, clockMinutes(end) * MINUTE])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);
    if (windows[day].length) any = true;
  }
  if (!any) return null;
  return { windows, holidays: new Set([...holidays].map(String)) };
}

function dayWindows(cal, dayStart) {
  if (cal.holidays.has(dayLabel(dayStart))) return [];
  return cal.windows[weekday(dayStart)].map(([start, end]) => [dayStart + start, dayStart + end]);
}

function ms(value) {
  if (value == null || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function businessMinutes(from, to, cal) {
  const start = ms(from);
  const end = ms(to);
  if (start == null || end == null || end <= start) return 0;
  if (!cal) return Math.floor((end - start) / MINUTE);
  let total = 0;
  let days = 0;
  for (let day = localDay(start); day < end && days < MAX_DAYS; day += DAY, days += 1) {
    for (const [open, close] of dayWindows(cal, day)) {
      const overlap = Math.min(close, end) - Math.max(open, start);
      if (overlap > 0) total += overlap;
    }
  }
  return Math.floor(total / MINUTE);
}

export function addBusinessMinutes(from, minutes, cal) {
  const start = ms(from);
  if (start == null) return null;
  const amount = Math.max(0, Number(minutes) || 0) * MINUTE;
  if (!cal) return new Date(start + amount);
  let left = amount;
  let days = 0;
  for (let day = localDay(start); days < MAX_DAYS; day += DAY, days += 1) {
    for (const [open, close] of dayWindows(cal, day)) {
      const begin = Math.max(open, start);
      if (close <= begin) continue;
      if (left <= close - begin) return new Date(begin + left);
      left -= close - begin;
    }
  }
  return new Date(start + amount);
}

export function targetsFor(sla, priority) {
  if (!sla) return null;
  const percent = (sla.priorityPercent || DEFAULT_PRIORITY_PERCENT)[priority] ?? 100;
  const scale = (minutes) => Math.max(1, Math.round((Number(minutes) * percent) / 100));
  return { responseMinutes: scale(sla.responseMinutes), resolveMinutes: scale(sla.resolveMinutes), percent };
}

function field(row, camel, snake) {
  return row?.[camel] !== undefined ? row[camel] : row?.[snake];
}

// Accepts API views (camelCase) and database rows (snake_case).
export function clockInput(row) {
  return {
    createdAt: field(row, "createdAt", "created_at"),
    status: field(row, "status", "status"),
    priority: field(row, "priority", "priority") || "normal",
    firstResponseAt: field(row, "firstResponseAt", "first_response_at") || null,
    resolvedAt: field(row, "resolvedAt", "resolved_at") || field(row, "updatedAt", "updated_at") || null,
    dueAt: field(row, "dueAt", "due_at") || null,
    pausedAt: field(row, "pausedAt", "sla_paused_at") || null,
    pauses: Array.isArray(field(row, "pauses", "sla_pauses")) ? field(row, "pauses", "sla_pauses") : [],
  };
}

export function ticketClock(row, sla, now = new Date()) {
  const ticket = clockInput(row);
  if (!sla || !ticket.createdAt) return null;
  const cal = sla.calendar || null;
  const targets = targetsFor(sla, ticket.priority);
  const resolved = ticket.status === "resolved";
  const stopAt = resolved ? ticket.resolvedAt || now : now;
  const paused = !resolved && ticket.status === "pending" && Boolean(ticket.pausedAt);
  let pausedMinutes = paused ? businessMinutes(ticket.pausedAt, now, cal) : 0;
  for (const pair of ticket.pauses) {
    if (Array.isArray(pair)) pausedMinutes += businessMinutes(pair[0], pair[1], cal);
  }
  const responseStop = ticket.firstResponseAt || stopAt;
  const resolveDue = ticket.dueAt
    ? new Date(ticket.dueAt)
    : addBusinessMinutes(ticket.createdAt, targets.resolveMinutes + pausedMinutes, cal);
  return {
    responseMinutes: targets.responseMinutes,
    resolveMinutes: targets.resolveMinutes,
    priorityPercent: targets.percent,
    responseElapsed: businessMinutes(ticket.createdAt, responseStop, cal),
    resolveElapsed: Math.max(0, businessMinutes(ticket.createdAt, stopAt, cal) - pausedMinutes),
    responseDueAt: addBusinessMinutes(ticket.createdAt, targets.responseMinutes, cal),
    resolveDueAt: resolveDue,
    dueOverridden: Boolean(ticket.dueAt),
    responded: Boolean(ticket.firstResponseAt),
    resolved,
    paused,
    pausedMinutes,
    businessHours: Boolean(cal),
  };
}

export function ticketDue(row, sla, now = new Date()) {
  if (!sla || clockInput(row).status === "resolved") return null;
  return ticketClock(row, sla, now)?.resolveDueAt || null;
}

// The one overdue rule: not resolved, not paused, and past the resolution due time.
export function isOverdue(row, sla, now = new Date()) {
  const clock = ticketClock(row, sla, now);
  if (!clock || clock.resolved || clock.paused) return false;
  return clock.resolveDueAt.getTime() < now.getTime();
}

const STATE_RANK = { breached: 0, soon: 1, ok: 2, paused: 3, none: 4 };

export function slaState(row, sla, now = new Date()) {
  const clock = ticketClock(row, sla, now);
  if (!clock || clock.resolved) return { state: "none" };
  const checks = [];
  if (!clock.responded) {
    checks.push({ target: "response", total: clock.responseMinutes, elapsed: clock.responseElapsed, dueAt: clock.responseDueAt });
  }
  if (clock.paused) {
    if (!checks.length) return { state: "paused", target: "resolve" };
  } else {
    checks.push({ target: "resolve", total: clock.resolveMinutes, elapsed: clock.resolveElapsed, dueAt: clock.resolveDueAt });
  }
  let worst = null;
  for (const check of checks) {
    let left = check.total - check.elapsed;
    if (check.target === "resolve" && clock.dueOverridden) left = Math.round((check.dueAt.getTime() - now.getTime()) / MINUTE);
    const state = left < 0 ? "breached" : left < check.total * WARN_SHARE ? "soon" : "ok";
    const candidate = { state, target: check.target, dueAt: check.dueAt.toISOString(), minutesLeft: left };
    if (!worst || STATE_RANK[state] < STATE_RANK[worst.state] || (state === worst.state && check.dueAt.toISOString() < worst.dueAt)) {
      worst = candidate;
    }
  }
  return worst || { state: "none" };
}

export const SLA_STATE_RANK = STATE_RANK;

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

// Public Holidays Act: a holiday on a Sunday moves to the Monday.
export function zaHolidays(year) {
  const iso = (time) => new Date(time).toISOString().slice(0, 10);
  const fixed = [
    ["01-01", "New Year's Day"],
    ["03-21", "Human Rights Day"],
    ["04-27", "Freedom Day"],
    ["05-01", "Workers' Day"],
    ["06-16", "Youth Day"],
    ["08-09", "National Women's Day"],
    ["09-24", "Heritage Day"],
    ["12-16", "Day of Reconciliation"],
    ["12-25", "Christmas Day"],
    ["12-26", "Day of Goodwill"],
  ].map(([date, name]) => ({ day: `${year}-${date}`, name }));
  const easter = easterSunday(year);
  const list = [
    ...fixed,
    { day: iso(easter - 2 * DAY), name: "Good Friday" },
    { day: iso(easter + DAY), name: "Family Day" },
  ];
  const taken = new Set(list.map((item) => item.day));
  for (const item of [...list]) {
    if (new Date(`${item.day}T00:00:00Z`).getUTCDay() !== 0) continue;
    let monday = Date.parse(`${item.day}T00:00:00Z`) + DAY;
    while (taken.has(iso(monday))) monday += DAY;
    taken.add(iso(monday));
    list.push({ day: iso(monday), name: `${item.name} (observed)` });
  }
  return list.sort((a, b) => a.day.localeCompare(b.day));
}
