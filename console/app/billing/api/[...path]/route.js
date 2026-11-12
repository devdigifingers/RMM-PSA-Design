import { cookies } from "next/headers";
import { fromConsole, refused } from "../../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

// The browser's way into /v1/billing: editor preview, document actions, PDFs and the logo upload.
async function forward(request, { params }) {
  if (request.method !== "GET" && !fromConsole(request)) return refused();
  const { path } = await params;
  if (!path.length || !path.every((part) => /^[a-z0-9-]{1,40}$/.test(part))) return Response.json({ error: "Not found." }, { status: 404 });
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const hasBody = request.method !== "GET" && request.method !== "DELETE";
  const upstream = await fetch(`${apiUrl}/v1/billing/${path.join("/")}${new URL(request.url).search}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, ...(hasBody ? { "content-type": "application/json" } : {}) },
    body: hasBody ? await request.text() : undefined,
    cache: "no-store",
  });
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of ["content-type", "content-disposition"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (String(upstream.headers.get("content-type")).startsWith("text/html")) headers.set("content-security-policy", "script-src 'none'; frame-ancestors 'self'");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
