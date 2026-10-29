import { cookies } from "next/headers";
import { fromConsole, refused } from "../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const query = new URL(request.url).search;
  const upstream = await fetch(`${apiUrl}/v1/tickets/export${query}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
