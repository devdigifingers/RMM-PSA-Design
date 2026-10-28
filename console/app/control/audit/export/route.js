import { apiUrl, sessionToken } from "../../api";

const FILTERS = ["tenant", "actor", "action", "from", "to"];

export async function GET(request) {
  const token = await sessionToken();
  if (!token) return new Response("Sign in first.", { status: 401 });
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams({ format: "csv" });
  for (const key of FILTERS) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  const response = await fetch(`${apiUrl}/v1/platform/audit?${query}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 403 || response.status === 404) return new Response("Not found.", { status: 404 });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return new Response(body.error || "The export failed.", { status: response.status });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(await response.text(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
