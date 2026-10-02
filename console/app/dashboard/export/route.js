import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function GET() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/report-runs/latest`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=report");
  if (!response.ok) redirect("/dashboard");
  const csv = await response.text();
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=dashboard.csv",
    },
  });
}
