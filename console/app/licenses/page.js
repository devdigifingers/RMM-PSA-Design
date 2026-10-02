import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function LicensesPage() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/license-usage`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=report");
  const body = await response.json();
  const orgs = body.orgs || [];

  return (
    <div className="console">
      <ConsoleBar
        showTickets={body.canTicket}
        showAlerts={body.canMonitor}
        showPatches={body.canPatch}
        showDashboard={body.canReport}
        showLicenses
      />
      <main className="main">
        <h1>License usage</h1>
        <table>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Seats</th>
              <th>Devices</th>
              <th>Device cap</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>No organisations yet.</td>
              </tr>
            ) : (
              orgs.map((org) => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.seats}</td>
                  <td>{org.deviceCount}</td>
                  <td>{org.deviceCap}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
