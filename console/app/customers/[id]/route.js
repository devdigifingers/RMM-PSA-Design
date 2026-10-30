import { cookies } from "next/headers";
import { customersBase, preferredCustomersApp } from "../shared";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const TAB_APP = { devices: "remote", sessions: "remote", tickets: "desk", sla: "desk", reports: "desk" };

// Old customer links are permanent (308) redirects into the app view the tenant has.
export async function GET(request, { params }) {
  const { id } = await params;
  const url = new URL(request.url);
  const token = (await cookies()).get("df_session")?.value;
  const to = (path) => new Response(null, { status: 308, headers: { location: path } });
  if (!token) return new Response(null, { status: 307, headers: { location: "/" } });
  const response = await fetch(`${apiUrl}/v1/account`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (response.status === 401) return new Response(null, { status: 307, headers: { location: "/" } });
  const account = response.ok ? await response.json() : null;
  if (account?.user?.isPlatformAdmin) return new Response(null, { status: 307, headers: { location: "/control/tenants" } });
  const tab = url.searchParams.get("tab") || "";
  const app = await preferredCustomersApp(account, TAB_APP[tab]);
  if (!app) return new Response("Customers are not included in your package.", { status: 403 });
  const query = new URLSearchParams(url.searchParams);
  if (tab === "reports") query.set("tab", "overview");
  const text = query.toString();
  return to(`${customersBase(app)}/${Number(id) || 0}${text ? `?${text}` : ""}`);
}
