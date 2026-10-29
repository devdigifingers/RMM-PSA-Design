import assert from "node:assert/strict";
import test from "node:test";
import { fillDays } from "../src/daily-stats.js";
import { deviceFacts, overviewFrom } from "../src/dashboard-overview.js";
import { endOfSupport } from "../src/lifecycle.js";
import { mailBody } from "../src/mail.js";
import { PdfDocument, fitText, reportPdf, textWidth } from "../src/pdf.js";
import {
  agentsReport, buildReport, formatMinutes, locationsReport, osReport, patchesReport, previousMonth,
  reportCsv, reportJson, reportRange, serviceDeskReport, sessionMinutes, sessionsReport, uptimeReport,
} from "../src/reports.js";

const NOW = Date.parse("2026-10-29T10:00:00Z");
const ctx = { from: "2026-10-27", to: "2026-10-29", now: NOW, orgName: "Org", customerName: "All customers" };
const releases = { windows: "1.5.1", linux: "1.5.2" };

function item(row) {
  return { row, facts: deviceFacts(row, { now: NOW, releases }) };
}

const fleet = [
  item({ id: 1, hostname: "pc1", os_name: "Microsoft Windows 10 Pro", agent_version: "1.5.1", last_seen_at: new Date(NOW - 1000).toISOString(), customer_id: 7, customer_name: "Acme", updates: [], missing: 0, geo_updated_at: "2026-10-01", geo_country: "ZA", geo_country_name: "South Africa", geo_region: "Gauteng", geo_city: "Johannesburg", public_ip: "41.0.0.1" }),
  item({ id: 2, hostname: "pc2", os_name: "Microsoft Windows 10 IoT Enterprise LTSC", agent_version: "1.5.0", last_seen_at: new Date(NOW - 1000).toISOString(), customer_id: 7, customer_name: "Acme", updates: [{ name: "KB1" }], missing: 1, geo_updated_at: "2026-10-01", geo_country: "ZA", geo_country_name: "South Africa", geo_region: "Western Cape", geo_city: "Cape Town" }),
  item({ id: 3, hostname: "srv", os_name: "Ubuntu 20.04.6 LTS", agent_version: "", last_seen_at: null, customer_id: null, customer_name: null }),
];

test("report ranges default to 30 days, never pass today and cap at a year", () => {
  assert.deepEqual(reportRange("", "", NOW), { from: "2026-09-30", to: "2026-10-29" });
  assert.deepEqual(reportRange("2026-10-20", "2027-01-01", NOW), { from: "2026-10-20", to: "2026-10-29" });
  assert.deepEqual(reportRange("2026-10-29", "2026-10-01", NOW), { from: "2026-10-01", to: "2026-10-29" });
  assert.deepEqual(reportRange("2020-01-01", "2026-10-29", NOW), { from: "2025-10-29", to: "2026-10-29" });
  assert.deepEqual(reportRange("2026-02-30", "nope", NOW), { from: "2026-09-30", to: "2026-10-29" });
  assert.deepEqual(previousMonth(NOW), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(previousMonth(Date.parse("2026-01-05T08:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
});

test("minutes format as hours and minutes", () => {
  assert.equal(formatMinutes(0), "0m");
  assert.equal(formatMinutes(59.6), "1h 00m");
  assert.equal(formatMinutes(125), "2h 05m");
  assert.equal(formatMinutes(null), "");
});

test("end of support covers Windows 10, skips LTSC and respects the warning window", () => {
  assert.equal(endOfSupport({ osName: "Microsoft Windows 10 Pro" }, NOW).state, "ended");
  assert.equal(endOfSupport({ osName: "Microsoft Windows 10 IoT Enterprise LTSC" }, NOW), null);
  assert.equal(endOfSupport({ osName: "Microsoft Windows 11 Pro", osVersion: "24H2" }, NOW).state, "ended");
  assert.equal(endOfSupport({ osName: "Microsoft Windows 11 Enterprise", osVersion: "23H2" }, NOW).state, "soon");
  assert.equal(endOfSupport({ osName: "Microsoft Windows 11 Pro", osVersion: "25H2" }, NOW), null);
  assert.equal(endOfSupport({ osName: "Microsoft Windows 11 Pro" }, NOW), null);
  assert.equal(endOfSupport({ osName: "Microsoft Windows Server 2016 Standard" }, NOW).state, "soon");
  assert.equal(endOfSupport({ osName: "Microsoft Windows Server 2025 Standard" }, NOW), null);
  assert.equal(endOfSupport({ osName: "Ubuntu 20.04.6 LTS" }, NOW).date, "2025-05-31");
  assert.equal(endOfSupport({ osName: "Ubuntu 24.04.5 LTS" }, NOW), null);
  assert.equal(endOfSupport({ osName: "Debian GNU/Linux 11 (bullseye)", osVersion: "11" }, NOW).state, "ended");
  assert.equal(endOfSupport({ osName: "Fedora Linux 44 (KDE Plasma Desktop Edition)" }, NOW), null);
});

test("agent report trends fill empty days and list devices behind first", () => {
  const trend = fillDays([
    { day: "2026-10-27", agent_versions: { "1.5.1": 2, Unknown: 1 } },
    { day: "2026-10-29", agent_versions: { "1.5.1": 1, "1.5.0": 1, Unknown: 1 } },
  ], "2026-10-27", "2026-10-29").map(({ day, stats }) => ({ day, stats }));
  const overview = overviewFrom(fleet, { releases });
  const report = agentsReport({ trend, items: fleet, versions: overview.agents.versions, releases }, ctx);
  const chart = report.charts[0];
  assert.deepEqual(chart.days, ["2026-10-27", "2026-10-28", "2026-10-29"]);
  const v151 = chart.series.find((series) => series.label === "1.5.1");
  assert.deepEqual(v151.values, [2, null, 1]);
  assert.deepEqual(report.tables[1].rows.map((row) => row.device), ["srv", "pc2", "pc1"]);
  const shares = report.tables[0].rows.reduce((sum, row) => sum + Number.parseInt(row.share, 10), 0);
  assert.equal(shares, 100);
});

test("OS report lists end of support devices only", () => {
  const report = osReport({ trend: [], items: fleet }, ctx);
  const support = report.tables.find((table) => table.key === "support");
  assert.deepEqual(support.rows.map((row) => row.device).sort(), ["pc1", "srv"]);
  assert.equal(report.summary.find((entry) => entry.label === "Out of support").value, 2);
});

test("location report drills from countries to provinces to cities", () => {
  const top = locationsReport({ items: fleet, drill: {} }, ctx);
  assert.deepEqual(top.tables[0].rows.map((row) => [row.name, row.devices]), [["South Africa", 2], ["Unknown", 1]]);
  assert.deepEqual(top.tables[0].rows[0]._drill, { country: "ZA" });
  const za = locationsReport({ items: fleet, drill: { country: "ZA" } }, ctx);
  assert.equal(za.tables[0].rows.length, 9);
  assert.equal(za.tables[1].rows.length, 2);
  const wc = locationsReport({ items: fleet, drill: { country: "ZA", region: "Western Cape" } }, ctx);
  assert.deepEqual(wc.tables[0].rows.map((row) => row.name), ["Cape Town"]);
  assert.deepEqual(wc.tables[1].rows.map((row) => row.device), ["pc2"]);
});

test("patch report compliance trend skips days without data", () => {
  const days = fillDays([
    { day: "2026-10-27", scanned_count: 2, compliant_count: 1 },
    { day: "2026-10-28", scanned_count: null, compliant_count: null },
  ], "2026-10-27", "2026-10-29");
  const report = patchesReport({ trends: [{ id: "all", name: "All customers", days }], items: fleet, missing: [] }, ctx);
  assert.deepEqual(report.charts[0].series[0].values, [50, null, null]);
  assert.equal(report.summary[0].value, "1 of 2 (50%)");
  assert.equal(report.summary[3].value, 1);
});

test("uptime report rolls devices up to customers", () => {
  const report = uptimeReport({
    devices: [
      { id: 1, name: "pc1", customer: "Acme", checks: 100, online: 100, days: 1 },
      { id: 2, name: "pc2", customer: "Acme", checks: 100, online: 50, days: 1 },
    ],
    daily: [{ day: "2026-10-28", checks: 200, online: 150 }],
  }, ctx);
  assert.equal(report.summary[0].value, "75%");
  assert.equal(report.summary[1].value, 1);
  assert.equal(report.tables[0].rows[0].uptime, "75%");
  assert.deepEqual(report.charts[0].series[0].values, [null, 75, null]);
  assert.equal(report.tables[1].rows[0].device, "pc2");
});

test("session durations and billable totals", () => {
  const start = "2026-10-28T08:00:00Z";
  const sessions = [
    { status: "ended", started_at: start, connected_at: start, ended_at: "2026-10-28T08:30:00Z", technician: "Ann", customer: "Acme", device: "pc1", ticket_id: 5, billable: true },
    { status: "ended", started_at: start, connected_at: null, ended_at: start, technician: "Ann", customer: "Acme", device: "pc1", ticket_id: null, billable: false },
    { status: "untracked", started_at: start, technician: "Bob", customer: null, device: "pc2", ticket_id: null, billable: false },
  ];
  assert.equal(sessionMinutes(sessions[0]), 30);
  assert.equal(sessionMinutes(sessions[1]), 0);
  assert.equal(sessionMinutes(sessions[2]), null);
  const report = sessionsReport({ sessions }, ctx);
  assert.deepEqual(report.summary.map((entry) => entry.value), [3, "30m", "30m", 1]);
  assert.deepEqual(report.tables[0].rows[0], { name: "Ann", sessions: 2, time: "30m", billable: "30m" });
  assert.deepEqual(report.tables[2].rows.map((row) => row.duration).sort(), ["30m", "Not connected", "Not tracked"]);
  assert.equal(report.notes.length, 2);
});

test("service desk report counts SLA outcomes for tickets created in the period", () => {
  const tickets = [
    { id: 1, customer: "Acme", created_at: "2026-10-27T08:00:00Z", first_response_at: "2026-10-27T08:20:00Z", resolved_at: "2026-10-27T10:00:00Z", status: "resolved", response_target: 30, resolve_target: 60 },
    { id: 2, customer: "Acme", created_at: "2026-10-28T08:00:00Z", first_response_at: null, resolved_at: null, status: "open", response_target: 30, resolve_target: 6000 },
    { id: 3, customer: "Beta", created_at: "2026-10-29T09:50:00Z", first_response_at: null, resolved_at: null, status: "open", response_target: 30, resolve_target: 60 },
  ];
  const report = serviceDeskReport({ tickets, resolved: [{ day: "2026-10-27", count: 1 }], time: [{ customer: "Acme", minutes: 90, billable: true }, { customer: "Acme", minutes: 30, billable: false }] }, ctx);
  const value = (label) => report.summary.find((entry) => entry.label === label).value;
  assert.equal(value("Created"), 3);
  assert.equal(value("Response SLA met"), "50%");
  assert.equal(value("Resolution SLA met"), "0%");
  assert.equal(value("Average first response"), "20m");
  assert.equal(value("Time logged"), "2h 00m");
  assert.equal(value("Billable time"), "1h 30m");
  assert.deepEqual(report.charts[0].series[0].values, [1, 1, 1]);
  assert.deepEqual(report.charts[0].series[1].values, [1, 0, 0]);
  const acme = report.tables[0].rows.find((row) => row.customer === "Acme");
  assert.equal(acme.time, "2h 00m");
});

test("CSV export escapes cells and keeps every row; JSON drops the full list", () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ status: "ended", started_at: "2026-10-28T08:00:00Z", connected_at: "2026-10-28T08:00:00Z", ended_at: "2026-10-28T08:01:00Z", technician: i === 0 ? "=cmd" : "Ann", customer: "Acme, Inc", device: "pc", billable: false }));
  const report = buildReport("sessions", { sessions: many }, ctx);
  const csv = reportCsv(report);
  assert.match(csv, /"Acme, Inc"/);
  assert.match(csv, /'=cmd/);
  assert.equal(csv.split("\r\n").filter((line) => line.endsWith(",No")).length, 501);
  const json = reportJson(report);
  const list = json.tables.find((table) => table.key === "sessions");
  assert.equal(list.rows.length, 500);
  assert.equal(list.allRows, undefined);
  assert.match(list.more, /501/);
});

test("PDF output is a well-formed document with pages, text and a valid xref", () => {
  const report = buildReport("agents", {
    trend: fillDays([{ day: "2026-10-27", agent_versions: { "1.5.1": 2 } }], "2026-10-27", "2026-10-29"),
    items: fleet,
    versions: overviewFrom(fleet, { releases }).agents.versions,
    releases,
  }, ctx);
  report.tables[1].rows = Array.from({ length: 120 }, (_, i) => ({ device: `Device (${i}) \u2013 caf\u00E9 \u2192 x`, customer: "Acme", platform: "Windows", version: "1.5.1", state: "Current", lastSeen: "" }));
  const pdf = reportPdf(report);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const pages = Number(text.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.ok(pages >= 3);
  assert.match(text, /Page 1 of \d+/);
  assert.match(text, /Device \\\(0\\\) \\226 caf\\351 -> x/);
  const xref = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  for (const match of text.matchAll(/(\d{10}) 00000 n /g)) {
    assert.match(text.slice(Number(match[1]), Number(match[1]) + 12), /^\d+ 0 obj/);
  }
});

test("mail bodies attach files as base64 MIME parts", () => {
  assert.deepEqual(mailBody({ text: "Hi\nthere" }), ["Content-Type: text/plain; charset=utf-8", "", "Hi\r\nthere"]);
  const lines = mailBody({ text: "See attached", attachments: [{ filename: 'r"1\n.pdf', contentType: "application/pdf", content: Buffer.alloc(100, 7) }] });
  const boundary = lines[0].match(/boundary="([^"]+)"/)[1];
  assert.equal(lines.filter((line) => line === `--${boundary}`).length, 2);
  assert.equal(lines.at(-1), `--${boundary}--`);
  assert.ok(lines.includes('Content-Disposition: attachment; filename="r 1 .pdf"'));
  const data = lines.slice(lines.indexOf("Content-Transfer-Encoding: base64") + 3, -1).join("");
  assert.deepEqual(Buffer.from(data, "base64"), Buffer.alloc(100, 7));
  assert.ok(lines.every((line) => line.length <= 998));
});

test("PDF text fitting uses Helvetica widths", () => {
  assert.equal(textWidth("i", 10), 2.22);
  assert.equal(textWidth("W", 10, true), 9.44);
  const fitted = fitText("A long customer name that will not fit", 60, 10);
  assert.ok(fitted.endsWith("\u2026"));
  assert.ok(textWidth(fitted, 10) <= 60);
  const doc = new PdfDocument();
  doc.table({ columns: [{ key: "a", label: "A" }], rows: [] });
  assert.ok(doc.toBuffer().length > 500);
});
