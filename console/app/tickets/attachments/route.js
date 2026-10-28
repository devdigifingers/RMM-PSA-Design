import { cookies } from "next/headers";
import { fromConsole, refused } from "../../request-guard";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!fromConsole(request)) return refused();
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const upstream = await fetch(`${apiUrl}/v1/attachments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "x-df-name": request.headers.get("x-df-name") || "",
      "x-df-type": request.headers.get("x-df-type") || "",
      "x-df-ticket": request.headers.get("x-df-ticket") || "",
    },
    body: request.body,
    duplex: "half",
    cache: "no-store",
  });
  const body = await upstream.json().catch(() => ({ error: "The file was not uploaded." }));
  return Response.json(body, { status: upstream.status, headers: { "cache-control": "no-store" } });
}
