import { OS_FAMILIES, percentages } from "./daily-stats.js";
import { ZA_PROVINCES } from "./dashboard-overview.js";
import { endOfSupport } from "./lifecycle.js";
import { csvCell } from "./ticket-list.js";

export const REPORTS = [
  { key: "agents", title: "Agent version adoption", description: "How many devices run each agent version over time, and which devices are behind the current release." },
  { key: "os", title: "OS and build inventory", description: "Operating systems and builds across the fleet over time, with devices that have reached or are near end of support." },
  { key: "locations", title: "Device locations", description: "Where devices connect from, by country, province and city, with each device's public address and site." },
  { key: "patches", title: "Patch compliance", description: "The share of scanned devices with no missing patches over time, per customer, with every missing patch listed." },
  { key: "uptime", title: "Uptime and availability", description: "The share of time each device and customer was online, sampled every 5 minutes." },
  { key: "sessions", title: "Remote sessions", description: "Remote sessions by technician and customer, with time spent and billable totals." },
  { key: "service-desk", title: "Service Desk", description: "Tickets created and resolved, SLA compliance, response and resolution times, and time logged per customer.", needs: "ticketing" },
];

export function reportByKey(key) {
  return REPORTS.find((report) => report.key === key) || null;
}

const DAY = 86400000;
const SAMPLE_MINUTES = 5;
const ROW_LIMIT = 500;

// South Africa has no daylight saving, so local dates are UTC+2.
export function localDay(now = Date.now()) {
  return new Date(now + 2 * 3600000).toISOString().slice(0, 10);
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

// Defaults to the last 30 days; ranges are capped at a year and never end after today.
export function reportRange(from, to, now = Date.now()) {
  const today = localDay(now);
  let end = validDay(to) || today;
  if (end > today) end = today;
  let start = validDay(from) || addDays(end, -29);
  if (start > end) [start, end] = [end, start];
  if (addDays(start, 365) < end) start = addDays(end, -365);
  return { from: start, to: end };
}

export function previousMonth(now = Date.now()) {
  const today = localDay(now);
  const firstThisMonth = `${today.slice(0, 7)}-01`;
  const to = addDays(firstThisMonth, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}

export function daysBetween(from, to) {
  const days = [];
  for (let day = from, guard = 0; day <= to && guard < 400; day = addDays(day, 1), guard += 1) days.push(day);
  return days;
}

export function formatMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

export function formatDay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-ZA", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg",
  });
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function pctText(value) {
  return value == null ? "" : `${value}%`;
}

function ranked(counts, limit) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function bump(counts, key, by = 1) {
  counts[key] = (counts[key] || 0) + by;
}

// allRows is only for the CSV export; the API drops it from JSON responses.
function limited(rows, noun) {
  if (rows.length <= ROW_LIMIT) return { rows, more: "" };
  return { rows: rows.slice(0, ROW_LIMIT), allRows: rows, more: `Showing the first ${ROW_LIMIT} of ${rows.length} ${noun}. The CSV export has them all.` };
}

// days: fillDays output ([{ day, stats }]). Keeps the top `limit` keys by total and folds the rest into "Other".
function trendSeries(days, field, limit = 5, order = null) {
  const totals = {};
  for (const { stats } of days) {
    for (const [key, value] of Object.entries(stats?.[field] || {})) bump(totals, key, Number(value) || 0);
  }
  const keys = order ? order.filter((key) => totals[key]) : ranked(totals, Infinity).map(([key]) => key);
  const shown = keys.slice(0, limit);
  const rest = keys.slice(limit);
  const series = shown.map((key) => ({
    label: key,
    values: days.map(({ stats }) => (stats?.[field] ? Number(stats[field][key]) || 0 : null)),
  }));
  if (rest.length) {
    series.push({
      label: "Other",
      tone: "muted",
      values: days.map(({ stats }) => (stats?.[field] ? rest.reduce((sum, key) => sum + (Number(stats[field][key]) || 0), 0) : null)),
    });
  }
  return series;
}

function deviceName(row) {
  return row.display_name || row.hostname || "Device";
}

function lastSeen(facts) {
  return facts.lastSeenAt ? formatDateTime(facts.lastSeenAt) : "Never";
}

function agentState(facts) {
  if (facts.agentVersion === "Unknown") return "No version (1.4 or older)";
  return facts.outdated ? "Outdated" : "Current";
}

// ctx: { from, to, days, customerName, orgName, now }
function base(key, ctx) {
  const meta = reportByKey(key);
  return {
    key,
    title: meta.title,
    description: meta.description,
    from: ctx.from,
    to: ctx.to,
    rangeLabel: `${formatDay(`${ctx.from}T12:00:00Z`)} to ${formatDay(`${ctx.to}T12:00:00Z`)}`,
    customerName: ctx.customerName || "All customers",
    orgName: ctx.orgName || "",
    generatedAt: new Date(ctx.now || Date.now()).toISOString(),
    generatedLabel: formatDateTime(ctx.now || Date.now()),
    summary: [],
    charts: [],
    tables: [],
    notes: [],
  };
}

// data: { trend: fillDays rows, items: [{ row, facts }], versions: overview agent slices, releases }
export function agentsReport(data, ctx) {
  const report = base("agents", ctx);
  const { items, versions, releases } = data;
  const current = items.filter((item) => item.facts.agentVersion !== "Unknown" && !item.facts.outdated).length;
  const unknown = items.filter((item) => item.facts.agentVersion === "Unknown").length;
  report.summary = [
    { label: "Devices", value: items.length },
    { label: "On the current release", value: items.length ? `${current} (${Math.round((current / items.length) * 100)}%)` : "0" },
    { label: "Outdated", value: items.filter((item) => item.facts.outdated).length },
    releases.windows && releases.linux && releases.windows !== releases.linux
      ? { label: "Current release (Windows / Linux)", value: `${releases.windows} / ${releases.linux}` }
      : { label: "Current release", value: releases.windows || releases.linux || "Not published" },
  ];
  report.charts.push({
    type: "area",
    title: "Devices per agent version",
    unit: "count",
    days: data.trend.map((entry) => entry.day),
    series: trendSeries(data.trend, "agent_versions", 5),
    empty: "No daily snapshots in this period yet. They are written once a day.",
  });
  report.tables.push({
    key: "versions",
    title: "Devices per version",
    columns: [
      { key: "version", label: "Version", width: 2 },
      { key: "state", label: "State", width: 2 },
      { key: "platforms", label: "Platforms", width: 2 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
      { key: "share", label: "Share", align: "right", width: 1 },
    ],
    rows: versions.map((slice) => ({
      version: slice.version === "Unknown" ? "Unknown (1.4 or older)" : slice.version,
      state: slice.version === "Unknown" ? "Critical" : slice.outdated ? "Outdated" : "Current",
      platforms: slice.platforms.join(", "),
      devices: slice.count,
      share: `${slice.pct}%`,
    })),
    empty: "No devices yet.",
  });
  const rank = (facts) => (facts.agentVersion === "Unknown" ? 0 : facts.outdated ? 1 : 2);
  const rows = [...items]
    .sort((a, b) => rank(a.facts) - rank(b.facts) || deviceName(a.row).localeCompare(deviceName(b.row)))
    .map(({ row, facts }) => ({
      device: deviceName(row),
      customer: row.customer_name || "No customer",
      platform: facts.platform === "windows" ? "Windows" : facts.platform === "linux" ? "Linux" : facts.family,
      version: facts.agentVersion,
      state: agentState(facts),
      lastSeen: lastSeen(facts),
      _id: Number(row.id),
    }));
  report.tables.push({
    key: "devices",
    title: "Devices",
    columns: [
      { key: "device", label: "Device", width: 3 },
      { key: "customer", label: "Customer", width: 3 },
      { key: "platform", label: "Platform", width: 2 },
      { key: "version", label: "Version", width: 1.5 },
      { key: "state", label: "State", width: 2.5 },
      { key: "lastSeen", label: "Last seen", width: 2.5 },
    ],
    ...limited(rows, "devices"),
    empty: "No devices yet.",
  });
  if (unknown) report.notes.push(`${unknown} ${unknown === 1 ? "device runs" : "devices run"} an agent older than 1.5 that does not report its version. Reinstall the agent on ${unknown === 1 ? "it" : "them"} to bring them up to date.`);
  return report;
}

function buildLabel(row) {
  return row.os_version || row.os_build || "";
}

// data: { trend, items }
export function osReport(data, ctx) {
  const report = base("os", ctx);
  const { items } = data;
  const now = ctx.now || Date.now();
  const familyCounts = {};
  const builds = {};
  const support = [];
  for (const { row, facts } of items) {
    bump(familyCounts, facts.family);
    const build = buildLabel(row);
    bump(builds, `${facts.family}|${build}`);
    const end = endOfSupport({ osName: row.os_name, osVersion: row.os_version }, now);
    if (end) support.push({ row, facts, end });
  }
  const shares = percentages(familyCounts);
  const ended = support.filter((item) => item.end.state === "ended").length;
  report.summary = [
    { label: "Devices", value: items.length },
    { label: "Operating systems", value: Object.keys(familyCounts).length },
    { label: "Out of support", value: ended },
    { label: "Support ends within 90 days", value: support.length - ended },
  ];
  const days = data.trend.map((entry) => entry.day);
  report.charts.push({
    type: "area",
    title: "Devices per operating system",
    unit: "count",
    days,
    series: trendSeries(data.trend, "os_counts", 6, OS_FAMILIES),
    empty: "No daily snapshots in this period yet. They are written once a day.",
  });
  report.charts.push({
    type: "lines",
    title: "Devices per build",
    unit: "count",
    days,
    series: trendSeries(data.trend, "build_counts", 6),
    empty: "No build history yet. Builds are collected from agent 1.5.2 onwards, starting with the next daily snapshot.",
  });
  report.tables.push({
    key: "families",
    title: "Operating systems",
    columns: [
      { key: "family", label: "Operating system", width: 3 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
      { key: "share", label: "Share", align: "right", width: 1 },
    ],
    rows: OS_FAMILIES.filter((family) => familyCounts[family]).map((family) => ({
      family,
      devices: familyCounts[family],
      share: `${shares[family] || 0}%`,
    })),
    empty: "No devices yet.",
  });
  report.tables.push({
    key: "builds",
    title: "Builds",
    columns: [
      { key: "family", label: "Operating system", width: 3 },
      { key: "build", label: "Version / build", width: 2 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
    ],
    rows: ranked(builds, Infinity).map(([key, count]) => {
      const [family, build] = key.split("|");
      return { family, build: build || "Not reported", devices: count };
    }),
    empty: "No devices yet.",
  });
  report.tables.push({
    key: "support",
    title: "End of support",
    columns: [
      { key: "device", label: "Device", width: 3 },
      { key: "customer", label: "Customer", width: 3 },
      { key: "release", label: "Release", width: 3 },
      { key: "ends", label: "Support ends", width: 2 },
      { key: "state", label: "State", width: 2 },
    ],
    rows: support
      .sort((a, b) => a.end.date.localeCompare(b.end.date) || deviceName(a.row).localeCompare(deviceName(b.row)))
      .map(({ row, end }) => ({
        device: deviceName(row),
        customer: row.customer_name || "No customer",
        release: end.release,
        ends: formatDay(`${end.date}T12:00:00Z`),
        state: end.state === "ended" ? "Out of support" : "Ends soon",
        _id: Number(row.id),
      })),
    empty: "No devices are out of support or within 90 days of it.",
  });
  report.notes.push("Windows 10 LTSC and IoT LTSC editions follow a longer lifecycle and are not listed. Windows 11 end of support depends on the feature version, which agents report from 1.5.2.");
  return report;
}

// data: { items, drill: { country, region } }
export function locationsReport(data, ctx) {
  const report = base("locations", ctx);
  const { items } = data;
  const drill = data.drill || {};
  const countryCounts = {};
  const countryNames = {};
  for (const { facts } of items) {
    bump(countryCounts, facts.country);
    countryNames[facts.country] = facts.countryName;
  }
  const unknown = countryCounts.Unknown || 0;
  const za = countryCounts.ZA || 0;
  report.summary = [
    { label: "Located devices", value: items.length - unknown },
    { label: "In South Africa", value: items.length ? `${Math.round((za / items.length) * 100)}%` : "0%" },
    { label: "Countries", value: Object.keys(countryCounts).filter((code) => code !== "Unknown").length },
    { label: "Unknown location", value: unknown },
  ];
  const inCountry = drill.country ? items.filter((item) => item.facts.country === drill.country) : items;
  const inRegion = drill.region ? inCountry.filter((item) => regionOf(item.facts) === drill.region) : inCountry;
  let level;
  if (!drill.country) {
    const shares = percentages(countryCounts);
    level = {
      title: "Countries",
      label: "Country",
      rows: ranked(countryCounts, Infinity).map(([code, count]) => ({
        name: code === "Unknown" ? "Unknown" : countryNames[code] || code,
        devices: count,
        share: `${shares[code] || 0}%`,
        _drill: code === "Unknown" ? null : { country: code },
      })),
    };
  } else if (!drill.region) {
    const counts = {};
    for (const { facts } of inCountry) bump(counts, regionOf(facts));
    if (drill.country === "ZA") for (const name of ZA_PROVINCES) counts[name] ||= 0;
    const shares = percentages(counts);
    level = {
      title: drill.country === "ZA" ? "Provinces" : "Regions",
      label: drill.country === "ZA" ? "Province" : "Region",
      rows: ranked(counts, Infinity).map(([name, count]) => ({
        name,
        devices: count,
        share: `${shares[name] || 0}%`,
        _drill: count && name !== "Unknown" ? { country: drill.country, region: name } : null,
      })),
    };
  } else {
    const counts = {};
    for (const { facts } of inRegion) bump(counts, facts.city || "Unknown");
    const shares = percentages(counts);
    level = {
      title: "Cities",
      label: "City",
      rows: ranked(counts, Infinity).map(([name, count]) => ({ name, devices: count, share: `${shares[name] || 0}%` })),
    };
  }
  report.drill = {
    country: drill.country || "",
    countryName: drill.country ? countryNames[drill.country] || drill.country : "",
    region: drill.region || "",
  };
  report.charts.push({
    type: "bars",
    title: level.title,
    colorBy: "index",
    items: level.rows.filter((row) => row.devices > 0).slice(0, 12).map((row) => ({ label: row.name, value: row.devices, tone: row.name === "Unknown" ? "muted" : undefined })),
    empty: "No devices here yet.",
  });
  report.tables.push({
    key: "level",
    title: level.title,
    columns: [
      { key: "name", label: level.label, width: 4 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
      { key: "share", label: "Share", align: "right", width: 1 },
    ],
    rows: level.rows,
    empty: "No devices here yet.",
  });
  const rows = [...inRegion]
    .sort((a, b) => deviceName(a.row).localeCompare(deviceName(b.row)))
    .map(({ row, facts }) => ({
      device: deviceName(row),
      customer: row.customer_name || "No customer",
      ip: row.public_ip || "",
      city: facts.city || "",
      region: regionOf(facts) === "Unknown" ? "" : regionOf(facts),
      country: facts.country === "Unknown" ? "Unknown" : facts.countryName,
      site: facts.site || "",
      lastSeen: lastSeen(facts),
      _id: Number(row.id),
    }));
  report.tables.push({
    key: "devices",
    title: "Devices",
    columns: [
      { key: "device", label: "Device", width: 3 },
      { key: "customer", label: "Customer", width: 3 },
      { key: "ip", label: "Public IP", width: 2.5 },
      { key: "city", label: "City", width: 2 },
      { key: "region", label: "Province / region", width: 2.5 },
      { key: "country", label: "Country", width: 2 },
      { key: "site", label: "Site override", width: 2 },
      { key: "lastSeen", label: "Last seen", width: 2.5 },
    ],
    ...limited(rows, "devices"),
    empty: "No devices here yet.",
  });
  report.notes.push("Locations come from the public IP address a device connects from, so they are approximate (often the internet provider's nearest exchange). A site override set on a device replaces it when devices are grouped. This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.");
  return report;
}

function regionOf(facts) {
  if (facts.country === "Unknown") return "Unknown";
  return facts.country === "ZA" ? facts.region || "Unknown" : facts.region || "Unknown";
}

// data: { trends: [{ id, name, days }] (org total first when all customers), items, missing: [{ device, customer, name, kb, category, severity }] }
export function patchesReport(data, ctx) {
  const report = base("patches", ctx);
  const { items } = data;
  const scanned = items.filter((item) => item.facts.scanned);
  const compliant = scanned.filter((item) => item.facts.missing === 0);
  report.summary = [
    { label: "Compliant devices", value: scanned.length ? `${compliant.length} of ${scanned.length} (${Math.round((compliant.length / scanned.length) * 100)}%)` : "None scanned" },
    { label: "Devices missing patches", value: scanned.length - compliant.length },
    { label: "Missing patches", value: items.reduce((sum, item) => sum + item.facts.missing, 0) },
    { label: "Not scanned yet", value: items.length - scanned.length },
  ];
  const days = data.trends[0]?.days.map((entry) => entry.day) || [];
  report.charts.push({
    type: "lines",
    title: "Compliance over time",
    unit: "%",
    days,
    series: data.trends.map((trend) => ({
      label: trend.name,
      values: trend.days.map(({ stats }) => (stats && stats.scanned_count ? Math.round((stats.compliant_count / stats.scanned_count) * 100) : null)),
    })),
    empty: "No compliance history yet. It is collected with each daily snapshot from today.",
  });
  const groups = new Map();
  for (const { row, facts } of items) {
    const key = row.customer_id == null ? "none" : String(row.customer_id);
    if (!groups.has(key)) groups.set(key, { name: row.customer_name || "No customer", devices: 0, scanned: 0, compliant: 0, missing: 0 });
    const group = groups.get(key);
    group.devices += 1;
    if (facts.scanned) {
      group.scanned += 1;
      if (facts.missing === 0) group.compliant += 1;
    }
    group.missing += facts.missing;
  }
  report.tables.push({
    key: "customers",
    title: "By customer",
    columns: [
      { key: "customer", label: "Customer", width: 4 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
      { key: "scanned", label: "Scanned", align: "right", width: 1 },
      { key: "compliant", label: "Compliant", align: "right", width: 1.2 },
      { key: "compliance", label: "Compliance", align: "right", width: 1.3 },
      { key: "missing", label: "Missing patches", align: "right", width: 1.6 },
    ],
    rows: [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((group) => ({ customer: group.name, devices: group.devices, scanned: group.scanned, compliant: group.compliant, compliance: pctText(pct(group.compliant, group.scanned)), missing: group.missing })),
    empty: "No devices yet.",
  });
  report.tables.push({
    key: "missing",
    title: "Missing patches",
    columns: [
      { key: "device", label: "Device", width: 2.5 },
      { key: "customer", label: "Customer", width: 2.5 },
      { key: "name", label: "Patch", width: 5 },
      { key: "kb", label: "KB", width: 1.5 },
      { key: "category", label: "Category", width: 2 },
      { key: "severity", label: "Severity", width: 1.5 },
    ],
    ...limited(data.missing, "missing patches"),
    empty: "No missing patches. Every scanned device is up to date.",
  });
  return report;
}

// data: { devices: [{ id, name, customer, checks, online, days }], daily: [{ day, checks, online }], since }
export function uptimeReport(data, ctx) {
  const report = base("uptime", ctx);
  const devices = data.devices.filter((device) => device.checks > 0);
  const checks = devices.reduce((sum, device) => sum + device.checks, 0);
  const online = devices.reduce((sum, device) => sum + device.online, 0);
  const below = devices.filter((device) => pct(device.online, device.checks) < 95).length;
  report.summary = [
    { label: "Availability", value: checks ? `${pct(online, checks)}%` : "No samples" },
    { label: "Devices below 95%", value: below },
    { label: "Offline time", value: formatMinutes((checks - online) * SAMPLE_MINUTES) || "0m" },
    { label: "Devices sampled", value: devices.length },
  ];
  const byDay = new Map(data.daily.map((row) => [String(row.day).slice(0, 10), row]));
  const days = daysBetween(ctx.from, ctx.to);
  report.charts.push({
    type: "lines",
    title: "Online share per day",
    unit: "%",
    days,
    series: [{ label: "Online", values: days.map((day) => (byDay.get(day)?.checks ? pct(byDay.get(day).online, byDay.get(day).checks) : null)) }],
    empty: "No availability samples in this period yet.",
  });
  const groups = new Map();
  for (const device of devices) {
    const key = device.customer || "No customer";
    if (!groups.has(key)) groups.set(key, { customer: key, devices: 0, checks: 0, online: 0 });
    const group = groups.get(key);
    group.devices += 1;
    group.checks += device.checks;
    group.online += device.online;
  }
  report.tables.push({
    key: "customers",
    title: "By customer",
    columns: [
      { key: "customer", label: "Customer", width: 4 },
      { key: "devices", label: "Devices", align: "right", width: 1 },
      { key: "uptime", label: "Online", align: "right", width: 1.2 },
      { key: "offline", label: "Offline time", align: "right", width: 1.6 },
    ],
    rows: [...groups.values()]
      .sort((a, b) => a.customer.localeCompare(b.customer))
      .map((group) => ({ customer: group.customer, devices: group.devices, uptime: pctText(pct(group.online, group.checks)), offline: formatMinutes((group.checks - group.online) * SAMPLE_MINUTES) || "0m" })),
    empty: "No availability samples in this period yet.",
  });
  report.tables.push({
    key: "devices",
    title: "By device",
    columns: [
      { key: "device", label: "Device", width: 3 },
      { key: "customer", label: "Customer", width: 3 },
      { key: "uptime", label: "Online", align: "right", width: 1.2 },
      { key: "offline", label: "Offline time", align: "right", width: 1.6 },
      { key: "days", label: "Days sampled", align: "right", width: 1.4 },
    ],
    ...limited([...devices]
      .sort((a, b) => a.online / a.checks - b.online / b.checks || a.name.localeCompare(b.name))
      .map((device) => ({ device: device.name, customer: device.customer || "No customer", uptime: pctText(pct(device.online, device.checks)), offline: formatMinutes((device.checks - device.online) * SAMPLE_MINUTES) || "0m", days: device.days, _id: device.id })), "devices"),
    empty: "No availability samples in this period yet.",
  });
  report.notes.push(`Availability is sampled every ${SAMPLE_MINUTES} minutes from agent check-ins: a device counts as online when it checked in during the last minute.${data.since ? ` Sampling started on ${formatDay(`${String(data.since).slice(0, 10)}T12:00:00Z`)}.` : ""}`);
  return report;
}

export function sessionMinutes(session, now = Date.now()) {
  if (session.status === "untracked") return null;
  if (!session.connected_at) return 0;
  const end = session.ended_at || session.last_seen_at || now;
  return Math.max(0, (new Date(end).getTime() - new Date(session.started_at).getTime()) / 60000);
}

// data: { sessions: [{ started_at, connected_at, last_seen_at, ended_at, status, technician, customer, device, ticket_id, billable }] }
export function sessionsReport(data, ctx) {
  const report = base("sessions", ctx);
  const now = ctx.now || Date.now();
  const sessions = data.sessions.map((session) => ({ ...session, minutes: sessionMinutes(session, now) }));
  const tracked = sessions.filter((session) => session.minutes != null);
  const total = tracked.reduce((sum, session) => sum + session.minutes, 0);
  const billable = tracked.filter((session) => session.billable).reduce((sum, session) => sum + session.minutes, 0);
  const untracked = sessions.length - tracked.length;
  report.summary = [
    { label: "Sessions", value: sessions.length },
    { label: "Time in sessions", value: formatMinutes(total) || "0m" },
    { label: "Billable time", value: formatMinutes(billable) || "0m" },
    { label: "Billable sessions", value: sessions.filter((session) => session.billable).length },
  ];
  const group = (field) => {
    const map = new Map();
    for (const session of sessions) {
      const key = session[field] || (field === "customer" ? "No customer" : "Removed user");
      if (!map.has(key)) map.set(key, { name: key, sessions: 0, minutes: 0, billable: 0 });
      const row = map.get(key);
      row.sessions += 1;
      row.minutes += session.minutes || 0;
      if (session.billable) row.billable += session.minutes || 0;
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions || a.name.localeCompare(b.name));
  };
  const technicians = group("technician");
  const customers = group("customer");
  report.charts.push({
    type: "bars",
    title: "Time by technician",
    items: technicians.map((row) => ({ label: row.name, value: Math.round(row.minutes), display: formatMinutes(row.minutes) || "0m" })),
    empty: "No remote sessions in this period.",
  });
  const columns = (first) => [
    { key: "name", label: first, width: 4 },
    { key: "sessions", label: "Sessions", align: "right", width: 1.2 },
    { key: "time", label: "Time", align: "right", width: 1.4 },
    { key: "billable", label: "Billable", align: "right", width: 1.4 },
  ];
  const rowsOf = (list) => list.map((row) => ({ name: row.name, sessions: row.sessions, time: formatMinutes(row.minutes) || "0m", billable: formatMinutes(row.billable) || "0m" }));
  report.tables.push({ key: "technicians", title: "By technician", columns: columns("Technician"), rows: rowsOf(technicians), empty: "No remote sessions in this period." });
  report.tables.push({ key: "customers", title: "By customer", columns: columns("Customer"), rows: rowsOf(customers), empty: "No remote sessions in this period." });
  const list = [...sessions].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).map((session) => ({
    started: formatDateTime(session.started_at),
    technician: session.technician || "Removed user",
    customer: session.customer || "No customer",
    device: session.device || "",
    duration: session.minutes == null ? "Not tracked" : session.connected_at ? formatMinutes(session.minutes) || "Under 1m" : "Not connected",
    ticket: session.ticket_id ? `#${session.ticket_id}` : "",
    billable: session.billable ? "Yes" : "No",
  }));
  report.tables.push({
    key: "sessions",
    title: "Sessions",
    columns: [
      { key: "started", label: "Started", width: 2.6 },
      { key: "technician", label: "Technician", width: 2.4 },
      { key: "customer", label: "Customer", width: 2.6 },
      { key: "device", label: "Device", width: 2.4 },
      { key: "duration", label: "Duration", align: "right", width: 1.6 },
      { key: "ticket", label: "Ticket", width: 1 },
      { key: "billable", label: "Billable", width: 1.1 },
    ],
    ...limited(list, "sessions"),
    empty: "No remote sessions in this period.",
  });
  report.notes.push("A session is billable when it was started from a ticket that has billable time logged. Duration runs from Connect until the device stops showing a remote session, checked every minute.");
  if (untracked) report.notes.push(`${untracked} ${untracked === 1 ? "session was" : "sessions were"} started before session tracking began, so ${untracked === 1 ? "its" : "their"} duration is not known.`);
  return report;
}

function slaOutcome(startAt, stopAt, target, now) {
  if (!target) return null;
  const elapsed = ((stopAt ? new Date(stopAt).getTime() : now) - new Date(startAt).getTime()) / 60000;
  if (stopAt) return elapsed <= target ? "met" : "missed";
  return elapsed > target ? "missed" : null;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function averageLabel(minutes) {
  if (minutes == null) return "";
  return minutes < 0.5 ? "Under 1m" : formatMinutes(minutes);
}

// data: { tickets: [{ id, customer, created_at, first_response_at, resolved_at, status, response_target, resolve_target }],
//         resolved: [{ day, count }], time: [{ customer, minutes, billable }] }
export function serviceDeskReport(data, ctx) {
  const report = base("service-desk", ctx);
  const now = ctx.now || Date.now();
  const created = data.tickets;
  const resolvedCount = data.resolved.reduce((sum, row) => sum + Number(row.count), 0);
  const outcomes = created.map((ticket) => ({
    ticket,
    response: slaOutcome(ticket.created_at, ticket.first_response_at, ticket.response_target, now),
    resolve: slaOutcome(ticket.created_at, ticket.status === "resolved" ? ticket.resolved_at || ticket.updated_at : null, ticket.resolve_target, now),
  }));
  const rate = (list, field) => {
    const decided = list.filter((item) => item[field]);
    return decided.length ? `${Math.round((decided.filter((item) => item[field] === "met").length / decided.length) * 100)}%` : "";
  };
  const responseTimes = (list) => list.filter(({ ticket }) => ticket.first_response_at).map(({ ticket }) => (new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 60000);
  const resolveTimes = (list) => list.filter(({ ticket }) => ticket.status === "resolved" && (ticket.resolved_at || ticket.updated_at)).map(({ ticket }) => (new Date(ticket.resolved_at || ticket.updated_at) - new Date(ticket.created_at)) / 60000);
  const loggedTotal = data.time.reduce((sum, row) => sum + Number(row.minutes), 0);
  const loggedBillable = data.time.filter((row) => row.billable).reduce((sum, row) => sum + Number(row.minutes), 0);
  report.summary = [
    { label: "Created", value: created.length },
    { label: "Resolved", value: resolvedCount },
    { label: "Response SLA met", value: rate(outcomes, "response") || "No SLA" },
    { label: "Resolution SLA met", value: rate(outcomes, "resolve") || "No SLA" },
    { label: "Average first response", value: averageLabel(average(responseTimes(outcomes))) || "None yet" },
    { label: "Average resolution", value: averageLabel(average(resolveTimes(outcomes))) || "None yet" },
    { label: "Time logged", value: formatMinutes(loggedTotal) || "0m" },
    { label: "Billable time", value: formatMinutes(loggedBillable) || "0m" },
  ];
  const days = daysBetween(ctx.from, ctx.to);
  const createdByDay = {};
  for (const ticket of created) bump(createdByDay, localDay(new Date(ticket.created_at).getTime()));
  const resolvedByDay = Object.fromEntries(data.resolved.map((row) => [String(row.day).slice(0, 10), Number(row.count)]));
  report.charts.push({
    type: "lines",
    title: "Tickets created and resolved",
    unit: "count",
    days,
    series: [
      { label: "Created", values: days.map((day) => createdByDay[day] || 0) },
      { label: "Resolved", tone: "green", values: days.map((day) => resolvedByDay[day] || 0) },
    ],
    empty: "No tickets in this period.",
  });
  const timeByCustomer = {};
  const billableByCustomer = {};
  for (const row of data.time) {
    bump(timeByCustomer, row.customer || "No customer", Number(row.minutes));
    if (row.billable) bump(billableByCustomer, row.customer || "No customer", Number(row.minutes));
  }
  report.charts.push({
    type: "bars",
    title: "Time logged per customer",
    colorBy: "index",
    items: ranked(timeByCustomer, 12).map(([name, minutes]) => ({ label: name, value: minutes, display: formatMinutes(minutes) })),
    empty: "No time logged in this period.",
  });
  const groups = new Map();
  for (const outcome of outcomes) {
    const key = outcome.ticket.customer || "No customer";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(outcome);
  }
  for (const name of Object.keys(timeByCustomer)) if (!groups.has(name)) groups.set(name, []);
  report.tables.push({
    key: "customers",
    title: "By customer",
    columns: [
      { key: "customer", label: "Customer", width: 1.9 },
      { key: "created", label: "Created", align: "right", width: 1 },
      { key: "resolved", label: "Resolved", align: "right", width: 1 },
      { key: "open", label: "Open", align: "right", width: 0.8 },
      { key: "response", label: "Response SLA", align: "right", width: 1.1 },
      { key: "resolution", label: "Resolution SLA", align: "right", width: 1.1 },
      { key: "firstResponse", label: "Avg response", align: "right", width: 1.1 },
      { key: "resolveTime", label: "Avg resolution", align: "right", width: 1.1 },
      { key: "time", label: "Time logged", align: "right", width: 1 },
      { key: "billable", label: "Billable", align: "right", width: 1 },
    ],
    rows: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({
      customer: name,
      created: list.length,
      resolved: list.filter(({ ticket }) => ticket.status === "resolved").length,
      open: list.filter(({ ticket }) => ticket.status !== "resolved").length,
      response: rate(list, "response"),
      resolution: rate(list, "resolve"),
      firstResponse: averageLabel(average(responseTimes(list))),
      resolveTime: averageLabel(average(resolveTimes(list))),
      time: formatMinutes(timeByCustomer[name] || 0) || "0m",
      billable: formatMinutes(billableByCustomer[name] || 0) || "0m",
    })),
    empty: "No tickets or time logged in this period.",
  });
  report.notes.push("SLA figures cover tickets created in this period. A ticket still open within its target is not counted yet. Resolved counts tickets resolved in this period, whenever they were created.");
  return report;
}

const BUILDERS = {
  agents: agentsReport,
  os: osReport,
  locations: locationsReport,
  patches: patchesReport,
  uptime: uptimeReport,
  sessions: sessionsReport,
  "service-desk": serviceDeskReport,
};

export function buildReport(key, data, ctx) {
  return BUILDERS[key](data, ctx);
}

function visibleColumns(columns) {
  return columns.filter((column) => !column.key.startsWith("_"));
}

export function reportCsv(report) {
  const lines = [
    [report.title],
    ["Customer", report.customerName],
    ["Period", report.from, report.to],
    ["Generated", report.generatedAt],
    [],
    ...report.summary.map((item) => [item.label, item.value]),
  ];
  for (const chart of report.charts) {
    if (chart.type === "bars" || !chart.days?.length || !chart.series?.length) continue;
    lines.push([], [chart.title], ["Day", ...chart.series.map((item) => item.label)]);
    chart.days.forEach((day, i) => lines.push([day, ...chart.series.map((item) => item.values[i] ?? "")]));
  }
  for (const table of report.tables) {
    const columns = visibleColumns(table.columns);
    lines.push([], [table.title], columns.map((column) => column.label));
    for (const row of table.allRows || table.rows) lines.push(columns.map((column) => row[column.key] ?? ""));
  }
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function reportJson(report) {
  return { ...report, tables: report.tables.map(({ allRows, ...table }) => table) };
}
