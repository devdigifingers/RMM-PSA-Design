import { licenseFromRow, MODULE_FEATURES, resolve } from "./licensing.js";

const LICENSE_SQL = `
  SELECT l.*, p.code AS package_code, p.name AS package_name, p.features AS package_features,
         p.default_seats AS package_default_seats, p.default_devices AS package_default_devices,
         p.default_sessions AS package_default_sessions, p.is_custom AS package_is_custom
  FROM licenses l
  LEFT JOIN packages p ON p.id = l.package_id
  WHERE l.org_id = $1`;

const NO_PACKAGE = { id: null, code: null, name: null, features: [], defaultSeats: 0, defaultDevices: 0, defaultSessions: 0, isCustom: false };

export function modulesFromFeatures(features) {
  const modules = {};
  for (const [module, feature] of Object.entries(MODULE_FEATURES)) modules[module] = features.includes(feature);
  return modules;
}

function packageOf(row) {
  if (row.package_id == null) return NO_PACKAGE;
  return {
    id: Number(row.package_id),
    code: row.package_code,
    name: row.package_name,
    features: row.package_features || [],
    defaultSeats: row.package_default_seats,
    defaultDevices: row.package_default_devices,
    defaultSessions: row.package_default_sessions,
    isCustom: row.package_is_custom === true,
  };
}

export function effectiveRow(row, now = new Date()) {
  if (!row) return null;
  const pkg = packageOf(row);
  const entitlements = resolve(pkg, licenseFromRow(row), now);
  return {
    ...row,
    modules: modulesFromFeatures(entitlements.features),
    seats: entitlements.seats,
    device_cap: entitlements.devices,
    support_concurrent: entitlements.sessions,
    status: entitlements.status,
    entitlements,
    package: pkg.code ? { code: pkg.code, name: pkg.name, isCustom: pkg.isCustom } : null,
  };
}

export async function loadLicense(db, orgId, { lock = false } = {}) {
  if (orgId == null) return null;
  const result = await db.query(`${LICENSE_SQL}${lock ? " FOR UPDATE OF l" : ""}`, [orgId]);
  return effectiveRow(result.rows[0]);
}

export async function loadAllLicenses(db) {
  const result = await db.query(LICENSE_SQL.replace("WHERE l.org_id = $1", "ORDER BY l.org_id"));
  return new Map(result.rows.map((row) => [Number(row.org_id), effectiveRow(row)]));
}

export function licenseSnapshot(row) {
  return {
    packageId: row.package_id == null ? null : Number(row.package_id),
    packageCode: row.package_code ?? null,
    licenseType: row.plan,
    seatsOverride: row.seats_override,
    devicesOverride: row.devices_override,
    sessionsOverride: row.sessions_override,
    featuresAdded: [...(row.features_added || [])].sort(),
    featuresRemoved: [...(row.features_removed || [])].sort(),
    noExpiry: row.no_expiry === true,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    status: row.status || "active",
  };
}

export function snapshotChanges(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

export async function lockedLicenseRow(client, orgId) {
  const result = await client.query(`${LICENSE_SQL} FOR UPDATE OF l`, [orgId]);
  return result.rows[0] || null;
}
