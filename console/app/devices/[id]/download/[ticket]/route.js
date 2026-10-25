import { cookies } from "next/headers";
import { fromConsole, refused } from "../../../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const { id, ticket } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const upstream = await fetch(`${apiUrl}/v1/devices/${id}/download/${ticket}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
