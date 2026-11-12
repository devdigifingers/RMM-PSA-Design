import { cookies } from "next/headers";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";
const CURSOR_PARAMS = ["after", "typing", "read", "wait"];

export const dynamic = "force-dynamic";

function cors() {
  return {
    "access-control-allow-origin": meshOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
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

async function forward(request, id, init) {
  if (request.headers.get("origin") !== meshOrigin) return reply(403, { error: "This request is not allowed." });
  if (!/^\d+$/.test(String(id))) return reply(404, { error: "There is no remote session on this device." });
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return reply(401, { error: "Sign in to the console again." });
  let response;
  try {
    response = await fetch(`${apiUrl}/v1/devices/${id}/session-chat${init.query || ""}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body,
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return reply(502, { error: "Chat is not reachable right now." });
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return reply(401, { error: "Sign in to the console again." });
  return reply(response.status, result);
}

// The session window's chat with the customer's Session Panel: GET long-polls for new messages, typing and read
// marks; POST sends a message, a typing signal or a read mark.
export async function GET(request, { params }) {
  const { id } = await params;
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of CURSOR_PARAMS) {
    const value = incoming.get(key);
    if (value && /^\d+$/.test(value)) query.set(key, value);
  }
  return forward(request, id, { method: "GET", query: `?${query}` });
}

export async function POST(request, { params }) {
  const { id } = await params;
  let body = {};
  try {
    body = JSON.parse(await request.text());
  } catch {
    return reply(400, { error: "That message could not be read." });
  }
  const clean = {};
  if (typeof body?.text === "string") clean.text = body.text.slice(0, 4000);
  else if (typeof body?.typing === "boolean") clean.typing = body.typing;
  else if (Number.isSafeInteger(body?.read)) clean.read = body.read;
  return forward(request, id, { method: "POST", body: JSON.stringify(clean) });
}
