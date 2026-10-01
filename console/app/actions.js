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

export async function runJob(formData) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const deviceId = String(formData.get("deviceId") || "");
  const command = String(formData.get("command") || "");
  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ command }),
    cache: "no-store",
  });
  if (!response.ok) redirect("/devices?error=job");
  redirect("/devices");
}
