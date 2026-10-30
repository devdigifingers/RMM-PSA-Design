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
  if (body.user?.mfaSetupRequired) redirect("/settings/org/mfa");
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
  if (password !== confirmPassword) redirect("/settings/org/account?error=match");
  if (password.length < 8 || password.length > 200) redirect("/settings/org/account?error=short");
  const response = await authed("/v1/account/password", { currentPassword, password });
  if (response.status === 401) redirect("/");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    redirect(body.error === "current" ? "/settings/org/account?error=current" : "/settings/org/account?error=save");
  }
  redirect("/settings/org/account?saved=1");
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
  jar.delete("df_admin_session");
  jar.delete("df_impersonating");
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
      "x-df-user-agent": (incoming.get("user-agent") || "").slice(0, 300),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
}

export async function decideMigration(formData) {
  const id = Number(formData.get("id"));
  const decision = formData.get("decision") === "decline" ? "decline" : "approve";
  const response = await authed(`/v1/migrations/${id}/${decision}`, { reason: String(formData.get("reason") || "").trim() });
  const body = await response.json().catch(() => ({}));
  const query = response.ok ? `saved=${decision}` : `message=${encodeURIComponent(body.error || "That did not work.")}`;
  redirect(`/settings/org/migrations/${id}?${query}`);
}

export async function scheduleExport(formData) {
  const response = await authed("/v1/report-schedules", {
    intervalMinutes: Number(formData.get("intervalMinutes")),
  });
  if (!response.ok) redirect("/reports/exports?error=export");
  redirect("/reports/exports?saved=export");
}

async function reportCall(path, method, body) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "That did not work. Try again." };
  return { ok: true, ...result };
}

export async function createReportSubscription({ report, customerId, contactId, email }) {
  return reportCall("/v1/report-subscriptions", "POST", {
    report,
    customerId: customerId || null,
    contactId: contactId || null,
    email: email || "",
  });
}

export async function reportContacts() {
  const result = await reportCall("/v1/report-subscriptions", "GET");
  return result.ok ? { ok: true, contacts: result.contacts || [] } : result;
}

export async function deleteReportSubscription(id) {
  return reportCall(`/v1/report-subscriptions/${Number(id)}`, "DELETE");
}

export async function sendReportNow(id) {
  return reportCall(`/v1/report-subscriptions/${Number(id)}/send`, "POST");
}

export async function stopExportSchedule() {
  return reportCall("/v1/report-schedules", "DELETE");
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

function priorityPercent(formData) {
  return Object.fromEntries(["low", "normal", "high", "urgent"].map((key) => [key, Number(formData.get(`pct_${key}`)) || 100]));
}

export async function saveSla(formData) {
  const response = await callApi("/v1/sla", {
    method: "PUT",
    body: {
      responseMinutes: Number(formData.get("responseMinutes")),
      resolveMinutes: Number(formData.get("resolveMinutes")),
      priorityPercent: priorityPercent(formData),
    },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/desk/settings/service-levels?planError=${await errorText(response, "Those SLA targets could not be saved.")}`);
  redirect("/desk/settings/service-levels?saved=sla");
}

const ACCOUNT_FIELDS = ["name", "kind", "website", "email", "phone", "altPhone", "address", "registrationNumber", "vatNumber"];
const CONTACT_FIELDS = ["name", "email", "phone", "altPhone", "jobTitle"];

function customersBase(formData) {
  return formData.get("app") === "desk" ? "/desk/customers" : "/remote/customers";
}

function pick(formData, fields, prefix = "") {
  return Object.fromEntries(fields.map((field) => [field, String(formData.get(`${prefix}${field}`) || "")]));
}

async function errorText(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return encodeURIComponent(body.error || fallback);
}

export async function createAccount(formData) {
  const base = customersBase(formData);
  const response = await authed("/v1/accounts", {
    ...pick(formData, ACCOUNT_FIELDS),
    notes: String(formData.get("notes") || ""),
    contact: pick(formData, CONTACT_FIELDS, "contact_"),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/new?error=${await errorText(response, "That customer could not be saved.")}`);
  const body = await response.json();
  redirect(`${base}/${body.id}?saved=created`);
}

export async function saveAccount(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}`, { method: "PUT", body: pick(formData, ACCOUNT_FIELDS) });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=overview&error=${await errorText(response, "That customer could not be saved.")}`);
  redirect(`${base}/${id}?tab=overview&saved=account`);
}

export async function saveCustomerNotes(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}/notes`, { method: "PUT", body: { notes: String(formData.get("notes") || "") } });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=notes&error=${await errorText(response, "Those notes could not be saved.")}`);
  redirect(`${base}/${id}?tab=notes&saved=notes`);
}

export async function saveCustomerSla(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}/sla`, {
    method: "PUT",
    body: {
      planId: formData.get("planId") || null,
      contractStart: String(formData.get("contractStart") || ""),
      contractEnd: String(formData.get("contractEnd") || ""),
      contractNotes: String(formData.get("contractNotes") || ""),
    },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/desk/customers/${id}?tab=sla&error=${await errorText(response, "The SLA could not be saved.")}`);
  redirect(`/desk/customers/${id}?tab=sla&saved=sla`);
}

export async function saveSlaPlan(formData) {
  const id = String(formData.get("planId") || "");
  const body = {
    name: String(formData.get("name") || ""),
    responseMinutes: Number(formData.get("responseMinutes")),
    resolveMinutes: Number(formData.get("resolveMinutes")),
    priorityPercent: priorityPercent(formData),
  };
  const response = id
    ? await callApi(`/v1/sla-plans/${id}`, { method: "PUT", body })
    : await authed("/v1/sla-plans", body);
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/desk/settings/service-levels?planError=${await errorText(response, "That plan could not be saved.")}`);
  redirect("/desk/settings/service-levels?saved=plan");
}

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const NOTIFY_EVENTS = ["new_ticket", "assigned", "customer_reply", "sla_warning", "sla_breach"];

function deskHours(formData) {
  const hours = {};
  for (const day of WEEK) {
    const on = formData.get(`${day}_on`) === "on";
    const open = String(formData.get(`${day}_open`) || "");
    const close = String(formData.get(`${day}_close`) || "");
    hours[day] = on ? [[open, close]] : [];
  }
  return hours;
}

// [method, path, body, page] for each Service Desk settings form.
const DESK_FORMS = {
  statusCreate: (f) => ["POST", "/v1/desk/statuses", { name: f.get("name"), base: f.get("base"), position: Number(f.get("position")) || 0 }, "ticket-setup"],
  statusUpdate: (f) => ["PUT", `/v1/desk/statuses/${Number(f.get("id"))}`, { name: f.get("name"), base: f.get("base"), position: Number(f.get("position")) || 0 }, "ticket-setup"],
  statusDelete: (f) => ["DELETE", `/v1/desk/statuses/${Number(f.get("id"))}`, undefined, "ticket-setup"],
  priorities: (f) => ["PUT", "/v1/desk/priorities", { labels: Object.fromEntries(["low", "normal", "high", "urgent"].map((key) => [key, f.get(`label_${key}`)])) }, "ticket-setup"],
  categoryCreate: (f) => ["POST", "/v1/desk/categories", { name: f.get("name") }, "ticket-setup"],
  categoryDelete: (f) => ["DELETE", `/v1/desk/categories/${Number(f.get("id"))}`, undefined, "ticket-setup"],
  tagCreate: (f) => ["POST", "/v1/desk/tags", { name: f.get("name") }, "ticket-setup"],
  tagDelete: (f) => ["DELETE", `/v1/desk/tags/${Number(f.get("id"))}`, undefined, "ticket-setup"],
  hours: (f) => ["PUT", "/v1/desk/business-hours", { enabled: f.get("enabled") === "on", hours: deskHours(f) }, "business-hours"],
  holidayCreate: (f) => ["POST", "/v1/desk/holidays", { day: f.get("day"), name: f.get("name") }, "business-hours"],
  holidayDelete: (f) => ["DELETE", `/v1/desk/holidays/${Number(f.get("id"))}`, undefined, "business-hours"],
  holidaysLoad: (f) => ["POST", "/v1/desk/holidays/load", { year: Number(f.get("year")) }, "business-hours"],
  cannedCreate: (f) => ["POST", "/v1/desk/canned", { title: f.get("title"), body: f.get("body") }, "canned-replies"],
  cannedUpdate: (f) => ["PUT", `/v1/desk/canned/${Number(f.get("id"))}`, { title: f.get("title"), body: f.get("body") }, "canned-replies"],
  cannedDelete: (f) => ["DELETE", `/v1/desk/canned/${Number(f.get("id"))}`, undefined, "canned-replies"],
  rules: (f) => ["PUT", "/v1/desk/notification-rules", {
    rules: Object.fromEntries(NOTIFY_EVENTS.map((event) => [event, { email: f.get(`${event}_email`) === "on", inApp: f.get(`${event}_inApp`) === "on" }])),
  }, "notifications"],
  mailbox: (f) => ["PUT", "/v1/desk/mailbox", {
    address: f.get("address"),
    host: f.get("host"),
    port: Number(f.get("port")) || 993,
    secure: f.get("secure") === "on",
    username: f.get("username"),
    password: String(f.get("password") || ""),
    folder: f.get("folder") || "INBOX",
    defaultCustomerId: f.get("defaultCustomerId") || null,
    enabled: f.get("enabled") === "on",
    sendReplies: f.get("sendReplies") === "on",
    acknowledge: f.get("acknowledge") === "on",
  }, "email"],
  mailboxTest: () => ["POST", "/v1/desk/mailbox/test", {}, "email"],
  mailboxDelete: () => ["DELETE", "/v1/desk/mailbox", undefined, "email"],
  options: (f) => ["PUT", "/v1/desk/options", {
    autoCloseDays: f.get("autoCloseOn") === "on" ? Number(f.get("autoCloseDays")) : null,
    alertTickets: f.get("alertTickets") === "on",
    csatEnabled: f.get("csatEnabled") === "on",
    brandColor: f.get("brandColor"),
    signature: f.get("signature"),
  }, "automations"],
  automationCreate: (f) => ["POST", "/v1/desk/automations", automationBody(f), "automations"],
  automationUpdate: (f) => ["PUT", `/v1/desk/automations/${Number(f.get("id"))}`, automationBody(f), "automations"],
  automationDelete: (f) => ["DELETE", `/v1/desk/automations/${Number(f.get("id"))}`, undefined, "automations"],
};

function jsonList(value) {
  try {
    const list = JSON.parse(String(value || "[]"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function automationBody(f) {
  return {
    name: f.get("name"),
    trigger: f.get("trigger"),
    enabled: f.get("enabled") === "on",
    position: Number(f.get("position")) || 0,
    conditions: jsonList(f.get("conditions")),
    actions: jsonList(f.get("actions")),
  };
}

export async function saveDeskSetting(formData) {
  const form = String(formData.get("form") || "");
  const build = DESK_FORMS[form];
  if (!build) redirect("/desk/settings");
  const [method, path, body, page] = build(formData);
  const response = await callApi(path, { method, body });
  if (response.status === 401) redirect("/");
  const anchor = String(formData.get("anchor") || "").replace(/[^a-z-]/g, "");
  if (!response.ok) {
    redirect(`/desk/settings/${page}?error=${await errorText(response, "That change could not be saved.")}${anchor ? `#${anchor}` : ""}`);
  }
  const result = await response.json().catch(() => ({}));
  const extra = form === "holidaysLoad"
    ? `&added=${Number(result.added) || 0}`
    : form === "mailboxTest" && Number.isInteger(result.messages) ? `&messages=${result.messages}` : "";
  redirect(`/desk/settings/${page}?saved=${form}${extra}${anchor ? `#${anchor}` : ""}`);
}

// ids: a list of notification ids, or null for all of them.
export async function markNotificationsRead(ids) {
  const list = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : null;
  const response = await callApi("/v1/notifications/read", { method: "POST", body: list ? { ids: list } : {} });
  return { ok: response.ok };
}

export async function deleteSlaPlan(formData) {
  const id = String(formData.get("planId") || "");
  const response = await callApi(`/v1/sla-plans/${id}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/desk/settings/service-levels?planError=${await errorText(response, "That plan could not be deleted.")}`);
  redirect("/desk/settings/service-levels?saved=planRemoved");
}

export async function deleteCustomer(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const response = await callApi(`/v1/accounts/${id}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=overview&error=${await errorText(response, "That customer could not be deleted.")}`);
  redirect(`${base}?saved=deleted`);
}

export async function addContact(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const response = await authed(`/v1/accounts/${id}/contacts`, {
    ...pick(formData, CONTACT_FIELDS),
    primary: formData.get("primary") === "on",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=contacts&error=${await errorText(response, "That contact could not be saved.")}`);
  redirect(`${base}/${id}?tab=contacts&saved=contact`);
}

export async function saveContact(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const contactId = String(formData.get("contactId") || "");
  const response = await callApi(`/v1/contacts/${contactId}`, {
    method: "PUT",
    body: { ...pick(formData, CONTACT_FIELDS), primary: formData.get("primary") === "on" },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=contacts&error=${await errorText(response, "That contact could not be saved.")}`);
  redirect(`${base}/${id}?tab=contacts&saved=contact`);
}

export async function deleteContact(formData) {
  const base = customersBase(formData);
  const id = String(formData.get("accountId") || "");
  const contactId = String(formData.get("contactId") || "");
  const response = await callApi(`/v1/contacts/${contactId}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`${base}/${id}?tab=contacts&error=${await errorText(response, "That contact could not be removed.")}`);
  redirect(`${base}/${id}?tab=contacts&saved=removed`);
}

export async function linkAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const response = await authed(`/v1/accounts/${id}/devices`, { deviceId: Number(formData.get("deviceId")) });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/remote/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be linked.")}`);
  redirect(`/remote/customers/${id}?tab=devices&saved=linked`);
}

export async function assignAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const deviceId = String(formData.get("deviceId") || "");
  const response = await callApi(`/v1/accounts/${id}/devices/${deviceId}`, {
    method: "PUT",
    body: { contactId: formData.get("contactId") || null },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/remote/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be assigned.")}`);
  redirect(`/remote/customers/${id}?tab=devices&saved=assigned`);
}

export async function unlinkAsset(formData) {
  const id = String(formData.get("accountId") || "");
  const deviceId = String(formData.get("deviceId") || "");
  const response = await callApi(`/v1/accounts/${id}/devices/${deviceId}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/remote/customers/${id}?tab=devices&error=${await errorText(response, "That device could not be unlinked.")}`);
  redirect(`/remote/customers/${id}?tab=devices&saved=unlinked`);
}

// Status selects send "open" or "status:<id>" for a tenant's own status.
function statusFields(value) {
  const text = String(value || "open");
  const custom = /^status:(\d+)$/.exec(text);
  return custom ? { status: "open", statusId: Number(custom[1]) } : { status: text, statusId: null };
}

export async function createTicket(formData) {
  const customerId = Number(formData.get("customerId"));
  const response = await authed("/v1/tickets", {
    customerId,
    contactId: formData.get("contactId") || null,
    deviceId: formData.get("deviceId") || null,
    assigneeUserId: formData.get("assigneeUserId") || null,
    subject: String(formData.get("subject") || ""),
    ...statusFields(formData.get("status")),
    priority: String(formData.get("priority") || "normal"),
    comment: String(formData.get("comment") || ""),
    attachmentIds: String(formData.get("attachmentIds") || ""),
    category: String(formData.get("category") || ""),
    tags: String(formData.get("tags") || ""),
    dueAt: formData.get("dueOverride") === "on" ? String(formData.get("dueAt") || "") : null,
    channel: String(formData.get("channel") || "") || null,
    cc: formData.getAll("cc").map(Number).filter(Number.isInteger),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) {
    redirect(`/tickets/new?customer=${customerId || ""}&error=${await errorText(response, "That ticket could not be saved.")}`);
  }
  const body = await response.json();
  redirect(`/tickets/${body.id}`);
}

export async function previewTicket(customerId, priority, subject) {
  const query = new URLSearchParams({ customer: String(Number(customerId) || ""), priority: String(priority || "normal") });
  const [due, similar] = await Promise.all([
    callApi(`/v1/tickets/due-preview?${query}`, { method: "GET" }),
    String(subject || "").trim().length >= 4
      ? callApi(`/v1/tickets/similar?${new URLSearchParams({ customer: String(Number(customerId) || ""), subject: String(subject).slice(0, 200) })}`, { method: "GET" })
      : null,
  ]);
  const dueBody = due.ok ? await due.json().catch(() => ({})) : {};
  const similarBody = similar?.ok ? await similar.json().catch(() => ({})) : {};
  return {
    dueAt: dueBody.dueAt || null,
    businessHours: Boolean(dueBody.businessHours),
    resolveMinutes: dueBody.resolveMinutes || null,
    similar: similarBody.tickets || [],
  };
}

export async function bulkUpdateTickets(ids, changes) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (list.length === 0) return { ok: false, error: "Choose at least one ticket." };
  const body = { ids: list };
  if (changes?.status) body.status = String(changes.status);
  if (changes?.priority) body.priority = String(changes.priority);
  if (changes && Object.hasOwn(changes, "assigneeUserId")) {
    body.assigneeUserId = changes.assigneeUserId ? Number(changes.assigneeUserId) : null;
  }
  if (changes && Object.hasOwn(changes, "category")) body.category = String(changes.category || "");
  if (changes?.addTags) body.addTags = String(changes.addTags);
  if (changes?.removeTags) body.removeTags = String(changes.removeTags);
  const response = await authed("/v1/tickets/bulk", body);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "Those tickets could not be updated." };
  return { ok: true, error: "", updated: result.updated || 0 };
}

export async function mergeTickets(targetId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  const response = await authed("/v1/tickets/merge", { targetId: Number(targetId), ids: list });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "Those tickets could not be merged." };
  return { ok: true, error: "", merged: result.merged || 0 };
}

export async function saveTicketView(name, query, columns, shared) {
  const response = await authed("/v1/ticket-views", {
    name: String(name || ""),
    query: String(query || ""),
    columns: Array.isArray(columns) ? columns.map(String) : null,
    shared: shared === true,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "The view was not saved." };
  return { ok: true, error: "", id: result.id };
}

export async function deleteTicketView(id) {
  const response = await callApi(`/v1/ticket-views/${Number(id) || 0}`, { method: "DELETE" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "The view was not removed." };
  return { ok: true, error: "" };
}

export async function saveTicketColumns(columns) {
  const body = columns === null ? { reset: true } : { columns: (Array.isArray(columns) ? columns : []).map(String) };
  const response = await callApi("/v1/ticket-list/columns", { method: "PUT", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "The columns were not saved." };
  return { ok: true, error: "", columns: result.columns };
}

export async function assignTicketToMe(ticketId, me) {
  return bulkUpdateTickets([ticketId], { assigneeUserId: me });
}

function ticketPage(id, query) {
  return `/tickets/${Number(id) || 0}?${query}`;
}

export async function toggleTicketWatch(formData) {
  const id = Number(formData.get("ticketId")) || 0;
  const watching = formData.get("watching") === "true";
  const response = await callApi(`/v1/tickets/${id}/watch`, { method: watching ? "DELETE" : "POST", body: watching ? undefined : {} });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(ticketPage(id, `error=${await errorText(response, "Watching could not be changed.")}`));
  redirect(ticketPage(id, `saved=${watching ? "unwatch" : "watch"}`));
}

export async function saveTicketWatchers(formData) {
  const id = Number(formData.get("ticketId")) || 0;
  const userIds = formData.getAll("watcher").map(Number).filter(Number.isInteger);
  const response = await callApi(`/v1/tickets/${id}/watchers`, { method: "PUT", body: { userIds } });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(ticketPage(id, `error=${await errorText(response, "Watchers could not be saved.")}`));
  redirect(ticketPage(id, "saved=watchers"));
}

export async function saveTicketParent(formData) {
  const id = Number(formData.get("ticketId")) || 0;
  const parentId = String(formData.get("parentId") || "").trim();
  const response = await callApi(`/v1/tickets/${id}/parent`, { method: "PUT", body: { parentId: parentId || null } });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(ticketPage(id, `error=${await errorText(response, "The parent ticket could not be saved.")}`));
  redirect(ticketPage(id, `saved=${parentId ? "parent" : "parentRemoved"}`));
}

export async function createInstallCommand(customerId, maxUses) {
  const response = await authed("/v1/enroll-tokens", {
    kind: "command",
    maxUses: Number(maxUses) || 1,
    ...(Number(customerId) ? { customerId: Number(customerId) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "The install command was not created." };
  return { ok: true, error: "", code: result.token, expiresAt: result.expiresAt };
}

export async function revokeInstallCommand(id) {
  const response = await callApi(`/v1/enroll-tokens/${Number(id) || 0}`, { method: "DELETE" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: result.error || "The install command was not revoked." };
  return { ok: true, error: "" };
}

export async function updateTicket(formData) {
  const id = String(formData.get("ticketId") || "");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const deviceChanged = formData.has("deviceId")
    && (!formData.has("currentDeviceId") || String(formData.get("deviceId") || "") !== String(formData.get("currentDeviceId") || ""));
  const response = await fetch(`${apiUrl}/v1/tickets/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...statusFields(formData.get("status")),
      priority: String(formData.get("priority") || ""),
      assigneeUserId: formData.get("assigneeUserId") || null,
      ...(formData.has("contactId") ? { contactId: formData.get("contactId") || null } : {}),
      ...(deviceChanged ? { deviceId: formData.get("deviceId") || null } : {}),
      ...(formData.has("category") ? { category: String(formData.get("category") || "") } : {}),
      ...(formData.has("tags") ? { tags: String(formData.get("tags") || "") } : {}),
      ...(formData.has("dueAt") ? { dueAt: String(formData.get("dueAt") || "") || null } : {}),
      ...(formData.get("channel") ? { channel: String(formData.get("channel")) } : {}),
      ...(formData.has("ccField") ? { cc: formData.getAll("cc").map(Number).filter(Number.isInteger) } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) redirect(`/tickets/${id}?error=update&message=${await errorText(response, "That change could not be saved.")}`);
  redirect(`/tickets/${id}`);
}

function ticketPath(formData) {
  const id = String(formData.get("ticketId") || "");
  return /^\d+$/.test(id) ? id : "";
}

export async function addComment(formData) {
  const id = ticketPath(formData);
  const kind = formData.get("kind") === "note" ? "note" : "reply";
  const response = await authed(`/v1/tickets/${id}/comments`, {
    body: String(formData.get("body") || ""),
    kind,
    attachmentIds: String(formData.get("attachmentIds") || ""),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?compose=${kind}&error=${await errorText(response, "That could not be saved.")}`);
  redirect(`/tickets/${id}`);
}

export async function startTimer(formData) {
  const id = ticketPath(formData);
  const response = await authed(`/v1/tickets/${id}/timer`, { action: "start" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?error=${await errorText(response, "The timer could not start.")}`);
  redirect(`/tickets/${id}`);
}

export async function stopTimer(formData) {
  const id = ticketPath(formData);
  const response = await authed(`/v1/tickets/${id}/timer`, {
    action: "stop",
    billable: formData.get("billable") === "on",
    note: String(formData.get("note") || ""),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?error=${await errorText(response, "The timer could not stop.")}`);
  redirect(`/tickets/${id}?saved=time`);
}

export async function addTime(formData) {
  const id = ticketPath(formData);
  const response = await authed(`/v1/tickets/${id}/time`, {
    minutes: Number(formData.get("minutes")),
    billable: formData.get("billable") === "on",
    note: String(formData.get("note") || ""),
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?error=${await errorText(response, "That time could not be logged.")}`);
  redirect(`/tickets/${id}?saved=time`);
}

export async function removeTime(formData) {
  const id = ticketPath(formData);
  const entryId = String(formData.get("entryId") || "");
  const response = await callApi(`/v1/tickets/${id}/time/${/^\d+$/.test(entryId) ? entryId : "0"}`, { method: "DELETE" });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?error=${await errorText(response, "That time could not be removed.")}`);
  redirect(`/tickets/${id}?saved=timeRemoved`);
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

export async function updateOutdatedAgents(customer) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/agent-update/outdated`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ customer: customer || null }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The updates were not queued." };
  return { ok: true, queued: body.queued || 0, sent: body.sent || 0, failed: body.failed || [], version: body.version, linuxVersion: body.linuxVersion };
}

export async function setDeviceSite(deviceIds, site) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/site`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ deviceIds: deviceIds.map(Number), site }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The site was not saved." };
  return { ok: true, site: body.site, updated: body.updated };
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

export async function restartRemoteAgent(deviceId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/agent/restart`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || "The agent was not restarted." };
  return { ok: true, back: Boolean(body.back), remaining: Number(body.remaining?.total) || 0, error: "" };
}

export async function startRemoteSession(deviceId, user, ticketId) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { ok: false, error: "Sign in again." };
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/remote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user: user || "", ...(ticketId ? { ticketId: String(ticketId) } : {}) }),
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

const TECH_PATH = "/settings/org/technicians";

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

export async function inviteTechnician(formData) {
  const response = await callApi("/v1/users/invites", {
    body: {
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      role: String(formData.get("role") || "tech"),
    },
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    redirect(`${TECH_PATH}?invite_error=${encodeURIComponent(body.error || "The invite was not sent.")}`);
  }
  redirect(`${TECH_PATH}?saved=invited`);
}

export async function revokeTechnicianInvite(formData) {
  const id = String(formData.get("id") || "").replace(/\D/g, "");
  const response = await callApi(`/v1/users/invites/${id}`, { method: "DELETE" });
  redirect(response.ok ? `${TECH_PATH}?saved=invite-revoked` : `${TECH_PATH}?error=save`);
}

export async function endImpersonation() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  const tenantId = (jar.get("df_impersonating")?.value || "").replace(/\D/g, "");
  if (token) await callApi("/v1/impersonation/end").catch(() => {});
  const adminToken = jar.get("df_admin_session")?.value;
  jar.delete("df_impersonating");
  jar.delete("df_admin_session");
  if (!adminToken) {
    jar.delete("df_session");
    redirect("/");
  }
  jar.set("df_session", adminToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  redirect(tenantId ? `/control/tenants/${tenantId}` : "/control/tenants");
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
  if (!response.ok) await securityError("/settings/org/mfa", response);
  redirect("/settings/org/mfa?saved=org");
}

export async function saveIpAllowlist(formData) {
  const response = await callApi("/v1/org/security", { method: "PUT", body: { ipAllowlist: String(formData.get("ipAllowlist") || "") } });
  if (!response.ok) await securityError("/settings/org/ip-restriction", response);
  redirect("/settings/org/ip-restriction?saved=1");
}
