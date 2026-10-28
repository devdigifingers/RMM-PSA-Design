"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken } from "./api";

async function call(path, { method = "POST", body } = {}) {
  const token = await sessionToken();
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
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
  const password = String(formData.get("adminPassword") || "");
  if (password !== String(formData.get("adminConfirm") || "")) return { error: "The password and the confirmation do not match." };
  const result = await call("/v1/platform/tenants", {
    body: {
      ...licenseFields(formData),
      name: field(formData, "name"),
      slug: field(formData, "slug"),
      adminName: field(formData, "adminName"),
      adminEmail: field(formData, "adminEmail"),
      adminPassword: password,
    },
  });
  if (!result.ok) return failed(result, "The tenant was not created.");
  redirect(`/control/tenants/${result.data.id}?saved=created`);
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

export async function unpublishNotice(formData) {
  const id = Number(formData.get("noticeId"));
  const result = await call(`/v1/platform/notices/${id}`, { method: "DELETE" });
  redirect(result.ok ? "/control/notices?saved=unpublished" : `/control/notices?error=${encodeURIComponent(result.data?.error || "The notice was not unpublished.")}`);
}
