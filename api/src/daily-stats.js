export const OS_FAMILIES = ["Windows 11", "Windows 10", "Windows Server", "macOS", "Linux", "Other"];

export function osFamily(osName) {
  const name = String(osName || "");
  if (/windows/i.test(name) && /server/i.test(name)) return "Windows Server";
  if (/windows\s*11/i.test(name)) return "Windows 11";
  if (/windows\s*10/i.test(name)) return "Windows 10";
  if (/mac\s?os|os x|darwin/i.test(name)) return "macOS";
  if (/linux|ubuntu|debian|fedora|centos|rocky|alma|red hat|rhel|suse|mint/i.test(name)) return "Linux";
  return "Other";
}

function bump(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

// Shares that always add up to exactly 100 (largest remainder), so charts and tables agree.
export function percentages(counts) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return {};
  const raw = entries.map(([key, count]) => ({ key, exact: (count * 100) / total }));
  const result = Object.fromEntries(raw.map(({ key, exact }) => [key, Math.floor(exact)]));
  let left = 100 - Object.values(result).reduce((sum, value) => sum + value, 0);
  for (const { key } of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.key.localeCompare(b.key))) {
    if (left <= 0) break;
    result[key] += 1;
    left -= 1;
  }
  return result;
}

function emptyStats() {
  return {
    deviceCount: 0,
    onlineCount: 0,
    seenDayCount: 0,
    agentVersions: {},
    osCounts: {},
    countryCounts: {},
    regionCounts: {},
    buildCounts: {},
    patchedCount: 0,
    missingCount: 0,
    scannedCount: 0,
    compliantCount: 0,
  };
}

// devices: rows with customer_id, last_seen_at, agent_version, os_name, os_version, geo_country, geo_region,
// geo_updated_at, patched (number), missing (number) and scanned (boolean). Returns the org total under key "all".
export function dailyStats(devices, now = Date.now()) {
  const groups = new Map([["all", emptyStats()]]);
  for (const device of devices) {
    const keys = ["all"];
    if (device.customer_id != null) keys.push(String(device.customer_id));
    const seen = device.last_seen_at ? now - new Date(device.last_seen_at).getTime() : Infinity;
    const located = Boolean(device.geo_updated_at);
    const country = located && device.geo_country ? device.geo_country : "Unknown";
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, emptyStats());
      const stats = groups.get(key);
      stats.deviceCount += 1;
      if (seen < 60 * 1000) stats.onlineCount += 1;
      if (seen < 24 * 60 * 60 * 1000) stats.seenDayCount += 1;
      bump(stats.agentVersions, device.agent_version || "Unknown");
      bump(stats.osCounts, osFamily(device.os_name));
      if (device.os_version) bump(stats.buildCounts, `${osFamily(device.os_name)} ${device.os_version}`);
      bump(stats.countryCounts, country);
      if (country === "ZA") bump(stats.regionCounts, device.geo_region || "Unknown");
      stats.patchedCount += Number(device.patched) || 0;
      stats.missingCount += Number(device.missing) || 0;
      if (device.scanned) {
        stats.scannedCount += 1;
        if (!(Number(device.missing) > 0)) stats.compliantCount += 1;
      }
    }
  }
  return groups;
}

function dayText(date) {
  return date.toISOString().slice(0, 10);
}

// One entry per calendar day from..to inclusive; days without a snapshot come back as null.
export function fillDays(rows, from, to) {
  const byDay = new Map(rows.map((row) => [String(row.day).slice(0, 10), row]));
  const result = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let guard = 0; cursor <= end && guard < 1000; guard += 1) {
    const day = dayText(cursor);
    result.push({ day, stats: byDay.get(day) || null });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
