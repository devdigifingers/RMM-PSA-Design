import { OS_FAMILIES, osFamily, percentages } from "./daily-stats.js";
import { deviceGroup } from "./geoip.js";

export const ZA_PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "North West", "Northern Cape", "Western Cape",
];

const DAY = 24 * 60 * 60 * 1000;
const STALE_MS = 7 * DAY;

function versionParts(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function olderVersion(current, latest) {
  const want = versionParts(latest);
  if (!want) return false;
  const have = versionParts(current);
  if (!have) return true;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== want[i]) return have[i] < want[i];
  }
  return false;
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return left ? -1 : right ? 1 : String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return right[i] - left[i];
  return 0;
}

function platformOf(osName) {
  if (/windows/i.test(osName || "")) return "windows";
  if (osFamily(osName) === "Linux") return "linux";
  return "";
}

// Derived values for one device row. releases: { windows, linux } version strings.
export function deviceFacts(row, { now = Date.now(), releases = {} } = {}) {
  const seenAt = row.last_seen_at ? new Date(row.last_seen_at).getTime() : null;
  const age = seenAt == null ? Infinity : now - seenAt;
  const platform = platformOf(row.os_name);
  const release = releases[platform] || "";
  const metrics = row.metrics || null;
  const total = Number(metrics?.diskTotalBytes);
  const used = Number(metrics?.diskUsedBytes);
  const diskFreePct = total > 0 && used >= 0 ? Math.max(0, ((total - used) / total) * 100) : null;
  const located = Boolean(row.geo_updated_at);
  const country = located && row.geo_country ? row.geo_country : "Unknown";
  return {
    online: age < 60 * 1000,
    stale: age >= STALE_MS,
    lastSeenAt: row.last_seen_at || null,
    family: osFamily(row.os_name),
    build: row.os_build || row.os_version || "",
    platform,
    agentVersion: row.agent_version || "Unknown",
    outdated: Boolean(release) && olderVersion(row.agent_version, release),
    updatable: Boolean(platform) && Boolean(release) && olderVersion(row.agent_version, release),
    diskFreePct,
    lowDisk: diskFreePct != null && diskFreePct < 10,
    country,
    countryName: located ? row.geo_country_name || row.geo_country || "Unknown" : "Unknown",
    region: country === "ZA" ? row.geo_region || "Unknown" : "",
    city: located ? row.geo_city || "" : "",
    group: deviceGroup(row).label,
    site: String(row.site_override || "").trim(),
    missing: Number(row.missing) || 0,
    patched: Number(row.patched) || 0,
    scanned: Array.isArray(row.updates),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
  };
}

const FILTER_KEYS = ["customer", "status", "os", "build", "agent", "outdated", "country", "region", "city", "group", "site", "disk", "patch"];

export function deviceFilterFrom(params) {
  const filter = {};
  for (const key of FILTER_KEYS) {
    const value = String(params.get(key) || "").trim().slice(0, 100);
    if (value) filter[key] = value;
  }
  return filter;
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function deviceMatches(facts, filter) {
  if (filter.customer) {
    if (filter.customer === "none" ? facts.customerId != null : String(facts.customerId) !== filter.customer) return false;
  }
  if (filter.status === "online" && !facts.online) return false;
  if (filter.status === "offline" && facts.online) return false;
  if (filter.status === "stale" && !facts.stale) return false;
  if (filter.os && !same(facts.family, filter.os)) return false;
  if (filter.build && !same(facts.build, filter.build)) return false;
  if (filter.agent) {
    if (filter.agent === "outdated") {
      if (!facts.outdated) return false;
    } else if (!same(facts.agentVersion, filter.agent)) return false;
  }
  if (filter.outdated === "1" && !facts.outdated) return false;
  if (filter.outdated === "0" && facts.outdated) return false;
  if (filter.country) {
    if (filter.country === "other") {
      if (facts.country === "ZA" || facts.country === "Unknown") return false;
    } else if (!same(facts.country, filter.country)) return false;
  }
  if (filter.region && !(facts.country === "ZA" && same(facts.region, filter.region))) return false;
  if (filter.city && !same(facts.city, filter.city)) return false;
  if (filter.group && !same(facts.group, filter.group)) return false;
  if (filter.site) {
    if (filter.site === "none" ? facts.site : !same(facts.site, filter.site)) return false;
  }
  if (filter.disk === "low" && !facts.lowDisk) return false;
  if (filter.patch === "missing" && !(facts.missing > 0)) return false;
  return true;
}

function ranked(counts, limit) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function bump(counts, key, by = 1) {
  counts[key] = (counts[key] || 0) + by;
}

// items: [{ row, facts }] already limited to the selected customer.
export function overviewFrom(items, { releases = {}, monitor = false, patch = false } = {}) {
  const total = items.length;
  const online = items.filter((item) => item.facts.online).length;
  const stale = items.filter((item) => item.facts.stale);
  const scanned = items.filter((item) => item.facts.scanned);

  // A version can be current on one platform and outdated on another (releases differ per platform),
  // so slices are per version and state; a version that has both states is split in two.
  const sliceCounts = {};
  const slicePlatforms = {};
  const statesByVersion = {};
  for (const { facts } of items) {
    const key = `${facts.agentVersion}|${facts.outdated ? 1 : 0}`;
    bump(sliceCounts, key);
    (slicePlatforms[key] ||= new Set()).add(facts.platform || "other");
    (statesByVersion[facts.agentVersion] ||= new Set()).add(facts.outdated);
  }
  const sliceShares = percentages(sliceCounts);
  const platformNames = { windows: "Windows", linux: "Linux", other: "Other" };
  const versions = Object.keys(sliceCounts)
    .map((key) => {
      const [version, state] = key.split("|");
      const split = statesByVersion[version].size > 1;
      return {
        key,
        version,
        outdated: state === "1",
        split,
        platforms: [...slicePlatforms[key]].map((name) => platformNames[name]).sort(),
        count: sliceCounts[key],
        pct: sliceShares[key] || 0,
      };
    })
    .sort((a, b) => compareVersions(a.version, b.version) || Number(a.outdated) - Number(b.outdated));

  const familyCounts = {};
  const builds = {};
  for (const { facts } of items) {
    bump(familyCounts, facts.family);
    if (facts.build) {
      builds[facts.family] ||= {};
      bump(builds[facts.family], facts.build);
    }
  }
  const familyShares = percentages(familyCounts);
  const os = OS_FAMILIES.filter((family) => familyCounts[family]).map((family) => ({
    family,
    count: familyCounts[family],
    pct: familyShares[family] || 0,
    builds: ranked(builds[family] || {}, 3).map(([build, count]) => ({ build, count })),
  }));

  const countryCounts = {};
  const countryNames = {};
  const provinceCounts = {};
  const cityCounts = {};
  const groupCounts = {};
  const groupKinds = {};
  for (const { row, facts } of items) {
    bump(countryCounts, facts.country);
    countryNames[facts.country] = facts.countryName;
    if (facts.country === "ZA") {
      bump(provinceCounts, facts.region);
      if (facts.city) bump(cityCounts, `${facts.city}|${facts.region}`);
    }
    bump(groupCounts, facts.group);
    groupKinds[facts.group] = deviceGroup(row).kind;
  }
  const countryShares = percentages(countryCounts);
  const za = countryCounts.ZA || 0;
  const unknown = countryCounts.Unknown || 0;
  const provinceShares = percentages(Object.fromEntries(ZA_PROVINCES.map((name) => [name, provinceCounts[name] || 0])));
  const location = {
    located: total - unknown,
    unknown,
    unknownPct: countryShares.Unknown || 0,
    zaCount: za,
    zaPct: countryShares.ZA || 0,
    restCount: total - za - unknown,
    restPct: total ? 100 - (countryShares.ZA || 0) - (countryShares.Unknown || 0) : 0,
    countries: ranked(Object.fromEntries(Object.entries(countryCounts).filter(([code]) => code !== "Unknown")), 5)
      .map(([code, count]) => ({ code, name: countryNames[code] || code, count, pct: countryShares[code] || 0 })),
    provinces: ZA_PROVINCES.map((name) => ({ name, count: provinceCounts[name] || 0, pct: provinceShares[name] || 0 })),
    provinceUnknown: provinceCounts.Unknown || 0,
    cities: ranked(cityCounts, 5).map(([key, count]) => {
      const [city, region] = key.split("|");
      return { city, region, count };
    }),
    groups: ranked(groupCounts, 8).map(([label, count]) => ({ label, kind: groupKinds[label], count })),
  };

  const staleList = [...stale]
    .sort((a, b) => (a.facts.lastSeenAt ? new Date(a.facts.lastSeenAt).getTime() : 0) - (b.facts.lastSeenAt ? new Date(b.facts.lastSeenAt).getTime() : 0))
    .slice(0, 5)
    .map(({ row, facts }) => ({
      id: Number(row.id),
      name: row.display_name || row.hostname,
      customer: row.customer_name || null,
      lastSeenAt: facts.lastSeenAt,
    }));

  const customerCounts = {};
  const customerNames = {};
  for (const { row, facts } of items) {
    if (facts.customerId == null) continue;
    bump(customerCounts, facts.customerId);
    customerNames[facts.customerId] = row.customer_name;
  }

  return {
    kpis: {
      total,
      online,
      onlinePct: total ? Math.round((online / total) * 100) : 0,
      stale: stale.length,
      lowDisk: monitor ? items.filter((item) => item.facts.lowDisk).length : null,
      patchedPct: patch && scanned.length ? Math.round((scanned.filter((item) => item.facts.missing === 0).length / scanned.length) * 100) : null,
      missing: patch ? items.reduce((sum, item) => sum + item.facts.missing, 0) : null,
      missingDevices: patch ? items.filter((item) => item.facts.missing > 0).length : null,
    },
    agents: {
      releases,
      versions,
      outdated: items.filter((item) => item.facts.outdated).length,
      updatable: items.filter((item) => item.facts.updatable).length,
    },
    os,
    location,
    stale: { count: stale.length, devices: staleList },
    topCustomers: ranked(customerCounts, 5).map(([id, count]) => ({ id: Number(id), name: customerNames[id], count })),
  };
}
