import {
  LEGACY_MODULE_FEATURES,
  legacyEffective,
  licenseFromRow,
  packageFromRow,
  planBackfill,
  resolve,
} from "./licensing.js";

export const LICENSE_V2 = process.env.LICENSE_V2 === "true";

const LICENSE_SQL = `
  SELECT l.*, p.code AS package_code, p.name AS package_name, p.features AS package_features,
         p.default_seats AS package_default_seats, p.default_devices AS package_default_devices,
         p.default_sessions AS package_default_sessions, p.is_custom AS package_is_custom
  FROM licenses l
  LEFT JOIN packages p ON p.id = l.package_id
  WHERE l.org_id = $1`;

export function modulesFromFeatures(features) {
  const modules = {};
  for (const [module, feature] of Object.entries(LEGACY_MODULE_FEATURES)) modules[module] = features.includes(feature);
  return modules;
}

function packageOf(row) {
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

export function effectiveRow(row, now = new Date(), { force = false } = {}) {
  if (!row) return null;
  if ((!LICENSE_V2 && !force) || row.package_id == null) {
    const entitlements = legacyEffective(row, now);
    return { ...row, status: entitlements.status, entitlements, package: null };
  }
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
    package: { code: pkg.code, name: pkg.name, isCustom: pkg.isCustom },
  };
}

export async function loadLicense(db, orgId, { lock = false, force = false } = {}) {
  if (orgId == null) return null;
  const result = await db.query(`${LICENSE_SQL}${lock ? " FOR UPDATE OF l" : ""}`, [orgId]);
  return effectiveRow(result.rows[0], new Date(), { force });
}

export async function loadAllLicenses(db) {
  const result = await db.query(LICENSE_SQL.replace("WHERE l.org_id = $1", "ORDER BY l.org_id"));
  return new Map(result.rows.map((row) => [Number(row.org_id), effectiveRow(row, new Date(), { force: true })]));
}

// Keeps the pre-package columns equal to the package model so LICENSE_V2=false stays a working rollback.
export async function syncLegacyFromPackage(client, orgId) {
  const result = await client.query(`${LICENSE_SQL} FOR UPDATE OF l`, [orgId]);
  const row = result.rows[0];
  if (!row || row.package_id == null) return null;
  const effective = resolve(packageOf(row), licenseFromRow(row));
  await client.query(
    `UPDATE licenses SET modules = $2::jsonb, seats = $3, device_cap = $4, support_concurrent = $5 WHERE org_id = $1`,
    [orgId, JSON.stringify(modulesFromFeatures(effective.features)), effective.seats, effective.devices, effective.sessions],
  );
  return effective;
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

const TENANT_SQL = `
  SELECT o.id AS org_id, o.name, o.slug,
         l.id, l.plan, l.seats, l.device_cap, l.support_concurrent, l.expires_at, l.modules,
         l.package_id, l.seats_override, l.devices_override, l.sessions_override,
         l.features_added, l.features_removed, l.no_expiry, l.status
  FROM orgs o
  JOIN licenses l ON l.org_id = o.id`;

export async function loadTenantLicenses(db) {
  return (await db.query(`${TENANT_SQL} ORDER BY o.id`)).rows;
}

export async function loadPackages(db) {
  const result = await db.query("SELECT * FROM packages ORDER BY id");
  return result.rows.map(packageFromRow);
}

export function currentAssignment(row, packages) {
  if (row.package_id == null) return null;
  const pkg = packages.find((item) => item.id === Number(row.package_id));
  return pkg ? { package: pkg, license: licenseFromRow(row) } : null;
}

const list = (value) => [...(value || [])].sort().join(",");

function sameAssignment(current, plan) {
  if (!current || current.package.code !== plan.package.code) return false;
  const a = current.license;
  const b = plan.license;
  return a.seatsOverride === b.seatsOverride
    && a.devicesOverride === b.devicesOverride
    && a.sessionsOverride === b.sessionsOverride
    && list(a.featuresAdded) === list(b.featuresAdded)
    && list(a.featuresRemoved) === list(b.featuresRemoved)
    && a.noExpiry === b.noExpiry
    && a.status === b.status;
}

function customPackageDiffers(existing, wanted) {
  return existing.name !== wanted.name
    || list(existing.features) !== list(wanted.features)
    || existing.defaultSeats !== wanted.defaultSeats
    || existing.defaultDevices !== wanted.defaultDevices
    || existing.defaultSessions !== wanted.defaultSessions
    || existing.isCustom !== true;
}

export function describeAssignment(state) {
  if (!state) return "not assigned";
  const lic = state.license;
  const parts = [`package ${state.package.code}`];
  if (lic.seatsOverride != null) parts.push(`seats ${lic.seatsOverride}`);
  if (lic.devicesOverride != null) parts.push(`devices ${lic.devicesOverride}`);
  if (lic.sessionsOverride != null) parts.push(`sessions ${lic.sessionsOverride}`);
  if (lic.featuresAdded?.length) parts.push(`+${lic.featuresAdded.join(",")}`);
  if (lic.featuresRemoved?.length) parts.push(`-${lic.featuresRemoved.join(",")}`);
  parts.push(lic.noExpiry ? "no expiry" : `expires ${new Date(lic.expiresAt).toISOString().slice(0, 10)}`);
  parts.push(lic.status);
  return parts.join(", ");
}

async function upsertCustomPackage(client, pkg) {
  const result = await client.query(
    `INSERT INTO packages (code, name, description, features, default_seats, default_devices, default_sessions, active, is_custom)
     VALUES ($1, $2, 'Created from the tenant''s license', $3, $4, $5, $6, true, true)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, features = EXCLUDED.features,
           default_seats = EXCLUDED.default_seats, default_devices = EXCLUDED.default_devices,
           default_sessions = EXCLUDED.default_sessions, is_custom = true, updated_at = now()
     RETURNING *`,
    [pkg.code, pkg.name, pkg.features, pkg.defaultSeats, pkg.defaultDevices, pkg.defaultSessions],
  );
  return packageFromRow(result.rows[0]);
}

// Must run inside the caller's transaction. Writes an audit row only when something changes.
export async function syncPackageFromLegacy(client, orgId, { actorId = null, action = "license.backfill" } = {}) {
  const locked = await client.query(`${TENANT_SQL} WHERE o.id = $1 FOR UPDATE OF l`, [orgId]);
  const row = locked.rows[0];
  if (!row) return null;
  const packages = await loadPackages(client);
  const before = currentAssignment(row, packages);
  const plan = planBackfill(row, packages);
  if (sameAssignment(before, plan) && (!plan.customPackage || !customPackageDiffers(before.package, plan.customPackage))) {
    return { changed: false, row, before, plan };
  }
  const pkg = plan.customPackage ? await upsertCustomPackage(client, plan.customPackage) : plan.package;
  const lic = plan.license;
  await client.query(
    `UPDATE licenses
     SET package_id = $2, seats_override = $3, devices_override = $4, sessions_override = $5,
         features_added = $6, features_removed = $7, no_expiry = $8, updated_by = $9, updated_at = now()
     WHERE id = $1`,
    [row.id, pkg.id, lic.seatsOverride, lic.devicesOverride, lic.sessionsOverride, lic.featuresAdded, lic.featuresRemoved, lic.noExpiry, actorId],
  );
  const after = { package: pkg, license: lic };
  await client.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, 'license', $4, $5::jsonb)`,
    [row.org_id, actorId, action, String(row.id), JSON.stringify({ before: describeAssignment(before), after: describeAssignment(after) })],
  );
  return { changed: true, row, before, plan: { ...plan, package: pkg } };
}
