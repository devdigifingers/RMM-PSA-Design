import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountFromSession } from "../account-data";
import { ConsoleBar } from "../bar";
import { Card } from "../cards";
import { DashboardView } from "./dashboard-view";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const account = await accountFromSession();
  if (account?.user?.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const customer = typeof params?.customer === "string" ? params.customer : "";

  const response = await fetch(`${apiUrl}/v1/dashboard/overview${customer ? `?customer=${encodeURIComponent(customer)}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/control");
  const data = await response.json();

  return (
    <div className="console">
      <ConsoleBar showTickets={data.canTicket} showAlerts={data.canMonitor} showPatches={data.canPatch} showDashboard />
      <main className="main dx-page">
        <DashboardView initial={data} initialCustomer={data.customer || ""} orgName={data.orgName || "Your organisation"} />
        <Card title="Scheduled exports" report="exports" canReport={data.canReport} className="dx-export">
          <p className="dx-note">CSV exports and monthly PDF reports emailed to your customers are managed in the Reports app.</p>
        </Card>
      </main>
    </div>
  );
}
