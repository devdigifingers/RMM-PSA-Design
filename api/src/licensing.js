export const FEATURES = {
  remote: ["enrollment", "remote_sessions", "remote_support", "monitoring", "patching"],
  servicedesk: ["ticketing"],
  reporting: ["reporting"],
};

export const FEATURE_KEYS = Object.values(FEATURES).flat();

// Module flags the route checks still read; they are derived from features and never stored.
export const MODULE_FEATURES = {
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
