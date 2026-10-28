import { cookies } from "next/headers";
import { fromConsole, refused } from "../../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Attachment not found." }, { status: 404 });
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const upstream = await fetch(`${apiUrl}/v1/attachments/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "content-security-policy"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
