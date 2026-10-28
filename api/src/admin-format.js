export class InputError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function csvCell(value) {
  let cell = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function dayBound(value, end) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError("Use a valid date.");
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}+02:00`);
  if (Number.isNaN(date.getTime())) throw new InputError("Use a valid date.");
  return date.toISOString();
}

export function noticeState(row, now = Date.now()) {
  if (!row.active) return "unpublished";
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return "scheduled";
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "ended";
  return "live";
}
