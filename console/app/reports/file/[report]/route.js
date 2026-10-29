import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fromConsole, refused } from "../../../request-guard";
import { reportQuery } from "../../data";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function GET(request, { params }) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const token = (await cookies()).get("df_session")?.value;
  if (!token) redirect("/");
  const { report } = await params;
  const search = Object.fromEntries(new URL(request.url).searchParams);
  const format = search.format === "pdf" ? "pdf" : "csv";
  const response = await fetch(`${apiUrl}/v1/reports/${encodeURIComponent(report)}?${reportQuery(search, { format })}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return new Response(body.error || "The report could not be exported.", { status: response.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") || "application/octet-stream",
      "content-disposition": response.headers.get("content-disposition") || `attachment; filename=report.${format}`,
      "cache-control": "no-store",
    },
  });
}
