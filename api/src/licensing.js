export const FEATURES = {
  remote: ["enrollment", "remote_sessions", "remote_support", "monitoring", "patching"],
  servicedesk: ["ticketing"],
  reporting: ["reporting"],
};

export const FEATURE_KEYS = Object.values(FEATURES).flat();

export const ADDON_FEATURES = ["reporting"];

export const SEED_PACKAGE_CODES = ["REMOTE", "SERVICE", "SUITE"];

export const LEGACY_MODULE_FEATURES = {
  core: "enrollment",
  remote_desktop: "remote_sessions",
  remote_support: "remote_support",
  monitoring: "monitoring",
  patch: "patching",
  ticketing: "ticketing",
  reporting: "reporting",
};

function featureSet(list) {
  return new Set((Array.isArray(list) ? list : []).filter((key) => FEATURE_KEYS.includes(key)));
}

function ordered(set) {
  return FEATURE_KEYS.filter((key) => set.has(key));
}

function expired(expiresAt, now) {
  if (!expiresAt) return false;
  const end = new Date(expiresAt).getTime();
  return Number.isFinite(end) && end < now.getTime();
}

export function licenseStatus(lic, now = new Date()) {
  if (lic?.status === "suspended") return "suspended";
  if (!lic?.noExpiry && expired(lic?.expiresAt, now)) return "expired";
  return "active";
}

export function appsFor(features) {
  const set = featureSet(features);
  return Object.keys(FEATURES).filter((app) => FEATURES[app].some((key) => set.has(key)));
}

export function resolve(pkg, lic, now = new Date()) {
  const features = featureSet(pkg?.features);
  for (const key of featureSet(lic?.featuresAdded)) features.add(key);
  for (const key of featureSet(lic?.featuresRemoved)) features.delete(key);
  const list = ordered(features);
  const status = licenseStatus(lic, now);
  return {
    features: list,
    apps: appsFor(list),
    seats: lic?.seatsOverride ?? pkg.defaultSeats,
    devices: lic?.devicesOverride ?? pkg.defaultDevices,
    sessions: lic?.sessionsOverride ?? pkg.defaultSessions,
    status,
    active: status === "active",
  };
}

export function hasFeature(effective, feature) {
  return Boolean(effective?.active && effective.features.includes(feature));
}

export function hasApp(effective, app) {
  return Boolean(effective?.active && effective.apps.includes(app));
}

export function legacyFeatures(modules) {
  const set = new Set();
  for (const [module, feature] of Object.entries(LEGACY_MODULE_FEATURES)) {
    if (modules?.[module] === true) set.add(feature);
  }
  return ordered(set);
}

export function legacyEffective(row, now = new Date()) {
  const features = legacyFeatures(row?.modules);
  const status = expired(row?.expires_at, now) ? "expired" : "active";
  return {
    features,
    apps: appsFor(features),
    seats: row.seats,
    devices: row.device_cap,
    sessions: row.support_concurrent,
    status,
    active: status === "active",
  };
}

export function packageFromRow(row) {
  return {
    id: row.id == null ? null : Number(row.id),
    code: row.code,
    name: row.name,
    features: row.features || [],
    defaultSeats: row.default_seats,
    defaultDevices: row.default_devices,
    defaultSessions: row.default_sessions,
    active: row.active,
    isCustom: row.is_custom,
  };
}

export function licenseFromRow(row) {
  return {
    packageId: row.package_id == null ? null : Number(row.package_id),
    licenseType: row.plan,
    seatsOverride: row.seats_override,
    devicesOverride: row.devices_override,
    sessionsOverride: row.sessions_override,
    featuresAdded: row.features_added || [],
    featuresRemoved: row.features_removed || [],
    noExpiry: row.no_expiry === true,
    expiresAt: row.expires_at,
    status: row.status || "active",
  };
}

function sameSet(a, b) {
  const left = featureSet(a);
  const right = featureSet(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
}

export function planBackfill(row, packages) {
  const features = legacyFeatures(row.modules);
  const addons = features.filter((key) => ADDON_FEATURES.includes(key));
  const base = features.filter((key) => !ADDON_FEATURES.includes(key));
  const seed = base.length
    ? packages.find((pkg) => !pkg.isCustom && SEED_PACKAGE_CODES.includes(pkg.code) && sameSet(pkg.features, base))
    : null;
  const noExpiry = !row.expires_at;
  const common = {
    featuresRemoved: [],
    noExpiry,
    expiresAt: noExpiry ? null : row.expires_at,
    status: row.status === "suspended" ? "suspended" : "active",
  };
  if (seed) {
    return {
      package: seed,
      customPackage: null,
      license: {
        ...common,
        seatsOverride: row.seats === seed.defaultSeats ? null : row.seats,
        devicesOverride: row.device_cap === seed.defaultDevices ? null : row.device_cap,
        sessionsOverride: row.support_concurrent === seed.defaultSessions ? null : row.support_concurrent,
        featuresAdded: addons,
      },
    };
  }
  const customPackage = {
    code: `CUSTOM-${String(row.slug).toUpperCase()}`,
    name: `${row.name} (custom)`,
    features,
    defaultSeats: row.seats,
    defaultDevices: row.device_cap,
    defaultSessions: row.support_concurrent,
    active: true,
    isCustom: true,
  };
  return {
    package: customPackage,
    customPackage,
    license: {
      ...common,
      seatsOverride: null,
      devicesOverride: null,
      sessionsOverride: null,
      featuresAdded: [],
    },
  };
}

export function effectiveDiff(before, after) {
  const diffs = [];
  if (!sameSet(before.features, after.features)) {
    diffs.push({ field: "features", before: before.features, after: after.features });
  }
  for (const field of ["seats", "devices", "sessions", "active"]) {
    if (before[field] !== after[field]) diffs.push({ field, before: before[field], after: after[field] });
  }
  return diffs;
}
