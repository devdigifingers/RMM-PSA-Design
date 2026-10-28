import { pool } from "./db.js";
import { FEATURE_KEYS, appsFor } from "./licensing.js";
import {
  licenseSnapshot,
  loadAllLicenses,
  loadLicense,
  lockedLicenseRow,
  snapshotChanges,
} from "./license-store.js";
import { InputError, csvCell, dayBound, noticeState } from "./admin-format.js";

export const LICENSE_TYPES = ["operator", "licensee", "standard"];
const PACKAGE_CODE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUDIT_PAGE_SIZE = 50;
const AUDIT_EXPORT_LIMIT = 10000;
const SUPPORT_LIVE = ["waiting", "connected"];

async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction was already closed.
    }
    throw error;
  } finally {
    client.release();
  }
}

function audit(client, orgId, actorId, action, targetType, targetId, detail) {
  return client.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, actorId, action, targetType, targetId == null ? null : String(targetId), JSON.stringify(detail || {})],
  );
}

function text(value, max) {
  return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "";
}

function wholeNumber(value, label, min, max, { optional = false } = {}) {
  if (value == null || value === "") {
    if (optional) return null;
    throw new InputError(`Enter ${label}.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new InputError(`${label[0].toUpperCase()}${label.slice(1)} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function featureList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Features must be a list.");
  const set = new Set();
  for (const key of value) {
    if (!FEATURE_KEYS.includes(key)) throw new InputError(`Unknown feature: ${String(key).slice(0, 40)}.`);
    set.add(key);
  }
  return FEATURE_KEYS.filter((key) => set.has(key));
}

function packageView(row) {
  const features = row.features || [];
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description || "",
    features,
    apps: appsFor(features),
    defaultSeats: row.default_seats,
    defaultDevices: row.default_devices,
    defaultSessions: row.default_sessions,
    priceMonthly: row.price_monthly == null ? null : Number(row.price_monthly),
    currency: row.currency,
    active: row.active === true,
    isCustom: row.is_custom === true,
    tenantCount: row.tenant_count == null ? undefined : Number(row.tenant_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePackage(body) {
  const name = text(body.name, 80);
  if (!name) throw new InputError("Enter a package name.");
  const features = featureList(body.features);
  if (!features.length) throw new InputError("Choose at least one feature.");
  let priceMonthly = null;
  if (body.priceMonthly != null && body.priceMonthly !== "") {
    priceMonthly = Number(body.priceMonthly);
    if (!Number.isFinite(priceMonthly) || priceMonthly < 0 || priceMonthly > 10000000) throw new InputError("Enter a price of zero or more.");
    priceMonthly = Math.round(priceMonthly * 100) / 100;
  }
  return {
    name,
    description: text(body.description, 300),
    features,
    defaultSeats: wholeNumber(body.defaultSeats, "default seats", 1, 100000),
    defaultDevices: wholeNumber(body.defaultDevices, "default devices", 0, 1000000),
    defaultSessions: wholeNumber(body.defaultSessions, "default sessions", 0, 100),
    priceMonthly,
    active: body.active !== false,
  };
}

function parseExpiry(body, expiryFrom) {
  const noExpiry = body.noExpiry === true;
  if (noExpiry) return { noExpiry, expiresAt: null };
  const expiry = expiryFrom(body.expiresAt);
  if (expiry.error) throw new InputError("Enter a valid expiry date.");
  if (!expiry.value) throw new InputError("Choose an expiry date, or turn on No expiry.");
  return { noExpiry, expiresAt: expiry.value };
}

function parseLicenseEdit(body, expiryFrom) {
  const packageId = wholeNumber(body.packageId, "a package", 1, Number.MAX_SAFE_INTEGER);
  const licenseType = text(body.licenseType, 20).toLowerCase();
  if (!LICENSE_TYPES.includes(licenseType)) throw new InputError("Choose a license type.");
  const status = body.status === "suspended" ? "suspended" : "active";
  return {
    packageId,
    licenseType,
    seatsOverride: wholeNumber(body.seatsOverride, "seats", 1, 100000, { optional: true }),
    devicesOverride: wholeNumber(body.devicesOverride, "devices", 0, 1000000, { optional: true }),
    sessionsOverride: wholeNumber(body.sessionsOverride, "sessions", 0, 100, { optional: true }),
    featuresAdded: featureList(body.featuresAdded),
    featuresRemoved: featureList(body.featuresRemoved),
    ...parseExpiry(body, expiryFrom),
    status,
  };
}

async function packageForAssignment(client, packageId, currentId) {
  const found = await client.query("SELECT * FROM packages WHERE id = $1", [packageId]);
  const row = found.rows[0];
  if (!row) throw new InputError("That package does not exist.");
  if (!row.active && Number(row.id) !== Number(currentId)) throw new InputError("That package is not active.");
  return row;
}

function tenantSummary(row, license) {
  const ent = license?.entitlements;
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    licenseNumber: 900000000 + Number(row.license_id),
    licenseType: license?.plan || row.plan,
    package: license?.package || null,
    packageId: license?.package_id == null ? null : Number(license.package_id),
    status: license?.status || "active",
    noExpiry: license?.no_expiry === true,
    expiresAt: license?.expires_at || null,
    seats: license?.seats ?? null,
    devices: license?.device_cap ?? null,
    sessions: license?.support_concurrent ?? null,
    features: ent?.features || [],
    apps: ent?.apps || [],
    seatsUsed: row.seats_used,
    deviceCount: row.device_count,
  };
}

const TENANT_ROWS_SQL = `
  SELECT o.id, o.name, o.slug, o.created_at, l.id AS license_id, l.plan,
         (SELECT count(*)::int FROM devices d WHERE d.org_id = o.id) AS device_count,
         (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND u.is_platform_admin = false AND u.disabled_at IS NULL) AS seats_used
  FROM orgs o
  JOIN licenses l ON l.org_id = o.id`;

function localTime(value) {
  if (value == null || value === "") return null;
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? new Date(`${raw}:00+02:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new InputError("Use a valid date and time.");
  return date;
}

// Returns true when the request was handled.
export async function handlePlatformAdmin(req, res, url, actor, h) {
  if (!url.pathname.startsWith("/v1/platform/")) return false;
  const path = url.pathname;
  const route = (method, pattern) => {
    if (req.method !== method) return null;
    if (typeof pattern === "string") return path === pattern ? [] : null;
    const match = path.match(pattern);
    return match ? match.slice(1) : null;
  };
  const handlers = [
    ["GET", "/v1/platform/packages", listPackages],
    ["POST", "/v1/platform/packages", createPackage],
    ["GET", /^\/v1\/platform\/packages\/(\d+)$/, getPackage],
    ["PUT", /^\/v1\/platform\/packages\/(\d+)$/, updatePackage],
    ["GET", "/v1/platform/tenants", listTenants],
    ["POST", "/v1/platform/tenants", createTenant],
    ["GET", "/v1/platform/slug-check", slugCheck],
    ["GET", /^\/v1\/platform\/tenants\/(\d+)$/, getTenant],
    ["PUT", /^\/v1\/platform\/tenants\/(\d+)\/license$/, updateLicense],
    ["POST", /^\/v1\/platform\/tenants\/(\d+)\/users$/, addUser],
    ["PUT", /^\/v1\/platform\/users\/(\d+)$/, updateUser],
    ["GET", "/v1/platform/notices", listNotices],
    ["POST", "/v1/platform/notices", publishNotice],
    ["DELETE", /^\/v1\/platform\/notices\/(\d+)$/, unpublishNotice],
    ["GET", "/v1/platform/audit", listAudit],
  ];
  for (const [method, pattern, handler] of handlers) {
    const params = route(method, pattern);
    if (!params) continue;
    if (!h.requirePlatform(actor, res)) return true;
    try {
      await handler(...params);
    } catch (error) {
      if (error instanceof InputError) {
        h.send(res, error.status, { error: error.message, ...error.extra });
        return true;
      }
      throw error;
    }
    return true;
  }
  return false;

  async function listPackages() {
    const result = await pool.query(
      `SELECT p.*, (SELECT count(*)::int FROM licenses l WHERE l.package_id = p.id) AS tenant_count
       FROM packages p
       ORDER BY p.is_custom, p.active DESC, lower(p.name)`,
    );
    h.send(res, 200, { packages: result.rows.map(packageView) });
  }

  async function getPackage(id) {
    const found = await pool.query(
      `SELECT p.*, (SELECT count(*)::int FROM licenses l WHERE l.package_id = p.id) AS tenant_count
       FROM packages p WHERE p.id = $1`,
      [id],
    );
    if (!found.rows[0]) return h.send(res, 404, { error: "Package not found." });
    const tenants = await pool.query(
      `SELECT o.id, o.name, o.slug FROM orgs o JOIN licenses l ON l.org_id = o.id WHERE l.package_id = $1 ORDER BY lower(o.name)`,
      [id],
    );
    h.send(res, 200, {
      package: packageView(found.rows[0]),
      tenants: tenants.rows.map((row) => ({ id: Number(row.id), name: row.name, slug: row.slug })),
    });
  }

  async function createPackage() {
    const body = await h.readJson(req);
    const input = parsePackage(body);
    const code = text(body.code, 40).toUpperCase();
    if (!PACKAGE_CODE.test(code)) throw new InputError("Use capital letters, numbers, and hyphens for the code.");
    try {
      const id = await tx(async (client) => {
        const created = await client.query(
          `INSERT INTO packages (code, name, description, features, default_seats, default_devices, default_sessions, price_monthly, active, is_custom)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [code, input.name, input.description, input.features, input.defaultSeats, input.defaultDevices, input.defaultSessions,
            input.priceMonthly, input.active, code.startsWith("CUSTOM-")],
        );
        const pkg = packageView(created.rows[0]);
        await audit(client, null, actor.id, "package.create", "package", pkg.id, { after: pkg });
        return pkg.id;
      });
      h.send(res, 201, { id });
    } catch (error) {
      if (error.code === "23505") throw new InputError("A package with that code already exists.", 409);
      throw error;
    }
  }

  async function updatePackage(id) {
    const body = await h.readJson(req);
    const input = parsePackage(body);
    const result = await tx(async (client) => {
      const locked = await client.query("SELECT * FROM packages WHERE id = $1 FOR UPDATE", [id]);
      if (!locked.rows[0]) return null;
      const before = packageView(locked.rows[0]);
      const tenants = await client.query("SELECT org_id FROM licenses WHERE package_id = $1 ORDER BY org_id FOR UPDATE", [id]);
      const affected = tenants.rows.length;
      const pending = snapshotChanges(
        {
          name: before.name, description: before.description, features: before.features, defaultSeats: before.defaultSeats,
          defaultDevices: before.defaultDevices, defaultSessions: before.defaultSessions, priceMonthly: before.priceMonthly, active: before.active,
        },
        input,
      );
      if (!Object.keys(pending).length) return { affected, changed: false };
      if (affected > 0 && body.confirm !== true) {
        throw new InputError(`This change affects ${affected} tenant${affected === 1 ? "" : "s"}. Confirm it to save.`, 409, { affected });
      }
      const updated = await client.query(
        `UPDATE packages
         SET name = $2, description = $3, features = $4, default_seats = $5, default_devices = $6,
             default_sessions = $7, price_monthly = $8, active = $9, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, input.name, input.description, input.features, input.defaultSeats, input.defaultDevices,
          input.defaultSessions, input.priceMonthly, input.active],
      );
      const after = packageView(updated.rows[0]);
      const changes = snapshotChanges(
        { ...before, tenantCount: undefined, updatedAt: undefined },
        { ...after, tenantCount: undefined, updatedAt: undefined },
      );
      if (!Object.keys(changes).length) return { affected, changed: false };
      const action = before.active && !after.active ? "package.deactivate" : "package.update";
      await audit(client, null, actor.id, action, "package", id, { changes, affectedTenants: affected });
      return { affected, changed: true };
    });
    if (!result) return h.send(res, 404, { error: "Package not found." });
    h.send(res, 200, { ok: true, ...result });
  }

  async function listTenants() {
    const [rows, licenses] = await Promise.all([
      pool.query(`${TENANT_ROWS_SQL} ORDER BY lower(o.name)`),
      loadAllLicenses(pool),
    ]);
    h.send(res, 200, { tenants: rows.rows.map((row) => tenantSummary(row, licenses.get(Number(row.id)))) });
  }

  async function slugCheck() {
    const slug = String(url.searchParams.get("slug") || "").trim();
    if (!SLUG.test(slug) || slug.length > 60) return h.send(res, 200, { valid: false, available: false });
    const found = await pool.query("SELECT 1 FROM orgs WHERE slug = $1", [slug]);
    h.send(res, 200, { valid: true, available: !found.rows[0] });
  }

  async function getTenant(id) {
    const found = await pool.query(`${TENANT_ROWS_SQL} WHERE o.id = $1`, [id]);
    const row = found.rows[0];
    if (!row) return h.send(res, 404, { error: "Tenant not found." });
    const license = await loadLicense(pool, id, { force: true });
    const [users, packages, sessions] = await Promise.all([
      h.orgUsers(id),
      pool.query(
        `SELECT p.*, (SELECT count(*)::int FROM licenses l WHERE l.package_id = p.id) AS tenant_count
         FROM packages p WHERE p.active OR p.id = $1 ORDER BY p.is_custom, lower(p.name)`,
        [license?.package_id ?? 0],
      ),
      pool.query("SELECT count(*)::int AS n FROM support_sessions WHERE org_id = $1 AND status = ANY($2::text[])", [id, SUPPORT_LIVE]),
    ]);
    h.send(res, 200, {
      tenant: tenantSummary(row, license),
      license: license
        ? {
            ...licenseSnapshot(license),
            updatedAt: license.updated_at,
            effective: license.entitlements,
          }
        : null,
      usage: { seatsUsed: row.seats_used, deviceCount: row.device_count, sessionsRunning: sessions.rows[0].n },
      users,
      packages: packages.rows.map(packageView),
    });
  }

  async function updateLicense(id) {
    const input = parseLicenseEdit(await h.readJson(req), h.expiryFrom);
    const result = await tx(async (client) => {
      const current = await lockedLicenseRow(client, id);
      if (!current) return null;
      await packageForAssignment(client, input.packageId, current.package_id);
      const before = licenseSnapshot(current);
      await client.query(
        `UPDATE licenses
         SET package_id = $2, plan = $3, seats_override = $4, devices_override = $5, sessions_override = $6,
             features_added = $7, features_removed = $8, no_expiry = $9, expires_at = $10, status = $11,
             updated_by = $12, updated_at = now()
         WHERE org_id = $1`,
        [id, input.packageId, input.licenseType, input.seatsOverride, input.devicesOverride, input.sessionsOverride,
          input.featuresAdded, input.featuresRemoved, input.noExpiry, input.expiresAt, input.status, actor.id],
      );
      const after = licenseSnapshot(await lockedLicenseRow(client, id));
      const changes = snapshotChanges(before, after);
      if (!Object.keys(changes).length) return { changed: false };
      const licenseId = String(current.id);
      await audit(client, id, actor.id, "license.update", "license", licenseId, { before, after, changes });
      if (changes.noExpiry || changes.expiresAt) {
        await audit(client, id, actor.id, "license.expiry_change", "license", licenseId, {
          before: { noExpiry: before.noExpiry, expiresAt: before.expiresAt },
          after: { noExpiry: after.noExpiry, expiresAt: after.expiresAt },
        });
      }
      if (changes.status) {
        await audit(client, id, actor.id, after.status === "suspended" ? "tenant.suspend" : "tenant.reactivate", "org", id, {});
      }
      return { changed: true };
    });
    if (!result) return h.send(res, 404, { error: "Tenant not found." });
    h.send(res, 200, { ok: true, ...result });
  }

  async function createTenant() {
    const body = await h.readJson(req);
    const name = text(body.name, 120);
    const slug = text(body.slug, 60);
    if (!name) throw new InputError("Enter the company name.");
    if (!SLUG.test(slug)) throw new InputError("Use lowercase letters, numbers, and hyphens for the company code.");
    const license = parseLicenseEdit({ ...body, status: "active" }, h.expiryFrom);
    const admin = h.parseTenantAdmin(body);
    if (admin.error) throw new InputError(admin.error);
    const passwordHash = await h.hashPassword(admin.value.password);
    try {
      const orgId = await tx(async (client) => {
        const pkgRow = await packageForAssignment(client, license.packageId, null);
        const org = await client.query("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, slug]);
        const id = Number(org.rows[0].id);
        const created = await client.query(
          `INSERT INTO licenses (org_id, plan, expires_at, package_id, seats_override, devices_override, sessions_override,
                                 features_added, features_removed, no_expiry, status, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
           RETURNING *`,
          [id, license.licenseType, license.expiresAt, license.packageId,
            license.seatsOverride, license.devicesOverride, license.sessionsOverride, license.featuresAdded,
            license.featuresRemoved, license.noExpiry, actor.id],
        );
        await client.query("INSERT INTO roles (org_id, name) VALUES ($1, 'owner'), ($1, 'admin'), ($1, 'tech')", [id]);
        const user = await client.query(
          `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin) VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [id, admin.value.email, admin.value.name, passwordHash],
        );
        await h.setUserRole(client, id, user.rows[0].id, "admin");
        await audit(client, id, actor.id, "tenant.create", "org", id, {
          name,
          slug,
          license: licenseSnapshot({ ...created.rows[0], package_code: pkgRow.code }),
        });
        await audit(client, id, actor.id, "user.create", "user", user.rows[0].id, { role: "admin", email: admin.value.email });
        return id;
      });
      h.send(res, 201, { id: orgId });
    } catch (error) {
      if (error.code === "23505" && String(error.constraint || "").includes("email")) throw new InputError("That email is already a user.", 409);
      if (error.code === "23505") throw new InputError("That company code is already in use.", 409);
      throw error;
    }
  }

  async function addUser(orgId) {
    const parsed = h.parseUserInput(await h.readJson(req));
    if (parsed.error) throw new InputError(parsed.error);
    const passwordHash = await h.hashPassword(parsed.value.password);
    try {
      const id = await tx(async (client) => {
        const license = await lockedLicenseRow(client, orgId);
        if (!license) return null;
        if ((await h.seatsLeft(client, orgId)) < 1) {
          throw new InputError("All seats on the license are in use. Deactivate a user or add seats first.", 409);
        }
        const user = await client.query(
          `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin) VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [orgId, parsed.value.email, parsed.value.name, passwordHash],
        );
        await h.setUserRole(client, orgId, user.rows[0].id, parsed.value.role);
        await audit(client, orgId, actor.id, "user.create", "user", user.rows[0].id, { role: parsed.value.role, email: parsed.value.email });
        return Number(user.rows[0].id);
      });
      if (id == null) return h.send(res, 404, { error: "Tenant not found." });
      h.send(res, 201, { id });
    } catch (error) {
      if (error.code === "23505") throw new InputError("That email is already a user.", 409);
      throw error;
    }
  }

  async function updateUser(userId) {
    const body = await h.readJson(req);
    const found = await pool.query("SELECT org_id FROM users WHERE id = $1 AND is_platform_admin = false AND org_id IS NOT NULL", [userId]);
    const orgId = found.rows[0]?.org_id;
    if (!orgId) return h.send(res, 404, { error: "User not found." });
    const target = (await h.orgUsers(orgId)).find((user) => user.id === Number(userId));
    if (!target) return h.send(res, 404, { error: "User not found." });
    const role = body.role === undefined ? target.role : body.role;
    if (!h.USER_ROLES.includes(role)) throw new InputError("Choose a role.");
    const disabled = body.disabled === undefined ? Boolean(target.disabledAt) : body.disabled === true;
    await tx(async (client) => {
      await lockedLicenseRow(client, orgId);
      if (target.disabledAt && !disabled && (await h.seatsLeft(client, orgId)) < 1) {
        throw new InputError("All seats on the license are in use. Deactivate someone else or add seats first.", 409);
      }
      await h.setUserRole(client, orgId, userId, role);
      await client.query(
        "UPDATE users SET disabled_at = CASE WHEN $2 THEN COALESCE(disabled_at, now()) ELSE NULL END WHERE id = $1",
        [userId, disabled],
      );
      if ((await h.managersLeft(client, orgId)) < 1) throw new InputError("The tenant needs at least one active owner or admin.");
      if (role !== target.role) {
        await audit(client, orgId, actor.id, "user.role_change", "user", userId, { before: target.role, after: role });
      }
      if (disabled !== Boolean(target.disabledAt)) {
        await audit(client, orgId, actor.id, disabled ? "user.deactivate" : "user.reactivate", "user", userId, {});
      }
    });
    if (disabled || role !== target.role) await h.revokeUserSessions(userId, null);
    h.send(res, 200, { ok: true });
  }

  async function listNotices() {
    const [notices, tenants] = await Promise.all([
      pool.query(
        `SELECT n.*, o.name AS org_name, c.email AS created_by_email
         FROM ribbon_notices n
         LEFT JOIN orgs o ON o.id = n.org_id
         LEFT JOIN users c ON c.id = n.created_by
         ORDER BY n.id DESC
         LIMIT 200`,
      ),
      pool.query("SELECT id, name FROM orgs ORDER BY lower(name)"),
    ]);
    const now = Date.now();
    h.send(res, 200, {
      notices: notices.rows.map((row) => ({
        id: Number(row.id),
        orgId: row.org_id == null ? null : Number(row.org_id),
        audience: row.org_name || "All tenants",
        body: row.body,
        linkLabel: row.link_label || "",
        linkUrl: row.link_url || "",
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        createdAt: row.created_at,
        createdBy: row.created_by_email || null,
        unpublishedAt: row.unpublished_at,
        state: noticeState(row, now),
      })),
      tenants: tenants.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    });
  }

  async function publishNotice() {
    const body = await h.readJson(req);
    const message = text(body.body, 181);
    if (!message || message.length > 180) throw new InputError("Enter a notice of 180 characters or less.");
    const linkLabel = text(body.linkLabel, 40);
    const linkUrl = String(body.linkUrl || "").trim();
    let href = "";
    if (linkUrl) {
      let parsed;
      try {
        parsed = new URL(linkUrl);
      } catch {
        throw new InputError("The link must start with http:// or https://.");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new InputError("The link must start with http:// or https://.");
      href = parsed.toString().slice(0, 300);
    }
    const orgId = body.orgId == null || body.orgId === "" || body.orgId === "all" ? null : Number(body.orgId);
    if (orgId != null && (!Number.isInteger(orgId) || orgId < 1)) throw new InputError("Choose all tenants, or one tenant.");
    const startsAt = localTime(body.startsAt);
    const endsAt = localTime(body.endsAt);
    if (endsAt && endsAt.getTime() <= (startsAt || new Date()).getTime()) throw new InputError("The end must be after the start.");
    const id = await tx(async (client) => {
      if (orgId != null) {
        const org = await client.query("SELECT id FROM orgs WHERE id = $1", [orgId]);
        if (!org.rows[0]) throw new InputError("Choose all tenants, or one tenant.");
      }
      let replaced = [];
      if (!startsAt || startsAt.getTime() <= Date.now()) {
        const off = await client.query(
          `UPDATE ribbon_notices SET active = false, unpublished_at = now(), unpublished_by = $2
           WHERE active = true AND org_id IS NOT DISTINCT FROM $1
             AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
           RETURNING id`,
          [orgId, actor.id],
        );
        replaced = off.rows.map((row) => Number(row.id));
      }
      const created = await client.query(
        `INSERT INTO ribbon_notices (org_id, body, link_label, link_url, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [orgId, message, href ? (linkLabel || "Know more") : null, href || null, actor.id, startsAt, endsAt],
      );
      const noticeId = Number(created.rows[0].id);
      await audit(client, orgId, actor.id, "notice.publish", "notice", noticeId, {
        audience: orgId ? "tenant" : "all",
        startsAt,
        endsAt,
        replaced,
      });
      return noticeId;
    });
    h.send(res, 201, { id });
  }

  async function unpublishNotice(id) {
    const done = await tx(async (client) => {
      const off = await client.query(
        `UPDATE ribbon_notices SET active = false, unpublished_at = now(), unpublished_by = $2
         WHERE id = $1 AND active = true RETURNING id, org_id`,
        [id, actor.id],
      );
      const row = off.rows[0];
      if (!row) return false;
      await audit(client, row.org_id, actor.id, "notice.unpublish", "notice", row.id, {});
      return true;
    });
    if (!done) return h.send(res, 404, { error: "That notice is not published." });
    h.send(res, 200, { ok: true });
  }

  async function listAudit() {
    const params = url.searchParams;
    const where = [];
    const values = [];
    const add = (sql, value) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    const org = params.get("tenant");
    if (org === "platform") where.push("e.org_id IS NULL");
    else if (org) add("e.org_id = ?", wholeNumber(org, "tenant", 1, Number.MAX_SAFE_INTEGER));
    const actorId = params.get("actor");
    if (actorId) add("e.actor_user_id = ?", wholeNumber(actorId, "actor", 1, Number.MAX_SAFE_INTEGER));
    const action = text(params.get("action"), 80);
    if (action) add("e.action = ?", action);
    const from = dayBound(params.get("from"), false);
    if (from) add("e.created_at >= ?", from);
    const to = dayBound(params.get("to"), true);
    if (to) add("e.created_at <= ?", to);
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const base = `FROM audit_events e
                  LEFT JOIN orgs o ON o.id = e.org_id
                  LEFT JOIN users u ON u.id = e.actor_user_id
                  ${filter}`;
    const columns = `e.id, e.created_at, e.org_id, o.name AS org_name, u.email AS actor_email,
                     e.action, e.target_type, e.target_id, e.detail`;

    if (params.get("format") === "csv") {
      const rows = await pool.query(`SELECT ${columns} ${base} ORDER BY e.id DESC LIMIT ${AUDIT_EXPORT_LIMIT}`, values);
      const lines = [["id", "time", "tenant", "actor", "action", "target_type", "target_id", "detail"].join(",")];
      for (const row of rows.rows) {
        lines.push([
          row.id,
          new Date(row.created_at).toISOString(),
          row.org_name || "Platform",
          row.actor_email || "System",
          row.action,
          row.target_type,
          row.target_id,
          JSON.stringify(row.detail || {}),
        ].map(csvCell).join(","));
      }
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
      res.end(`${lines.join("\r\n")}\r\n`);
      return;
    }

    const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
    const [rows, total, actions, actors, tenants] = await Promise.all([
      pool.query(
        `SELECT ${columns} ${base} ORDER BY e.id DESC LIMIT ${AUDIT_PAGE_SIZE} OFFSET ${(page - 1) * AUDIT_PAGE_SIZE}`,
        values,
      ),
      pool.query(`SELECT count(*)::int AS n ${base}`, values),
      pool.query("SELECT DISTINCT action FROM audit_events ORDER BY action"),
      pool.query(
        `SELECT u.id, u.email FROM users u
         WHERE EXISTS (SELECT 1 FROM audit_events e WHERE e.actor_user_id = u.id)
         ORDER BY u.email`,
      ),
      pool.query("SELECT id, name FROM orgs ORDER BY lower(name)"),
    ]);
    h.send(res, 200, {
      events: rows.rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        orgId: row.org_id == null ? null : Number(row.org_id),
        tenant: row.org_name || "Platform",
        actor: row.actor_email || "System",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail || {},
      })),
      total: total.rows[0].n,
      page,
      pageSize: AUDIT_PAGE_SIZE,
      actions: actions.rows.map((row) => row.action),
      actors: actors.rows.map((row) => ({ id: Number(row.id), email: row.email })),
      tenants: tenants.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    });
  }
}