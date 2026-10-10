import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";

export default async function HelpPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>Help</h1>
        <p className="org-name">Devices lists the computers enrolled for your organisation. Connect opens a remote session for one computer. Tickets, alerts, patches, and the dashboard follow the modules on your license.</p>
        <p className="org-name">For help with this console, write to admin@digitalfingers.co.za.</p>
      </main>
    </div>
  );
}
