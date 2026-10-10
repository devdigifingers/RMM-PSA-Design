import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";

export default async function OffersPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>Offers</h1>
        <p className="org-name">There are no published offers in the console. Write to admin@digitalfingers.co.za if you want to change the license.</p>
      </main>
    </div>
  );
}
