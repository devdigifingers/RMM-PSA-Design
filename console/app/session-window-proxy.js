import { cookies } from "next/headers";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
export const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";

// The remote session window runs on the MeshCentral origin and calls these routes with the console cookie.
export function windowCors(methods = "GET, POST, OPTIONS") {
  return {
    "access-control-allow-origin": meshOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

export function windowReply(status, body, methods) {
  return Response.json(body, { status, headers: windowCors(methods) });
}

export async function windowForward(request, path, { method, body, stream = false, methods } = {}) {
  if (request.headers.get("origin") !== meshOrigin) return windowReply(403, { error: "This request is not allowed." }, methods);
  const token = (await cookies()).get("df_session")?.value;
  if (!token) return windowReply(401, { error: "Sign in to the console again." }, methods);
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(stream ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
      },
      body: stream ? request.body : body,
      ...(stream ? { duplex: "half" } : {}),
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return windowReply(502, { error: "Digital Fingers is not reachable right now." }, methods);
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) return windowReply(401, { error: "Sign in to the console again." }, methods);
  return windowReply(response.status, result, methods);
}
