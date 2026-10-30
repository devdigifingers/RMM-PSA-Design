import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, formatWhen, navFlags } from "../../../account-data";
import { apiGet } from "../../../customers/shared";
import { MIGRATION_STATUS, MODE_LABEL, statusLevel } from "../../../migration-labels";

export const metadata = { title: "Data migrations · Digital Fingers RMM" };

export default async function TenantMigrationsPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  const roles = account.user?.roles || [];
  if (account.user?.isPlatformAdmin || !(roles.includes("owner") || roles.includes("admin"))) forbidden();
  const response = await apiGet("/v1/migrations");
  const { items, canDecide } = response.ok ? await response.json() : { items: [], canDecide: false };

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/settings/org/migrations" />
        <h1>Data migrations</h1>
        <p className="org-name">
          Requests from the Digital Fingers platform team to move or copy data between your organisation and another one.
          Nothing moves until both organisations and a second platform admin approve.
          {canDecide ? "" : " Only owners can decide (or admins, when there is no owner)."}
        </p>
        {items.length === 0 ? <p className="org-name">There are no migration requests.</p> : (
          <div className="usage-table">
            <table>
              <thead>
                <tr><th>Request</th><th>Direction</th><th>Mode</th><th>Requested</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><Link href={`/settings/org/migrations/${item.id}`}>MIG-{item.id}</Link></td>
                    <td>{item.side === "source" ? `Out to ${item.target.name}` : `In from ${item.source.name}`}</td>
                    <td>{MODE_LABEL[item.mode]}</td>
                    <td>{formatWhen(item.submittedAt)}</td>
                    <td>
                      <span className={`usage-state${statusLevel(item.status)}`}>{MIGRATION_STATUS[item.status] || item.status}</span>
                      {item.waitingForMe ? <span className="usage-state is-near mig-yours">Needs your decision</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
