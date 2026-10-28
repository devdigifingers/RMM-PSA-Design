"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function login(formData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const incoming = await headers();
  const response = await fetch(`${apiUrl}/v1/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": incoming.get("x-forwarded-for") || "",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (response.status === 429) redirect("/?error=locked");
  if (response.status === 403) redirect("/?error=ip");
  if (!response.ok) redirect("/?error=invalid");
  const body = await response.json();
  const jar = await cookies();
  if (body.mfaRequired) {
    jar.set("df_mfa", body.mfaToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 300 });
    redirect("/?step=mfa");
  }
  await startSession(body);
}

async function startSession(body) {
  const jar = await cookies();
  jar.set("df_session", body.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  if (body.user?.mfaSetupRequired) redirect("/settings/mfa");
  redirect(body.user?.isPlatformAdmin ? "/control/tenants" : "/");
}

export async function verifyLoginCode(formData) {
  const jar = await cookies();
  const mfaToken = jar.get("df_mfa")?.value;
  if (!mfaToken) redirect("/?error=expired");
  const response = await fetch(`${apiUrl}/v1/login/mfa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mfaToken, code: String(formData.get("code") || "") }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body.error === "code") redirect("/?step=mfa&error=code");
    jar.delete("df_mfa");
    redirect("/?error=expired");
  }
  jar.delete("df_mfa");
  await startSession(body);
}

export async function cancelLoginCode() {
  const jar = await cookies();
  jar.delete("df_mfa");
  redirect("/");
}

export async function changePassword(formData) {
  const currentPassword = String(formData.get("currentPassword") || "");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  if (password !== confirmPassword) redirect("/account?error=match");
  if (password.length < 8 || password.length > 200) redirect("/account?error=short");
  const response = await authed("/v1/account/password", { currentPassword, password });
  if (response.status === 401) redirect("/");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    redirect(body.error === "current" ? "/account?error=current" : "/account?error=save");
  }
  redirect("/account?saved=1");
}

export async function markDeviceNoticeRead(id) {
  const noticeId = Number(id);
  if (!Number.isInteger(noticeId) || noticeId < 1) return false;
  const response = await callApi(`/v1/notices/devices/${noticeId}/read`, { method: "POST" });
  return response.ok;
}

export async function deleteDeviceNotice(id) {
  const noticeId = Number(id);
  if (!Number.isInteger(noticeId) || noticeId < 1) return false;
  const response = await callApi(`/v1/notices/devices/${noticeId}`, { method: "DELETE" });
  return response.ok;
}

export async function dismissRibbon(id) {
  const noticeId = Number(id);
  if (!Number.isInteger(noticeId) || noticeId < 1) return false;
  const response = await callApi(`/v1/notices/ribbon/${noticeId}/dismiss`, { method: "POST" });
  return response.ok;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (token) {
    await fetch(`${apiUrl}/v1/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => {});
  }
  jar.delete("df_session");
  redirect("/");
}

async function authed(path, body) {
  return callApi(path, { body });
}

async function callApi(path, { method = "POST", body } = {}) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const incoming = await headers();
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-forwarded-for": incoming.get("x-forwarded-for") || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
}

export async function scheduleExport(formData) {
  const response = await authed("/v1/report-schedules", {
    intervalMinutes: Number(formData.get("intervalMinutes")),
  });
  if (!response.ok) redirect("/dashboard?error=export");
  redirect("/dashboard");
}

export async function createTicketFromAlert(formData) {
  const id = String(formData.get("alertId") || "");
  const response = await authed(`/v1/alerts/${id}/ticket`, {});
  if (!response.ok) redirect("/alerts?error=ticket");
  const body = await response.json();
  redirect(`/tickets/${body.id}`);
}

export async function savePatchRules(formData) {
  const response = await callApi("/v1/patch-rules", {
    method: "PUT",
    body: { categories: formData.getAll("category").map(String) },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/patches?error=rules");
  redirect("/patches?saved=rules");
}

export async function approveUrgentUpdates() {
  const response = await authed("/v1/patches/approve-urgent", {});
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/patches?error=approve");
  const body = await response.json().catch(() => ({}));
  redirect(`/patches?approved=${Number(body.approved) || 0}`);
}

export async function createAlertRule(formData) {
  const response = await authed("/v1/alert-rules", {
    deviceId: Number(formData.get("deviceId")),
    metric: String(formData.get("metric") || ""),
    threshold: Number(formData.get("threshold")),
  });
  if (!response.ok) redirect("/alerts?error=rule");
  redirect("/alerts");
}

export async function saveSla(formData) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/sla`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      responseMinutes: Number(formData.get("responseMinutes")),
      resolveMinutes: Number(formData.get("resolveMinutes")),
    }),
    cache: "no-store",
  });
  if (!response.ok) redirect("/tickets/setup?error=sla");
  redirect("/tickets/setup?saved=sla");
}

const ACCOUNT_FIELDS = ["name", "kind", "website", "email", "phone", "altPhone", "address", "registrationNumber", "vatNumber", "notes"];
const CONTACT_FIELDS = ["name", "email", "phone", "altPhone", "jobTitle"];

function pick(formData, fields, prefix = "") {
  return Object.fromEntries(fields.map((field) => [field, String(formData.get(`${prefix}${field}`) || "")]));
}

async function errorText(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return encodeURIComponent(body.error || fallback);
}

export async function createAccount(formData) {
  const response = await authed("/v1/accounts", {
    ...pick(formData, ACCOUNT_FIELDS),
    contact: pick(formData, CONTACT_FIELDS, "contact_"),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/new?error=${await errorText(response, "That customer could not be saved.")}`);
  const body = await response.json();
  redirect(`/customers/${body.id}?saved=created`);
}

export async function saveAccount(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}`, { method: "PUT", body: pick(formData, ACCOUNT_FIELDS) });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=overview&error=${await errorText(response, "That customer could not be saved.")}`);
  redirect(`/customers/${id}?tab=overview&saved=account`);
}

export async function deleteCustomer(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=overview&error=${await errorText(response, "That customer could not be deleted.")}`);
  redirect("/customers?saved=deleted");
}

export async function addContact(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await authed(`/v1/accounts/${id}/contacts`, {
    ...pick(formData, CONTACT_FIELDS),
    primary: formData.get("primary") === "on",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=contacts&error=${await errorText(response, "That contact could not be saved.")}`);
  redirect(`/customers/${id}?tab=contacts&saved=contact`);
}

export async function saveContact(formData) {
  const id = String(formData.get("accountId") || "");
  const contactId = String(formData.get("contactId") || "");
  const response = await callApi(`/v1/contacts/${contactId}`, {
    method: "PUT",
    body: { ...pick(formData, CONTACT_FIELDS), primary: formData.get("primary") === "on" },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=contacts&error=${await errorText(response, "That contact could not be saved.")}`);
  redirect(`/customers/${id}?tab=contacts&saved=contact`);
}

export async function deleteContact(formData) {
  const id = String(formData.get("accountId") || "");
  const contactId = String(formData.get("contactId") || "");
  const response = await callApi(`/v1/contacts/${contactId}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=contacts&error=${await errorText(response, "That contact could not be removed.")}`);
  redirect(`/customers/${id}?tab=contacts&saved=removed`);
}

export async function linkAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await authed(`/v1/accounts/${id}/devices`, { deviceId: Number(formData.get("deviceId")) });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be linked.")}`);
  redirect(`/customers/${id}?tab=devices&saved=linked`);
}

export async function assignAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const deviceId = String(formData.get("deviceId") || "");
  const response = await callApi(`/v1/accounts/${id}/devices/${deviceId}`, {
    method: "PUT",
    body: { contactId: formData.get("contactId") || null },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be assigned.")}`);
  redirect(`/customers/${id}?tab=devices&saved=assigned`);
}

export async function unlinkAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const deviceId = String(formData.get("deviceId") || "");
  const response = await callApi(`/v1/accounts/${id}/devices/${deviceId}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be unlinked.")}`);
  redirect(`/customers/${id}?tab=devices&saved=unlinked`);
}

export async function createTicket(formData) {
  const response = await authed("/v1/tickets", {
    customerId: Number(formData.get("customerId")),
    contactId: formData.get("contactId") || null,
    deviceId: formData.get("deviceId") || null,
    assigneeUserId: formData.get("assigneeUserId") || null,
    subject: String(formData.get("subject") || ""),
    status: String(formData.get("status") || "open"),
    priority: String(formData.get("priority") || "normal"),
    comment: String(formData.get("comment") || ""),
  });
  if (!response.ok) redirect("/tickets/new?error=ticket");
  const body = await response.json();
  redirect(`/tickets/${body.id}`);
}

export async function bulkUpdateTickets(ids, changes) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (list.length === 0) return { ok: false, error: "Choose at least one ticket." };
  const body = { ids: list };
  if (changes?.status) body.status = String(changes.status);
  if (changes && Object.hasOwn(changes, "assigneeUserId")) {
    body.assigneeUserId = changes.assigneeUserId ? Number(changes.assigneeUserId) : null;
  }
  const response = await authed("/v1/tickets/bulk", body);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "Those tickets could not be updated." };
  return { ok: true, error: "", updated: result.updated || 0 };
}

export async function updateTicket(formData) {
  const id = String(formData.get("ticketId") || "");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/tickets/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: String(formData.get("status") || ""),
      priority: String(formData.get("priority") || ""),
      assigneeUserId: formData.get("assigneeUserId") || null,
      ...(formData.has("contactId") ? { contactId: formData.get("contactId") || null } : {}),
      ...(formData.has("deviceId") ? { deviceId: formData.get("deviceId") || null } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) redirect(`/tickets/${id}?error=update`);
  redirect(`/tickets/${id}`);
}

export async function addComment(formData) {
  const id = String(formData.get("ticketId") || "");
  const response = await authed(`/v1/tickets/${id}/comments`, {
    body: String(formData.get("body") || ""),
  });
  if (!response.ok) redirect(`/tickets/${id}?error=comment`);
  redirect(`/tickets/${id}`);
}

export async function deviceSoftware(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/software`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "Installed software is not available." };
  return { ok: true, ...body };
}

export async function renameDevice(deviceId, name) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/name`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The name was not saved." };
  return { ok: true, name: body.name };
}

export async function deviceFiles(deviceId, path) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/files?path=${encodeURIComponent(path || "")}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "Files are not available." };
  return { ok: true, ...body };
}

export async function createDeviceFolder(deviceId, path, name) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/folders`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ path, name }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The folder was not created." };
  return { ok: true, name: body.name };
}

export async function uploadDeviceFile(deviceId, path, file) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "x-df-path": encodeURIComponent(path || ""),
      "x-df-name": encodeURIComponent(file.name || ""),
    },
    body: file,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The file was not uploaded." };
  return { ok: true, name: body.name };
}

export async function deviceDiagnostics(deviceId, tool) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/diagnostics?tool=${encodeURIComponent(tool)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "This diagnostic is not available." };
  return { ok: true, ...body };
}

export async function deviceUpdates(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/updates`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "Updates are not available for this computer." };
  return { ok: true, ...body };
}

const UPDATE_ACTIONS = new Set(["scan", "approve", "push", "restart"]);

export async function deviceUpdateAction(deviceId, action, input = {}) {
  if (!UPDATE_ACTIONS.has(action)) return { ok: false, error: "Unknown action." };
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const body = {};
  if (Array.isArray(input.names)) body.names = input.names.map(String).slice(0, 200);
  if (action === "push") body.restartMode = ["auto", "ask"].includes(input.restartMode) ? input.restartMode : "later";
  if (action === "restart") body.mode = input.mode === "ask" ? "ask" : "auto";
  if (input.confirmServer === true) body.confirmServer = true;
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/updates/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: result.error || "The request was not sent.", needsConfirm: result.needsConfirm === true };
  }
  return { ok: true, ...result };
}

export async function setDeviceStartup(deviceId, item) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/startup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: item.name,
      location: item.location,
      enabled: item.enabled,
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The startup item was not changed." };
  return { ok: true, enabled: body.enabled };
}

export async function setDeviceService(deviceId, item) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/services`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: item.name, action: item.action }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The service was not changed." };
  return { ok: true };
}

export async function endDeviceProcess(deviceId, pid) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/processes/${encodeURIComponent(pid)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The process was not ended." };
  return { ok: true };
}

export async function deviceDetails(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/details`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "Details are not available." };
  return { ok: true, ...body };
}

export async function powerDevice(deviceId, action) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/power`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, error: body.error || "The power action was not sent." };
  }
  return { ok: true, error: "" };
}

export async function updateAgent(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  if (!/^\d+$/.test(String(deviceId))) return { ok: false, error: "Device not found." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/agent-update`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The agent update was not sent." };
  return { ok: true, error: "", status: body.status || "", version: body.version || "" };
}

export async function findDevices(query) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, devices: [], canRemote: false };
  const q = String(query || "").trim().slice(0, 80);
  const response = await fetch(`${apiUrl}/v1/devices?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, devices: [], canRemote: false };
  const devices = (body.devices || []).slice(0, 8).map((device) => ({
    id: device.id,
    hostname: device.hostname,
    displayName: device.displayName || "",
    customerName: device.customerName || "",
    presence: device.presence,
    users: device.users || [],
  }));
  return { ok: true, devices, canRemote: Boolean(body.canRemote) };
}

export async function remoteSessions() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, sessions: {} };
  const response = await fetch(`${apiUrl}/v1/remote-sessions`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, sessions: {} };
  return { ok: true, sessions: body.sessions || {} };
}

export async function endRemoteSessions(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/sessions/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The sessions were not ended." };
  return { ok: true, ended: Number(body.ended) || 0, remaining: Number(body.remaining?.total) || 0, error: "" };
}

export async function startRemoteSession(deviceId, user) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/remote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user: user || "" }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) {
    return { ok: false, error: body.error || "The remote session did not start." };
  }
  return { ok: true, url: body.url, error: "" };
}

export async function runJob(formData) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const deviceId = String(formData.get("deviceId") || "");
  const command = String(formData.get("command") || "");
  const ticketId = String(formData.get("ticketId") || "");
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ command, ticketId: ticketId || null }),
    cache: "no-store",
  });
  if (!response.ok) redirect(ticketId ? `/tickets/${ticketId}?error=job` : "/devices?error=job");
  redirect(ticketId ? `/tickets/${ticketId}` : "/devices");
}

async function supportCall(path, method = "GET", body) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "Remote support did not answer." };
  return { ok: true, ...result };
}

export async function supportSessions() {
  return supportCall("/v1/support-sessions");
}

export async function startSupportSession(input) {
  return supportCall("/v1/support-sessions", "POST", {
    topic: String(input?.topic || ""),
    customerEmail: String(input?.customerEmail || ""),
    ticketId: String(input?.ticketId || ""),
  });
}

export async function endSupportSession(id) {
  return supportCall(`/v1/support-sessions/${encodeURIComponent(id)}/end`, "POST");
}

export async function saveSupportSession(id, input) {
  return supportCall(`/v1/support-sessions/${encodeURIComponent(id)}`, "PUT", {
    notes: typeof input?.notes === "string" ? input.notes : null,
    ticketId: String(input?.ticketId || ""),
  });
}

export async function startSupportRemote(id) {
  return supportCall(`/v1/support-sessions/${encodeURIComponent(id)}/remote`, "POST");
}

const TECH_PATH = "/settings/technicians";

async function technicianError(response) {
  const body = await response.json().catch(() => ({}));
  const text = String(body.error || "");
  if (response.status === 401) redirect("/");
  if (text.includes("already a login")) return "email";
  if (text.includes("seats on the license")) return "seats";
  if (text.includes("owner or admin")) return response.status === 403 ? "denied" : "managers";
  if (text.includes("owner")) return "owner";
  if (text.includes("your own")) return "self";
  if (text.includes("password")) return "short";
  if (text.includes("email")) return "bademail";
  return "save";
}

export async function addTechnician(formData) {
  const response = await callApi("/v1/users", {
    body: {
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
      role: String(formData.get("role") || "tech"),
    },
  });
  if (!response.ok) redirect(`${TECH_PATH}?error=${await technicianError(response)}`);
  redirect(`${TECH_PATH}?saved=added`);
}

export async function updateTechnician(formData) {
  const id = String(formData.get("id") || "").replace(/\D/g, "");
  const body = {};
  if (formData.has("role")) body.role = String(formData.get("role"));
  if (formData.has("disabled")) body.disabled = formData.get("disabled") === "1";
  if (formData.get("resetMfa") === "1") body.resetMfa = true;
  const response = await callApi(`/v1/users/${id}`, { method: "PUT", body });
  if (!response.ok) redirect(`${TECH_PATH}?error=${await technicianError(response)}`);
  const saved = body.resetMfa ? "mfareset" : formData.has("disabled") ? (body.disabled ? "disabled" : "enabled") : "role";
  redirect(`${TECH_PATH}?saved=${saved}`);
}

async function mfaCall(path, body) {
  const response = await callApi(path, { body: body || {} });
  if (response.status === 401) redirect("/");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: data.error || "That did not work. Try again." };
  return data;
}

export async function startMfaSetup() {
  const data = await mfaCall("/v1/account/mfa/setup");
  if (data.error) return data;
  return { secret: data.secret, qr: await QRCode.toDataURL(data.uri, { margin: 1, width: 208 }) };
}

export async function enableMfa(code) {
  return mfaCall("/v1/account/mfa/enable", { code: String(code || "") });
}

export async function disableMfa(code) {
  return mfaCall("/v1/account/mfa/disable", { code: String(code || "") });
}

export async function newRecoveryCodes(code) {
  return mfaCall("/v1/account/mfa/recovery", { code: String(code || "") });
}

async function securityError(path, response) {
  if (response.status === 401) redirect("/");
  const data = await response.json().catch(() => ({}));
  const jar = await cookies();
  jar.set("df_flash", String(data.error || "That change was not saved.").slice(0, 300), { httpOnly: true, secure: true, sameSite: "lax", path, maxAge: 30 });
  redirect(`${path}?error=1`);
}

export async function saveRequireMfa(formData) {
  const response = await callApi("/v1/org/security", { method: "PUT", body: { requireMfa: formData.get("requireMfa") === "1" } });
  if (!response.ok) await securityError("/settings/mfa", response);
  redirect("/settings/mfa?saved=org");
}

export async function saveIpAllowlist(formData) {
  const response = await callApi("/v1/org/security", { method: "PUT", body: { ipAllowlist: String(formData.get("ipAllowlist") || "") } });
  if (!response.ok) await securityError("/settings/ip-restriction", response);
  redirect("/settings/ip-restriction?saved=1");
}
