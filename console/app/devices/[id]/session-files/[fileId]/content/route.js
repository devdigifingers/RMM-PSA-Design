import { windowCors, windowForward, windowReply } from "../../../../../session-window-proxy";

const METHODS = "PUT, OPTIONS";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: windowCors(METHODS) });
}

// The bytes of a file offered to the customer, streamed straight through to the API.
export async function PUT(request, { params }) {
  const { id, fileId } = await params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(fileId)) return windowReply(404, { error: "That file was not found." }, METHODS);
  return windowForward(request, `/v1/devices/${id}/session-files/${fileId}/content`, { method: "PUT", stream: true, methods: METHODS });
}
