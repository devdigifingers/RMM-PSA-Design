import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function reportsApi(path, { missingOk = false } = {}) {
  const token = (await cookies()).get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (response.status === 401) redirect("/");
  if (response.status === 404 && !missingOk) notFound();
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export const REPORT_PARAMS = ["from", "to", "customer", "country", "region"];

export function reportQuery(params, extra = {}) {
  const query = new URLSearchParams();
  for (const key of REPORT_PARAMS) {
    const value = typeof params?.[key] === "string" ? params[key] : "";
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return query.toString();
}
