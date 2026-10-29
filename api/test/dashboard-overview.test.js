import assert from "node:assert/strict";
import test from "node:test";
import { deviceFacts, deviceFilterFrom, deviceMatches, olderVersion, overviewFrom } from "../src/dashboard-overview.js";

const NOW = Date.parse("2026-10-29T10:00:00Z");
const RELEASES = { windows: "1.5.2", linux: "1.5.2" };

function row(id, extra) {
  return {
    id,
    hostname: `PC-${id}`,
    os_name: "Microsoft Windows 11 Pro",
    agent_version: "1.5.2",
    last_seen_at: new Date(NOW - 5000),
    customer_id: 1,
    customer_name: "Acme",
    geo_updated_at: new Date(NOW),
    geo_country: "ZA",
    geo_country_name: "South Africa",
    geo_region: "Gauteng",
    geo_city: "Johannesburg",
    metrics: { diskTotalBytes: 100, diskUsedBytes: 50 },
    updates: [],
    missing: 0,
    ...extra,
  };
}

const ROWS = [
  row(1),
  row(2, { agent_version: "1.5.1", os_name: "Microsoft Windows 10 Pro", metrics: { diskTotalBytes: 100, diskUsedBytes: 95 }, missing: 3 }),
  row(3, { agent_version: "", os_name: "Ubuntu 24.04.5 LTS", last_seen_at: new Date(NOW - 9 * 86400000), customer_id: 2, customer_name: "Beta", geo_region: "Western Cape", geo_city: "Cape Town" }),
  row(4, { geo_country: "GB", geo_country_name: "United Kingdom", geo_region: "England", geo_city: "London", site_override: "London office" }),
  row(5, { geo_updated_at: null, last_seen_at: null, customer_id: null, customer_name: null, updates: null }),
];

function items(rows = ROWS) {
  return rows.map((device) => ({ row: device, facts: deviceFacts(device, { now: NOW, releases: RELEASES }) }));
}

test("olderVersion compares semantic versions", () => {
  assert.equal(olderVersion("1.5.1", "1.5.2"), true);
  assert.equal(olderVersion("1.5.2", "1.5.2"), false);
  assert.equal(olderVersion("1.10.0", "1.9.9"), false);
  assert.equal(olderVersion("", "1.5.2"), true);
  assert.equal(olderVersion("1.0.0", ""), false);
});

test("version, OS and country percentages each add up to 100", () => {
  const overview = overviewFrom(items(), { releases: RELEASES, monitor: true, patch: true });
  const sum = (list) => list.reduce((total, item) => total + item.pct, 0);
  assert.equal(sum(overview.agents.versions), 100);
  assert.equal(sum(overview.os), 100);
  assert.equal(overview.location.zaPct + overview.location.restPct + overview.location.unknownPct, 100);
});

test("dashboard counts match the device list filtered the same way", () => {
  const all = items();
  const overview = overviewFrom(all, { releases: RELEASES, monitor: true, patch: true });
  const count = (query) => all.filter((item) => deviceMatches(item.facts, deviceFilterFrom(new URLSearchParams(query)))).length;
  for (const version of overview.agents.versions) {
    const query = `agent=${encodeURIComponent(version.version)}${version.split ? `&outdated=${version.outdated ? 1 : 0}` : ""}`;
    assert.equal(count(query), version.count, version.key);
  }
  for (const family of overview.os) assert.equal(count(`os=${encodeURIComponent(family.family)}`), family.count);
  for (const province of overview.location.provinces) assert.equal(count(`region=${encodeURIComponent(province.name)}`), province.count);
  assert.equal(count("agent=outdated"), overview.agents.outdated);
  assert.equal(count("status=online"), overview.kpis.online);
  assert.equal(count("status=stale"), overview.kpis.stale);
  assert.equal(count("disk=low"), overview.kpis.lowDisk);
  assert.equal(count("patch=missing"), overview.kpis.missingDevices);
  assert.equal(count("country=other"), overview.location.restCount);
  assert.equal(count("country=Unknown"), overview.location.unknown);
});

test("a version current on Windows but outdated on Linux is split", () => {
  const releases = { windows: "1.5.1", linux: "1.5.2" };
  const rows = [
    row(1, { agent_version: "1.5.1" }),
    row(2, { agent_version: "1.5.1" }),
    row(3, { agent_version: "1.5.1", os_name: "Fedora Linux 44" }),
  ];
  const all = rows.map((device) => ({ row: device, facts: deviceFacts(device, { now: NOW, releases }) }));
  const overview = overviewFrom(all, { releases });
  assert.deepEqual(
    overview.agents.versions.map((item) => [item.version, item.outdated, item.split, item.count, item.platforms.join()]),
    [["1.5.1", false, true, 2, "Windows"], ["1.5.1", true, true, 1, "Linux"]],
  );
  assert.equal(overview.agents.outdated, 1);
  assert.equal(overview.agents.updatable, 1);
  const current = deviceFilterFrom(new URLSearchParams("agent=1.5.1&outdated=0"));
  assert.equal(all.filter((item) => deviceMatches(item.facts, current)).length, 2);
});

test("KPIs and lists reflect the fleet", () => {
  const overview = overviewFrom(items(), { releases: RELEASES, monitor: true, patch: true });
  assert.equal(overview.kpis.total, 5);
  assert.equal(overview.kpis.online, 3);
  assert.equal(overview.kpis.stale, 2);
  assert.equal(overview.kpis.lowDisk, 1);
  assert.equal(overview.kpis.missing, 3);
  assert.equal(overview.kpis.patchedPct, 75);
  assert.equal(overview.agents.outdated, 2);
  assert.equal(overview.agents.updatable, 2);
  assert.equal(overview.stale.devices[0].id, 5);
  assert.deepEqual(overview.location.cities[0], { city: "Johannesburg", region: "Gauteng", count: 2 });
  assert.deepEqual(overview.location.groups.find((group) => group.label === "London office"), { label: "London office", kind: "site", count: 1 });
  assert.deepEqual(overview.topCustomers[0], { id: 1, name: "Acme", count: 3 });
});

test("monitoring and patch figures are hidden without the module", () => {
  const overview = overviewFrom(items(), { releases: RELEASES });
  assert.equal(overview.kpis.lowDisk, null);
  assert.equal(overview.kpis.missing, null);
  assert.equal(overview.kpis.patchedPct, null);
});

test("customer filter keeps only that customer's devices", () => {
  const all = items();
  const filter = deviceFilterFrom(new URLSearchParams("customer=2"));
  assert.deepEqual(all.filter((item) => deviceMatches(item.facts, filter)).map((item) => item.row.id), [3]);
  const none = deviceFilterFrom(new URLSearchParams("customer=none"));
  assert.deepEqual(all.filter((item) => deviceMatches(item.facts, none)).map((item) => item.row.id), [5]);
});

test("an empty fleet gives zeros, not errors", () => {
  const overview = overviewFrom([], { releases: RELEASES, monitor: true, patch: true });
  assert.equal(overview.kpis.total, 0);
  assert.equal(overview.kpis.onlinePct, 0);
  assert.deepEqual(overview.agents.versions, []);
  assert.equal(overview.location.restPct, 0);
});
