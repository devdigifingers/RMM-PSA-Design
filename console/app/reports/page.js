import { redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../account-data";
import { ConsoleBar } from "../bar";
import { reportsApi } from "./data";

export const metadata = { title: "Reports" };

export default async function ReportsHome() {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const [{ body: list }, { body: scheduled }] = await Promise.all([
    reportsApi("/v1/reports"),
    reportsApi("/v1/report-subscriptions"),
  ]);
  const reports = (list.reports || []).filter((report) => report.available);
  const subscriptions = scheduled.subscriptions || [];
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main dx-page rx-page">
        <div className="dx-head">
          <div>
            <h1>Reports</h1>
            <p className="rx-lead">Trends, exports and scheduled reports for your fleet and customers.</p>
          </div>
        </div>
        <div className="rx-index">
          {reports.map((report) => (
            <a key={report.key} className="rx-index-card" href={`/reports/${report.key}`}>
              <h2>{report.title}</h2>
              <p>{report.description}</p>
              <span className="dx-report">Open report →</span>
            </a>
          ))}
          <a className="rx-index-card is-scheduled" href="/reports/exports">
            <h2>Scheduled exports</h2>
            <p>
              {subscriptions.length
                ? `${subscriptions.length} monthly ${subscriptions.length === 1 ? "report is" : "reports are"} emailed to customers.`
                : "Email a monthly PDF of any report to a customer contact."}
              {scheduled.schedule ? " A CSV export also runs on a schedule." : ""}
            </p>
            <span className="dx-report">Manage schedules →</span>
          </a>
        </div>
      </main>
    </div>
  );
}
