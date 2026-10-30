"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function acceptInvite(_prev, formData) {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { error: "This invite link is not valid." };
  if (password.length < 8 || password.length > 200) return { error: "Use at least 8 characters." };
  if (password !== String(formData.get("confirm") || "")) return { error: "The password and the confirmation do not match." };
  const incoming = await headers();
  const response = await fetch(`${apiUrl}/v1/invites/${token}/accept`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": incoming.get("x-forwarded-for") || "",
      "x-df-user-agent": (incoming.get("user-agent") || "").slice(0, 300),
    },
    body: JSON.stringify({ password, name: String(formData.get("name") || "") }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { error: body.error || "Your password was not saved. Try again." };
  redirect("/?invited=1");
}
