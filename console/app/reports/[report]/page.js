import { notFound, redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../../account-data";
import { ConsoleBar } from "../../bar";
import { reportQuery, reportsApi } from "../data";
import { ReportView } from "../report-view";

export async function generateMetadata({ params }) {
  const titles = {
    agents: "Agent version adoption", os: "OS and build inventory", locations: "Device locations", patches: "Patch compliance",
    uptime: "Uptime and availability", sessions: "Remote sessions", "service-desk": "Service Desk report",
  };
  return { title: titles[(await params).report] || "Reports" };
}

export default async function ReportPage({ params, searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const { report: key } = await params;
  const search = await searchParams;
  const query = reportQuery(search);
  const [{ body: list }, result] = await Promise.all([
    reportsApi("/v1/reports"),
    reportsApi(`/v1/reports/${encodeURIComponent(key)}${query ? `?${query}` : ""}`, { missingOk: true }),
  ]);
  if (!(list.reports || []).some((report) => report.key === key)) notFound();
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main dx-page rx-page">
        {result.ok ? (
          <ReportView
            report={result.body}
            customers={list.customers || []}
            customer={typeof search?.customer === "string" ? search.customer : ""}
            canManage={Boolean(list.canManage)}
          />
        ) : (
          <section className="dx-card">
            <h1>Reports</h1>
            <p className="dx-note">{result.body.error || "This report could not be loaded."}</p>
            <p><a href={`/reports/${key}`}>Show all customers</a></p>
          </section>
        )}
      </main>
    </div>
  );
}
