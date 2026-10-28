import { forbidden, redirect } from "next/navigation";
import { accountFromSession } from "../account-data";
import { customersBase, preferredCustomersApp, queryString } from "./shared";

export default async function CustomersHome({ searchParams }) {
  const params = await searchParams;
  const account = await accountFromSession();
  if (account?.user?.isPlatformAdmin) redirect("/control/tenants");
  const app = await preferredCustomersApp(account);
  if (!app) forbidden();
  redirect(`${customersBase(app)}${queryString(params)}`);
}
