// Session Panel (DFSupport.exe): the docked panel the customer sees during a remote session. The device agent reports
// whether the panel can run; the connection strip (Mesh consent flag 64) is kept on every device where it can't.
export const PANEL_STATES = ["ready", "silent", "not-installed", "no-webview2", "failed"];
export const STRIP_FLAG = 64;
export const SUPPORT_EVENTS = ["session.pause", "session.resume", "session.end", "panel.opened", "panel.failed"];
// A report older than this is not trusted to hide the strip (the agent reports every 10 seconds).
const REPORT_FRESH_MS = 3 * 60000;

const OPTION_DEFAULTS = Object.freeze({
  enabled: false,
  showToTechnician: false,
  silentWorkstations: false,
  silentServers: true,
  phone: "",
  email: "",
});

function oneLine(value, max) {
  return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "";
}

export function panelReportFrom(body) {
  const raw = body?.supportPanel;
  if (!raw || typeof raw !== "object" || !PANEL_STATES.includes(raw.state)) return null;
  const detail = oneLine(raw.detail, 240);
  return { state: raw.state, ...(detail ? { detail } : {}) };
}

export function panelOptions(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const flag = (key) => (typeof value[key] === "boolean" ? value[key] : OPTION_DEFAULTS[key]);
  return {
    enabled: flag("enabled"),
    showToTechnician: flag("showToTechnician"),
    silentWorkstations: flag("silentWorkstations"),
    silentServers: flag("silentServers"),
    phone: oneLine(value.phone, 40),
    email: oneLine(value.email, 120),
  };
}

export function panelOptionsInput(body, current) {
  const next = { ...panelOptions(current) };
  for (const key of ["enabled", "showToTechnician", "silentWorkstations", "silentServers"]) {
    if (body?.[key] !== undefined) next[key] = body[key] === true;
  }
  if (body?.phone !== undefined) {
    const phone = oneLine(body.phone, 60);
    if (phone && !/^[+()0-9 .-]{6,40}$/.test(phone)) return { error: "Enter a phone number with digits, spaces and + only." };
    next.phone = phone;
  }
  if (body?.email !== undefined) {
    const email = oneLine(body.email, 200).toLowerCase();
    if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: "Enter a valid support email address." };
    next.email = email;
  }
  return { value: next };
}

export function isServerOs(osName) {
  return /server/i.test(String(osName || ""));
}

export function silentFor(options, osName) {
  const opts = panelOptions(options);
  return isServerOs(osName) ? opts.silentServers : opts.silentWorkstations;
}

function freshReport(report, now) {
  const at = Date.parse(report?.at || "");
  return Number.isFinite(at) && now - at < REPORT_FRESH_MS;
}

// Node-level consent for one device: the strip stays unless the panel is ready and the tenant turned the panel on.
export function nodeConsentFor(options, report, now = Date.now()) {
  if (!panelOptions(options).enabled) return 0;
  return report?.state === "ready" && freshReport(report, now) ? 0 : STRIP_FLAG;
}

export function groupConsentFor(options, base) {
  return panelOptions(options).enabled ? base & ~STRIP_FLAG : base | STRIP_FLAG;
}

export function initials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "DF";
  const first = words[0][0] || "";
  const last = words.length > 1 ? words[words.length - 1][0] : words[0][1] || "";
  return (first + last).toUpperCase();
}

export function roleLabel(roles) {
  const list = Array.isArray(roles) ? roles : [];
  if (list.includes("owner")) return "Owner";
  if (list.includes("admin")) return "Administrator";
  return "Technician";
}

// What the device agent hands to the panel. Only display details: no tokens, addresses or ids beyond the session.
export function panelSessionView(row, options) {
  if (!row) return null;
  const name = oneLine(row.technician_name, 120) || "Your technician";
  return {
    id: Number(row.id),
    startedAt: new Date(row.started_at).toISOString(),
    paused: row.paused_at != null,
    tsid: Number.isInteger(row.tsid) ? row.tsid : null,
    mode: "control",
    technician: { name, initials: initials(name), role: roleLabel(row.technician_roles) },
    company: oneLine(row.org_name, 120),
    ticket: row.ticket_id == null ? null : { id: Number(row.ticket_id), subject: oneLine(row.ticket_subject, 160) },
    showToTechnician: panelOptions(options).showToTechnician,
  };
}

export function supportEventFrom(body) {
  const type = SUPPORT_EVENTS.includes(body?.type) ? body.type : "";
  if (!type) return null;
  const sessionId = Number(body.sessionId);
  const needsSession = type.startsWith("session.");
  if (needsSession && !(Number.isInteger(sessionId) && sessionId > 0)) return null;
  const detail = oneLine(body.detail, 240);
  return { type, sessionId: Number.isInteger(sessionId) && sessionId > 0 ? sessionId : null, ...(detail ? { detail } : {}) };
}
