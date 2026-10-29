// End of vendor support, from the Microsoft, Canonical, Debian and Red Hat lifecycle pages.
// Returns null when the release is still supported for longer than the warning window or is not known.

const WINDOWS_11 = {
  // [Home / Pro, Enterprise / Education]
  "21H2": ["2023-10-10", "2024-10-08"],
  "22H2": ["2024-10-08", "2025-10-14"],
  "23H2": ["2025-11-11", "2026-11-10"],
  "24H2": ["2026-10-13", "2027-10-12"],
  "25H2": ["2027-10-12", "2028-10-10"],
};

const WINDOWS_SERVER = [
  [/server 2008/i, "2020-01-14"],
  [/server 2012/i, "2023-10-10"],
  [/server 2016/i, "2027-01-12"],
  [/server 2019/i, "2029-01-09"],
  [/server 2022/i, "2031-10-14"],
  [/server 2025/i, "2034-10-10"],
];

const LINUX = [
  [/ubuntu/i, /^(\d+\.\d+)/, { "16.04": "2021-04-30", "18.04": "2023-05-31", "20.04": "2025-05-31", "22.04": "2027-06-01", "24.04": "2029-05-31" }],
  [/debian/i, /^(\d+)/, { 9: "2022-06-30", 10: "2024-06-30", 11: "2026-08-31", 12: "2028-06-30" }],
  [/centos stream/i, /^(\d+)/, { 8: "2024-05-31", 9: "2027-05-31" }],
  [/centos/i, /^(\d+)/, { 7: "2024-06-30", 8: "2021-12-31" }],
  [/red hat|rhel/i, /^(\d+)/, { 7: "2024-06-30", 8: "2029-05-31", 9: "2032-05-31" }],
  [/rocky|alma/i, /^(\d+)/, { 8: "2029-05-31", 9: "2032-05-31" }],
  [/fedora/i, /^(\d+)/, { 38: "2024-05-21", 39: "2024-11-26", 40: "2025-05-13", 41: "2025-12-15" }],
];

const DAY = 86400000;
export const SOON_DAYS = 90;

function linuxVersion(osName, osVersion, pattern) {
  const direct = String(osVersion || "").match(pattern);
  if (direct) return direct[1];
  const fromName = String(osName || "").match(/(\d+(?:\.\d+)?)/);
  return fromName ? fromName[1].match(pattern)?.[1] || null : null;
}

// device: { osName, osVersion }. Returns { date, release, state: "ended" | "soon" } or null.
export function endOfSupport({ osName, osVersion }, now = Date.now()) {
  const name = String(osName || "");
  let date = null;
  let release = "";
  if (/windows 7\b/i.test(name)) [date, release] = ["2020-01-14", "Windows 7"];
  else if (/windows 8\.1/i.test(name)) [date, release] = ["2023-01-10", "Windows 8.1"];
  else if (/windows/i.test(name) && /server/i.test(name)) {
    const match = WINDOWS_SERVER.find(([pattern]) => pattern.test(name));
    if (match) [date, release] = [match[1], name.replace(/^microsoft\s+/i, "")];
  } else if (/windows 10/i.test(name)) {
    // LTSC / LTSB editions follow their own ten-year lifecycle, which depends on the release.
    if (!/ltsc|ltsb/i.test(name)) [date, release] = ["2025-10-14", "Windows 10"];
  } else if (/windows 11/i.test(name)) {
    const dates = WINDOWS_11[String(osVersion || "").toUpperCase()];
    if (dates && !/ltsc/i.test(name)) {
      const enterprise = /enterprise|education|iot/i.test(name);
      [date, release] = [dates[enterprise ? 1 : 0], `Windows 11 ${String(osVersion).toUpperCase()}`];
    }
  } else {
    for (const [family, pattern, table] of LINUX) {
      if (!family.test(name)) continue;
      const version = linuxVersion(name, osVersion, pattern);
      if (version && table[version]) [date, release] = [table[version], name.replace(/\s*\(.*\)$/, "")];
      break;
    }
  }
  if (!date) return null;
  const left = new Date(`${date}T00:00:00Z`).getTime() - now;
  if (left > SOON_DAYS * DAY) return null;
  return { date, release, state: left <= 0 ? "ended" : "soon" };
}
