import assert from "node:assert/strict";
import test from "node:test";
import { dailyStats, fillDays, osFamily, percentages } from "../src/daily-stats.js";

test("osFamily groups operating systems", () => {
  assert.equal(osFamily("Microsoft Windows 11 Pro"), "Windows 11");
  assert.equal(osFamily("Microsoft Windows 10 Enterprise"), "Windows 10");
  assert.equal(osFamily("Microsoft Windows Server 2022 Standard"), "Windows Server");
  assert.equal(osFamily("Fedora Linux 44 (Workstation Edition)"), "Linux");
  assert.equal(osFamily("Ubuntu 24.04.5 LTS"), "Linux");
  assert.equal(osFamily("macOS 15.1"), "macOS");
  assert.equal(osFamily(""), "Other");
});

test("version percentages add up to exactly 100", () => {
  for (const counts of [{ "1.5.1": 1, "1.5.2": 1, "1.4.0": 1 }, { a: 2, b: 5, c: 9, d: 1 }, { only: 3 }]) {
    const shares = percentages(counts);
    assert.equal(Object.values(shares).reduce((sum, value) => sum + value, 0), 100);
  }
  assert.deepEqual(percentages({}), {});
});

test("daily stats match the device list per customer and in total", () => {
  const now = Date.parse("2026-10-29T10:00:00Z");
  const devices = [
    { customer_id: 1, last_seen_at: new Date(now - 10000), agent_version: "1.5.2", os_name: "Windows 11 Pro", geo_updated_at: new Date(now), geo_country: "ZA", geo_region: "Gauteng", patched: 3, missing: 1 },
    { customer_id: 1, last_seen_at: new Date(now - 3600000), agent_version: "1.5.1", os_name: "Windows 10 Pro", geo_updated_at: new Date(now), geo_country: "ZA", geo_region: "Western Cape", patched: 1, missing: 0 },
    { customer_id: 2, last_seen_at: new Date(now - 9 * 86400000), agent_version: "", os_name: "Ubuntu 24.04", geo_updated_at: null, patched: 0, missing: 2 },
    { customer_id: null, last_seen_at: null, agent_version: "1.5.2", os_name: "Windows Server 2022", geo_updated_at: new Date(now), geo_country: "GB", patched: 0, missing: 0 },
  ];
  const groups = dailyStats(devices, now);
  const all = groups.get("all");
  assert.equal(all.deviceCount, 4);
  assert.equal(all.onlineCount, 1);
  assert.equal(all.seenDayCount, 2);
  assert.deepEqual(all.agentVersions, { "1.5.2": 2, "1.5.1": 1, Unknown: 1 });
  assert.deepEqual(all.countryCounts, { ZA: 2, Unknown: 1, GB: 1 });
  assert.deepEqual(all.regionCounts, { Gauteng: 1, "Western Cape": 1 });
  assert.equal(all.patchedCount, 4);
  assert.equal(all.missingCount, 3);
  assert.equal(groups.get("1").deviceCount, 2);
  assert.equal(groups.get("2").osCounts.Linux, 1);
  assert.equal(groups.has("null"), false);
  const sum = Object.values(all.agentVersions).reduce((a, b) => a + b, 0);
  assert.equal(sum, all.deviceCount);
});

test("trends keep empty days", () => {
  const days = fillDays([{ day: "2026-10-27", device_count: 3 }, { day: "2026-10-29", device_count: 4 }], "2026-10-26", "2026-10-29");
  assert.deepEqual(days.map((entry) => entry.day), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  assert.equal(days[0].stats, null);
  assert.equal(days[1].stats.device_count, 3);
  assert.equal(days[2].stats, null);
});
