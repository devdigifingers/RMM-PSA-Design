import { redirect } from "next/navigation";
import { ConsoleBar } from "../../bar";
import { accountFromSession, navFlags } from "../../account-data";
import { SettingsHome } from "../../settings-home";

export const metadata = { title: "Invoicing settings" };

export default async function BillingSettingsPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsHome areaKey="billing" account={account} query={typeof params?.q === "string" ? params.q : ""} />
      </main>
    </div>
  );
}
