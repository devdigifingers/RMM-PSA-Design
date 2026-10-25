import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fromConsole, refused } from "../../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";

export async function GET(request, { params }) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const ticket = await fetch(`${apiUrl}/v1/tickets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (ticket.status === 401) redirect("/");
  if (!ticket.ok) redirect(`/tickets/${id}?error=remote`);
  const ticketBody = await ticket.json();
  const deviceId = ticketBody.ticket?.device?.id;
  if (!deviceId) redirect(`/tickets/${id}?error=remote`);

  const response = await fetch(`${apiUrl}/v1/devices/${deviceId}/remote`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ticketId: Number(id) }),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect(`/tickets/${id}?error=remote`);
  const body = await response.json().catch(() => ({}));
  let target = null;
  try {
    target = new URL(body.url);
  } catch {
    target = null;
  }
  if (!target || target.origin !== meshOrigin) redirect(`/tickets/${id}?error=remote`);
  redirect(target.toString());
}
