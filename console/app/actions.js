"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function login(formData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const response = await fetch(`${apiUrl}/v1/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!response.ok) redirect("/?error=invalid");
  const body = await response.json();
  const jar = await cookies();
  jar.set("df_session", body.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/devices");
}

export async function logout() {
  const jar = await cookies();
  jar.delete("df_session");
  redirect("/");
}

async function authed(path, body) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return response;
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

export async function createPatchPolicy(formData) {
  const response = await authed("/v1/patch-policies", {
    deviceId: Number(formData.get("deviceId")),
    name: String(formData.get("name") || ""),
    mode: String(formData.get("mode") || ""),
  });
  if (!response.ok) redirect("/patches?error=policy");
  redirect("/patches");
}

export async function approvePatchDeploy(formData) {
  const id = String(formData.get("deployId") || "");
  const response = await authed(`/v1/patch-deploys/${id}/approve`, {});
  if (!response.ok) redirect("/patches?error=approve");
  redirect("/patches");
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
  if (!response.ok) redirect("/tickets?error=sla");
  redirect("/tickets");
}

export async function saveContact(formData) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const id = String(formData.get("customerId") || "");
  const response = await fetch(`${apiUrl}/v1/customers/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      contactName: String(formData.get("contactName") || ""),
      contactEmail: String(formData.get("contactEmail") || ""),
    }),
    cache: "no-store",
  });
  if (!response.ok) redirect("/tickets?error=contact");
  redirect("/tickets");
}

export async function createCustomer(formData) {
  const response = await authed("/v1/customers", { name: String(formData.get("name") || "") });
  if (!response.ok) redirect("/tickets?error=customer");
  redirect("/tickets");
}

export async function createTicket(formData) {
  const response = await authed("/v1/tickets", {
    customerId: Number(formData.get("customerId")),
    deviceId: Number(formData.get("deviceId")),
    assigneeUserId: formData.get("assigneeUserId") || null,
    subject: String(formData.get("subject") || ""),
    status: String(formData.get("status") || "open"),
    priority: String(formData.get("priority") || "normal"),
    comment: String(formData.get("comment") || ""),
  });
  if (!response.ok) redirect("/tickets?error=ticket");
  const body = await response.json();
  redirect(`/tickets/${body.id}`);
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
