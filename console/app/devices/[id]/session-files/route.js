import { windowCors, windowForward, windowReply } from "../../../session-window-proxy";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: windowCors() });
}

// The session window offering a file to the customer's Session Panel: name, size and type first, then the bytes.
export async function POST(request, { params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return windowReply(404, { error: "There is no remote session on this device." });
  let body = {};
  try {
    body = JSON.parse(await request.text());
  } catch {
    return windowReply(400, { error: "That file could not be read." });
  }
  const clean = {
    name: String(body?.name || "").slice(0, 400),
    size: Number(body?.size),
    type: String(body?.type || "").slice(0, 160),
  };
  return windowForward(request, `/v1/devices/${id}/session-files`, { method: "POST", body: JSON.stringify(clean) });
}
