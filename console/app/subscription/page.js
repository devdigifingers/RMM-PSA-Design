import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, formatWhen, included, navFlags } from "../account-data";
import { Facts } from "../facts";

export default async function SubscriptionPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  const license = account.license;
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>Manage Subscription</h1>
        {license ? (
          <>
            <p className="org-name">{account.org?.name || "This organisation"}</p>
            <Facts rows={[
              { label: "License type", value: titlePlan(license.plan) },
              { label: "License number", value: String(license.number) },
              { label: "Seats", value: String(license.seats) },
              { label: "Systems that can be monitored", value: String(license.deviceCap) },
              { label: "Systems enrolled", value: String(license.deviceCount) },
              { label: "Remote sessions", value: included(license.remoteDesktop) },
              { label: "Ticketing", value: included(license.ticketing) },
              { label: "Monitoring", value: included(license.monitoring) },
              { label: "Patching", value: included(license.patch) },
              { label: "Reporting", value: included(license.reporting) },
              { label: "Expires", value: license.expiresAt ? formatWhen(license.expiresAt) : "No expiry date" },
            ]} />
          </>
        ) : (
          <p className="org-name">
            {account.user.isPlatformAdmin
              ? <>Licenses are assigned from the <a href="/control">control panel</a>.</>
              : "This account does not have a license yet."}
          </p>
        )}
      </main>
    </div>
  );
}

function titlePlan(plan) {
  const text = String(plan || "").replace(/[-_]/g, " ");
  if (!text) return "License";
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}
