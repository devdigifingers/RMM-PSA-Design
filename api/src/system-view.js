import { olderVersion } from "./dashboard-overview.js";

export const PLATFORM_LABEL = { windows: "Windows", linux: "Linux", "": "Other" };

// rows: { platform, agent_version }. releases: { windows, linux } version strings.
// Returns one entry per platform with its devices grouped by agent version, newest first.
export function fleetVersions(rows, releases) {
  const platforms = new Map();
  for (const row of rows) {
    const platform = row.platform || "";
    if (!platforms.has(platform)) platforms.set(platform, new Map());
    const version = row.agent_version || "";
    const versions = platforms.get(platform);
    versions.set(version, (versions.get(version) || 0) + 1);
  }
  const order = ["windows", "linux", ""];
  return [...platforms.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([platform, versions]) => {
      const release = releases[platform] || "";
      const list = [...versions.entries()]
        .map(([version, count]) => ({
          version: version || "Unknown",
          count,
          state: !version ? "unknown" : release && olderVersion(version, release) ? "outdated" : "current",
        }))
        .sort((a, b) => compare(b.version, a.version));
      const total = list.reduce((sum, item) => sum + item.count, 0);
      const outdated = list.filter((item) => item.state !== "current").reduce((sum, item) => sum + item.count, 0);
      return { platform, label: PLATFORM_LABEL[platform] || platform, release, total, outdated, versions: list };
    });
}

function compare(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return left.some(Number.isNaN) ? -1 : 1;
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return (left[i] || 0) - (right[i] || 0);
  return 0;
}
