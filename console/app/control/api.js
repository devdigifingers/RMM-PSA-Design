import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function sessionToken() {
  const jar = await cookies();
  return jar.get("df_session")?.value || "";
}

export async function clientHeaders() {
  const incoming = await headers();
  return {
    "x-forwarded-for": incoming.get("x-forwarded-for") || "",
    "x-df-user-agent": (incoming.get("user-agent") || "").slice(0, 300),
  };
}

export async function platformGet(path) {
  const token = await sessionToken();
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403 || response.status === 404) notFound();
  if (!response.ok) throw new Error("The admin data could not be loaded.");
  return response.json();
}
