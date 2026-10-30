import { redirect } from "next/navigation";
import { accountFromSession } from "../account-data";

export default async function LicensesPage() {
  const account = await accountFromSession();
  redirect(account?.user?.isPlatformAdmin ? "/control" : "/settings/org/subscription");
}
