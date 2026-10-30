export const PRIORITY_KEYS = ["low", "normal", "high", "urgent"];
export const BASE_STATUSES = [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"]];
export const CHANNEL_CHOICES = [
  ["phone", "Phone"],
  ["email", "Email"],
  ["walk_in", "Walk-in"],
  ["portal", "Portal"],
  ["remote", "Remote session"],
];

const SA_OFFSET = 2 * 60 * 60 * 1000;

// Value for <input type="datetime-local">, in South African time.
export function dueInputValue(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  return new Date(time + SA_OFFSET).toISOString().slice(0, 16);
}

export function dueLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
}

// Custom statuses are sent as "status:<id>" and sit under the base status they count as.
export function StatusOptions({ statuses = [] }) {
  return BASE_STATUSES.map(([base, label]) => {
    const custom = statuses.filter((item) => item.base === base);
    if (!custom.length) return <option key={base} value={base}>{label}</option>;
    return (
      <optgroup key={base} label={label}>
        <option value={base}>{label}</option>
        {custom.map((item) => (
          <option key={item.id} value={`status:${item.id}`}>{item.name}</option>
        ))}
      </optgroup>
    );
  });
}

export function statusValue(ticket) {
  return ticket?.statusId ? `status:${ticket.statusId}` : ticket?.status || "open";
}
