import { cookies } from "next/headers";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";

function cors() {
  return {
    "access-control-allow-origin": meshOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function reply(status, body) {
  return Response.json(body, { status, headers: cors() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function POST(request, { params }) {
  if (request.headers.get("origin") !== meshOrigin) return reply(403, { error: "This request is not allowed." });
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return reply(401, { error: "Sign in to the console again." });
  const response = await fetch(`${apiUrl}/v1/support-sessions/${encodeURIComponent(id)}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return reply(401, { error: "Sign in to the console again." });
  if (!response.ok) return reply(response.status, { error: result.error || "The support session did not end." });
  return reply(200, { ok: true });
}
