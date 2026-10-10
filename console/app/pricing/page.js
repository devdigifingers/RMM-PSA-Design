import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";

export default async function PricingPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>Pricing</h1>
        <p className="org-name">A license is issued to one organisation. It sets the plan, the number of seats, how many systems can be monitored, and whether remote sessions, ticketing, monitoring, patching, and reporting are included.</p>
        <p className="org-name">Your numbers are on Manage Subscription. Prices are agreed with Digital Fingers and are not listed in the console.</p>
      </main>
    </div>
  );
}
