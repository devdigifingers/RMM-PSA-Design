import { cookies } from "next/headers";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";

function cors() {
  return {
    "access-control-allow-origin": meshOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
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
  if (!/^\d+$/.test(id)) return reply(404, { error: "Device not found." });
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return reply(401, { error: "Sign in to the console again." });
  const response = await fetch(`${apiUrl}/v1/devices/${id}/remote/resume`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!response) return reply(502, { error: "The console could not reach the server." });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return reply(401, { error: "Sign in to the console again." });
  if (!response.ok) return reply(response.status, { error: result.error || "The device could not be checked." });
  return reply(200, { online: result.online === true, ...(result.url ? { url: result.url } : {}) });
}
