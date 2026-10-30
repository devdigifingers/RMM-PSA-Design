import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../../account-data";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function deskSettingsData(path = "/v1/desk/setup") {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  if (!response.ok) throw new Error("Service Desk settings could not be loaded.");
  return { account, flags: navFlags(account), setup: await response.json() };
}

export function Notice({ params, saved }) {
  if (params?.error) return <p className="error">{String(params.error)}</p>;
  const text = saved[params?.saved];
  if (!text) return null;
  return <p className="org-name cust-saved">{typeof text === "function" ? text(params) : text}</p>;
}
