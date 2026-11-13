import { cookies } from "next/headers";
import { fromConsole, refused } from "../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

// A file sent during a remote session, downloaded from a timeline or from the session window (a navigation from the
// MeshCentral origin, which is on the same site).
export async function GET(request, { params }) {
  const fromWindow = request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-site") === "same-site";
  if (!fromWindow && !fromConsole(request, { navigation: true })) return refused();
  const { fileId } = await params;
  if (!/^\d+$/.test(fileId)) return Response.json({ error: "That file was not found." }, { status: 404 });
  const token = (await cookies()).get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const upstream = await fetch(`${apiUrl}/v1/remote-session-files/${fileId}/content`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!upstream.ok) {
    const result = await upstream.json().catch(() => ({}));
    const message = result.error || "That file could not be downloaded.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "content-security-policy", "x-content-type-options"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
