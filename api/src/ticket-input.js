// Pure parsers for the New Ticket fields added in Service Desk phase 3.

export const MANUAL_CHANNELS = ["phone", "email", "walk_in", "portal", "remote"];
const MAX_CC = 20;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;
const STOP_WORDS = new Set(["the", "and", "for", "not", "with", "from", "this", "that", "has", "have", "are", "was", "cant", "can't", "won't", "does", "doesn't", "please", "help", "issue", "problem"]);

// Accepts an ISO time or a datetime-local value ("2026-10-29T14:30"), which is read as South African time.
export function parseDueAt(value, now = new Date()) {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: "Choose a due date and time." };
  const text = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value}+02:00` : value;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return { error: "Choose a due date and time." };
  if (date.getTime() < now.getTime() - YEAR_MS || date.getTime() > now.getTime() + 5 * YEAR_MS) {
    return { error: "Choose a due date within the next five years." };
  }
  return { value: date };
}

export function parseChannel(value) {
  if (value == null || value === "") return { value: null };
  if (!MANUAL_CHANNELS.includes(value)) return { error: "Choose how the request came in." };
  return { value };
}

export function parseCc(value) {
  if (value == null || value === "") return { value: [] };
  const list = Array.isArray(value) ? value : String(value).split(",");
  const ids = [...new Set(list.map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0))];
  if (ids.length > MAX_CC) return { error: `Copy at most ${MAX_CC} contacts.` };
  return { value: ids };
}

export function parseStatusId(value) {
  if (value == null || value === "") return { value: null };
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Choose a status." };
  return { value: id };
}

export function subjectWords(subject) {
  return new Set(
    String(subject || "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

// Open tickets on the same customer whose subject shares most of its words with the new one.
export function similarTickets(rows, subject, limit = 5) {
  const words = subjectWords(subject);
  if (!words.size) return [];
  const scored = [];
  for (const row of rows) {
    const other = subjectWords(row.subject);
    if (!other.size) continue;
    let shared = 0;
    for (const word of words) if (other.has(word)) shared += 1;
    const score = shared / Math.min(words.size, other.size);
    if (shared >= 1 && score >= 0.5) scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id))
    .slice(0, limit)
    .map((item) => item.row);
}
