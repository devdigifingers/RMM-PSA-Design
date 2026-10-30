"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiUrl, clientHeaders, sessionToken } from "./api";

async function call(path, { method = "POST", body } = {}) {
  const token = await sessionToken();
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(await clientHeaders()),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const field = (formData, name) => String(formData.get(name) ?? "").trim();
const listField = (formData, name) => {
  try {
    const value = JSON.parse(String(formData.get(name) || "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};
const failed = (result, fallback) => ({ error: result.data?.error || fallback, affected: result.data?.affected });

function licenseFields(formData) {
  return {
    packageId: field(formData, "packageId"),
    licenseType: field(formData, "licenseType"),
    seatsOverride: field(formData, "seatsOverride"),
    devicesOverride: field(formData, "devicesOverride"),
    sessionsOverride: field(formData, "sessionsOverride"),
    featuresAdded: listField(formData, "featuresAdded"),
    featuresRemoved: listField(formData, "featuresRemoved"),
    noExpiry: formData.get("noExpiry") === "on",
    expiresAt: field(formData, "expiresAt") || null,
  };
}

export async function saveTenantLicense(_prev, formData) {
  const tenantId = Number(formData.get("tenantId"));
  const result = await call(`/v1/platform/tenants/${tenantId}/license`, {
    method: "PUT",
    body: { ...licenseFields(formData), status: field(formData, "status") },
  });
  if (!result.ok) return failed(result, "The license was not saved.");
  revalidatePath(`/control/tenants/${tenantId}`);
  redirect(`/control/tenants/${tenantId}?tab=license&saved=${result.data.changed ? "license" : "unchanged"}`);
}

export async function createTenant(_prev, formData) {
  const inviteAdmin = formData.get("adminAccess") === "invite";
  const password = inviteAdmin ? "" : String(formData.get("adminPassword") || "");
  if (!inviteAdmin && password !== String(formData.get("adminConfirm") || "")) return { error: "The password and the confirmation do not match." };
  const result = await call("/v1/platform/tenants", {
    body: {
      ...licenseFields(formData),
      name: field(formData, "name"),
      slug: field(formData, "slug"),
      adminName: field(formData, "adminName"),
      adminEmail: field(formData, "adminEmail"),
      ...(inviteAdmin ? { inviteAdmin: true } : { adminPassword: password }),
    },
  });
  if (!result.ok) return failed(result, "The tenant was not created.");
  if (result.data.inviteError) {
    redirect(`/control/tenants/${result.data.id}?tab=users&error=${encodeURIComponent(`Tenant created, but ${result.data.inviteError}`)}`);
  }
  redirect(`/control/tenants/${result.data.id}?saved=${inviteAdmin ? "created-invited" : "created"}`);
}

export async function inviteTenantUser(_prev, formData) {
  const tenantId = Number(formData.get("tenantId"));
  const result = await call(`/v1/platform/tenants/${tenantId}/invites`, {
    body: { name: field(formData, "name"), email: field(formData, "email"), role: field(formData, "role") },
  });
  if (!result.ok) return failed(result, "The invite was not sent.");
  redirect(`/control/tenants/${tenantId}?tab=users&saved=invited`);
}

export async function revokeTenantInvite(formData) {
  const tenantId = Number(formData.get("tenantId"));
  const inviteId = Number(formData.get("inviteId"));
  const result = await call(`/v1/platform/tenants/${tenantId}/invites/${inviteId}`, { method: "DELETE" });
  const query = result.ok ? "saved=invite-revoked" : `error=${encodeURIComponent(result.data?.error || "The invite was not cancelled.")}`;
  redirect(`/control/tenants/${tenantId}?tab=users&${query}`);
}

export async function viewAsTenant(formData) {
  const tenantId = Number(formData.get("tenantId"));
  const result = await call(`/v1/platform/tenants/${tenantId}/impersonate`);
  if (!result.ok || !result.data.token) {
    redirect(`/control/tenants/${tenantId}?error=${encodeURIComponent(result.data?.error || "Could not open the tenant view.")}`);
  }
  const jar = await cookies();
  const adminToken = await sessionToken();
  const options = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
  jar.set("df_admin_session", adminToken, { ...options, maxAge: 60 * 60 * 12 });
  jar.set("df_session", result.data.token, { ...options, maxAge: result.data.expiresInSeconds });
  jar.set("df_impersonating", String(tenantId), { ...options, maxAge: result.data.expiresInSeconds });
  redirect("/dashboard");
}

export async function checkSlug(slug) {
  const result = await call(`/v1/platform/slug-check?slug=${encodeURIComponent(String(slug || ""))}`, { method: "GET" });
  return result.ok ? result.data : { valid: false, available: false };
}

export async function savePackage(_prev, formData) {
  const id = field(formData, "id");
  const body = {
    code: field(formData, "code"),
    name: field(formData, "name"),
    description: field(formData, "description"),
    features: formData.getAll("features").map(String),
    defaultSeats: field(formData, "defaultSeats"),
    defaultDevices: field(formData, "defaultDevices"),
    defaultSessions: field(formData, "defaultSessions"),
    priceMonthly: field(formData, "priceMonthly"),
    active: formData.get("active") === "on",
    confirm: formData.get("confirm") === "1",
  };
  const result = await call(id ? `/v1/platform/packages/${id}` : "/v1/platform/packages", { method: id ? "PUT" : "POST", body });
  if (!result.ok) return failed(result, "The package was not saved.");
  revalidatePath("/control/packages");
  redirect(`/control/packages/${id || result.data.id}?saved=${id ? "package" : "created"}`);
}

export async function addTenantUser(_prev, formData) {
  const tenantId = Number(formData.get("tenantId"));
  const result = await call(`/v1/platform/tenants/${tenantId}/users`, {
    body: {
      name: field(formData, "name"),
      email: field(formData, "email"),
      role: field(formData, "role"),
      password: String(formData.get("password") || ""),
    },
  });
  if (!result.ok) return failed(result, "The user was not added.");
  redirect(`/control/tenants/${tenantId}?tab=users&saved=user-added`);
}

export async function updateTenantUser(formData) {
  const tenantId = Number(formData.get("tenantId"));
  const userId = Number(formData.get("userId"));
  const body = {};
  if (formData.has("role")) body.role = field(formData, "role");
  if (formData.has("disabled")) body.disabled = formData.get("disabled") === "1";
  const result = await call(`/v1/platform/users/${userId}`, { method: "PUT", body });
  const query = result.ok ? "saved=user" : `error=${encodeURIComponent(result.data?.error || "The user was not changed.")}`;
  redirect(`/control/tenants/${tenantId}?tab=users&${query}`);
}

export async function setTenantPassword(_prev, formData) {
  const tenantId = Number(formData.get("tenantId"));
  const userId = Number(formData.get("userId"));
  const password = String(formData.get("password") || "");
  if (password !== String(formData.get("confirmPassword") || "")) return { error: "The password and the confirmation do not match." };
  if (password.length < 8 || password.length > 200) return { error: "Use at least 8 characters." };
  const result = await call(`/v1/platform/users/${userId}/password`, { body: { password } });
  if (!result.ok) return failed(result, "The password was not saved.");
  redirect(`/control/tenants/${tenantId}?tab=users&saved=password`);
}

export async function publishNotice(_prev, formData) {
  const result = await call("/v1/platform/notices", {
    body: {
      body: field(formData, "body"),
      linkLabel: field(formData, "linkLabel"),
      linkUrl: field(formData, "linkUrl"),
      orgId: field(formData, "orgId"),
      startsAt: field(formData, "startsAt") || null,
      endsAt: field(formData, "endsAt") || null,
    },
  });
  if (!result.ok) return failed(result, "The notice was not published.");
  redirect("/control/notices?saved=published");
}

export async function migrationOptions(sourceId) {
  const result = await call(`/v1/platform/migrations/options?source=${Number(sourceId) || ""}`, { method: "GET" });
  return result.ok ? result.data : { tenants: [], customers: [] };
}

export async function migrationDryRun(input) {
  const result = await call("/v1/platform/migrations/dry-run", { body: input });
  return result.ok ? result.data : { error: result.data?.error || "The dry run did not finish." };
}

export async function saveMigration(input, editId = null) {
  const result = await call(editId ? `/v1/platform/migrations/${Number(editId)}` : "/v1/platform/migrations", {
    method: editId ? "PUT" : "POST",
    body: input,
  });
  if (!result.ok) return { error: result.data?.error || "The request was not saved.", plan: result.data?.plan || null };
  const id = editId || result.data.id;
  revalidatePath("/control/migrations");
  redirect(`/control/migrations/${id}?saved=${editId ? (result.data.changed ? "edited" : "unchanged") : "submitted"}`);
}

const MIGRATION_ACTIONS = ["approve", "decline", "cancel", "rollback", "rollback-approve", "rollback-cancel"];

export async function migrationAction(formData) {
  const id = Number(formData.get("id"));
  const action = String(formData.get("action") || "");
  if (!MIGRATION_ACTIONS.includes(action)) redirect(`/control/migrations/${id}`);
  const body = action === "rollback" ? { keepChanges: formData.get("keepChanges") === "keep" } : { reason: field(formData, "reason") };
  const result = await call(`/v1/platform/migrations/${id}/${action}`, { body });
  revalidatePath(`/control/migrations/${id}`);
  const query = result.ok ? `saved=${action}` : `error=${encodeURIComponent(result.data?.error || "That did not work.")}`;
  redirect(`/control/migrations/${id}?${query}`);
}

export async function invitePlatformMember(_prev, formData) {
  const result = await call("/v1/platform/team/invites", {
    body: { name: field(formData, "name"), email: field(formData, "email"), role: field(formData, "role") },
  });
  if (!result.ok) return failed(result, "The invite was not sent.");
  redirect("/control/team?saved=invited");
}

export async function revokePlatformInvite(formData) {
  const inviteId = Number(formData.get("inviteId"));
  const result = await call(`/v1/platform/team/invites/${inviteId}`, { method: "DELETE" });
  redirect(`/control/team?${result.ok ? "saved=invite-revoked" : `error=${encodeURIComponent(result.data?.error || "The invite was not cancelled.")}`}`);
}

const TEAM_ACTIONS = ["role", "disable", "enable", "reset-mfa"];

export async function platformMemberAction(formData) {
  const userId = Number(formData.get("userId"));
  const action = String(formData.get("action") || "");
  if (!TEAM_ACTIONS.includes(action)) redirect("/control/team");
  const result = action === "role"
    ? await call(`/v1/platform/team/${userId}`, { method: "PUT", body: { role: field(formData, "role") } })
    : await call(`/v1/platform/team/${userId}/${action}`);
  const saved = result.data?.changed === false ? "unchanged" : action;
  redirect(`/control/team?${result.ok ? `saved=${saved}` : `error=${encodeURIComponent(result.data?.error || "That did not work.")}`}`);
}

export async function unpublishNotice(formData) {
  const id = Number(formData.get("noticeId"));
  const result = await call(`/v1/platform/notices/${id}`, { method: "DELETE" });
  redirect(result.ok ? "/control/notices?saved=unpublished" : `/control/notices?error=${encodeURIComponent(result.data?.error || "The notice was not unpublished.")}`);
}
