import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function GET(request, { params }) {
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const user = new URL(request.url).searchParams.get("user") || "";

  const response = await fetch(`${apiUrl}/v1/devices/${id}/remote`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ user }),
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/devices?error=remote");
  const body = await response.json();
  redirect(body.url);
}
