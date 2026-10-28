import { forbidden, redirect } from "next/navigation";
import { accountFromSession } from "../../account-data";
import { customersBase, preferredCustomersApp, queryString } from "../shared";

const TAB_APP = { devices: "remote", sessions: "remote", tickets: "desk", sla: "desk", reports: "desk" };

export default async function CustomerRedirect({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const account = await accountFromSession();
  if (account?.user?.isPlatformAdmin) redirect("/control/tenants");
  const app = await preferredCustomersApp(account, TAB_APP[query?.tab]);
  if (!app) forbidden();
  const tab = query?.tab === "reports" ? "overview" : query?.tab;
  redirect(`${customersBase(app)}/${Number(id) || 0}${queryString({ ...query, tab }, tab ? [] : ["tab"])}`);
}
