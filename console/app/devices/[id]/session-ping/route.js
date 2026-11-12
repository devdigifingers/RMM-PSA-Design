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

// The session window's check-in. The closing check-in is sent as text/plain so it needs no preflight while the
// window unloads.
export async function POST(request, { params }) {
  if (request.headers.get("origin") !== meshOrigin) return reply(403, { error: "This request is not allowed." });
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return reply(401, { error: "Sign in to the console again." });
  let body = {};
  try {
    body = JSON.parse(await request.text());
  } catch {
    body = {};
  }
  const response = await fetch(`${apiUrl}/v1/devices/${encodeURIComponent(id)}/session-ping`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      tsid: Number.isInteger(body?.tsid) ? body.tsid : null,
      closed: body?.closed === true,
    }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return reply(401, { error: "Sign in to the console again." });
  if (!response.ok) return reply(response.status, { error: result.error || "Check-in failed." });
  return reply(200, {
    tracked: result.tracked === true,
    paused: result.paused === true,
    endedBy: result.endedBy === "customer" ? "customer" : null,
    panel: typeof result.panel === "string" ? result.panel : null,
  });
}
