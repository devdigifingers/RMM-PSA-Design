import { cookies } from "next/headers";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function GET(request) {
  const token = (await cookies()).get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const customer = new URL(request.url).searchParams.get("customer") || "";
  const response = await fetch(`${apiUrl}/v1/dashboard/overview${customer ? `?customer=${encodeURIComponent(customer)}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({ error: "The dashboard did not load." }));
  return Response.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
}
