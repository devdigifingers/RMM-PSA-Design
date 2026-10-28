export const FEATURE_GROUPS = [
  {
    app: "remote",
    appId: "remote-desk",
    title: "Remote Desk",
    features: [
      ["enrollment", "Device enrollment"],
      ["remote_sessions", "Remote sessions"],
      ["remote_support", "Remote support"],
      ["monitoring", "Monitoring"],
      ["patching", "Patching"],
    ],
  },
  { app: "servicedesk", appId: "service-desk", title: "Service Desk", features: [["ticketing", "Ticketing"]] },
  { app: "reporting", appId: "reports", title: "Reporting (add-on)", features: [["reporting", "Reporting"]] },
];

export const FEATURE_KEYS = FEATURE_GROUPS.flatMap((group) => group.features.map(([key]) => key));

export const FEATURE_LABEL = Object.fromEntries(FEATURE_GROUPS.flatMap((group) => group.features));

export const APP_ICON = Object.fromEntries(FEATURE_GROUPS.map((group) => [group.app, group.appId]));

export const APP_TITLE = Object.fromEntries(FEATURE_GROUPS.map((group) => [group.app, group.title.replace(" (add-on)", "")]));

export const LICENSE_TYPES = [
  ["operator", "Operator"],
  ["licensee", "Licensee"],
  ["standard", "Standard"],
];

export const STATUS_LABEL = { active: "Active", suspended: "Suspended", expired: "Expired" };

export function appsFor(features) {
  const set = new Set(features || []);
  return FEATURE_GROUPS.filter((group) => group.features.some(([key]) => set.has(key))).map((group) => group.app);
}

export function packageLabel(pkg) {
  if (!pkg) return "—";
  return pkg.isCustom && !/\(custom\)$/i.test(pkg.name) ? `${pkg.name} (custom)` : pkg.name;
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(value));
}

export function expiryLabel(license) {
  return license?.noExpiry || !license?.expiresAt ? "No expiry" : formatDate(license.expiresAt);
}

export function money(value, currency = "ZAR") {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(value);
}

export function dateInput(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function meter(used, total) {
  const count = Number(used) || 0;
  const limit = Number(total) || 0;
  const level = count >= limit ? "full" : count >= limit * 0.9 ? "near" : "ok";
  return { used: count, total: limit, percent: limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 100, level };
}
