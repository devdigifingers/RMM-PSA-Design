import { createHash, randomBytes } from "node:crypto";

// Tenant API tokens: each token may only run commands on the devices it was created for.
export const TOKEN_PREFIX = "dfk_";
export const TOKEN_SCOPES = ["jobs"];
export const EXPIRY_DAYS = [7, 30, 90, 365];
export const MAX_DEVICES = 50;
export const MAX_ACTIVE_TOKENS = 25;
export const CALLS_PER_MINUTE = 60;

export function newToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Shown in lists so a token can be recognised without revealing it.
export function tokenHint(token) {
  return `${token.slice(0, TOKEN_PREFIX.length + 4)}…${token.slice(-4)}`;
}

export function tokenFromHeader(header) {
  const value = String(header || "");
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return /^dfk_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function parseTokenRequest(body, parseAllowlist) {
  const name = typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 80) return { error: "Give the token a name of up to 80 characters." };
  const rawIds = Array.isArray(body?.deviceIds) ? body.deviceIds : [];
  const deviceIds = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (deviceIds.length === 0) return { error: "Choose at least one device." };
  if (deviceIds.length > MAX_DEVICES) return { error: `Choose at most ${MAX_DEVICES} devices.` };
  const expiresInDays = Number(body?.expiresInDays);
  if (!EXPIRY_DAYS.includes(expiresInDays)) return { error: "Choose when the token expires." };
  const ips = parseAllowlist(body?.allowedIps || []);
  if (ips.error) return { error: ips.error };
  return { value: { name, deviceIds, expiresInDays, allowedIps: ips.value, scopes: ["jobs"] } };
}

// Why a stored token may not be used right now, or null when it may.
export function tokenProblem(row, { now = new Date(), address, addressAllowed }) {
  if (!row) return { status: 401, error: "This token is not valid." };
  if (row.revoked_at) return { status: 401, error: "This token was revoked." };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { status: 401, error: "This token has expired." };
  if (row.creator_disabled_at || !row.creator_manages) {
    return { status: 401, error: "The person who created this token can no longer manage the organisation." };
  }
  if (!addressAllowed(address, row.allowed_ips || [])) return { status: 403, error: "This token cannot be used from this address." };
  return null;
}

export function tokenView(row) {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: Number(row.id),
    name: row.name,
    hint: row.hint,
    scopes: row.scopes || [],
    devices: (row.devices || []).map((device) => ({ id: Number(device.id), name: device.name })),
    allowedIps: row.allowed_ips || [],
    createdBy: row.created_by_name || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedFrom: row.last_used_ip || null,
    revokedAt: row.revoked_at,
    state: row.revoked_at ? "revoked" : expired ? "expired" : "active",
  };
}
