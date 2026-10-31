import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../../../account-data";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const SAVED = {
  create: "Script added.",
  update: "Script saved.",
  duplicate: "Copy made. Change it below and save.",
  archive: "Script removed from the library.",
};

export async function scriptsData(path) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const jar = await cookies();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${jar.get("df_session")?.value}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("The script library could not be loaded.");
  return { account, flags: navFlags(account), data: await response.json() };
}

export function RiskChip({ risk, risks }) {
  return <span className={`chip script-risk is-${risk}`}>{risks[risk] || risk}</span>;
}
