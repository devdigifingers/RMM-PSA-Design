import { windowCors, windowForward, windowReply } from "../../../../session-window-proxy";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: windowCors() });
}

// The technician cancelling a file before the customer accepts it.
export async function POST(request, { params }) {
  const { id, fileId } = await params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(fileId)) return windowReply(404, { error: "That file was not found." });
  return windowForward(request, `/v1/devices/${id}/session-files/${fileId}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
}
