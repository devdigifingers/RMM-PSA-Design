import { cookies } from "next/headers";
import { fromConsole, refused } from "../../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  if (!fromConsole(request)) return refused();
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const upstream = await fetch(`${apiUrl}/v1/devices/${id}/download`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: await request.text(),
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
