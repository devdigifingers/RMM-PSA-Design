import { redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../../account-data";
import { ConsoleBar } from "../../bar";
import { reportsApi } from "../data";
import { ExportsView } from "./exports-view";

export const metadata = { title: "Scheduled exports" };

export default async function ExportsPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const [{ body: list }, { body: data }] = await Promise.all([
    reportsApi("/v1/reports"),
    reportsApi("/v1/report-subscriptions"),
  ]);
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main dx-page rx-page">
        <div className="dx-head">
          <div>
            <p className="rx-crumb"><a href="/reports">Reports</a></p>
            <h1>Scheduled exports</h1>
            <p className="rx-lead">Monthly PDF reports emailed to customer contacts, and the recurring CSV export of your fleet.</p>
          </div>
        </div>
        {params?.error === "export" ? <p className="error">The CSV export could not be scheduled.</p> : null}
        {params?.saved === "export" ? <p className="patch-done">CSV export scheduled.</p> : null}
        <ExportsView
          reports={(list.reports || []).filter((report) => report.available)}
          customers={list.customers || []}
          subscriptions={data.subscriptions || []}
          deliveries={data.deliveries || []}
          schedule={data.schedule || null}
          canManage={Boolean(data.canManage)}
        />
      </main>
    </div>
  );
}
