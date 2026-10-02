import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAlertRule, createTicketFromAlert } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const metricLabel = { cpu: "CPU", memory: "Memory", disk: "Disk" };

export default async function AlertsPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/alerts`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=monitor");
  const body = await response.json();
  const alerts = body.alerts || [];
  const devices = body.devices || [];

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts showPatches={body.canPatch} showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main">
        <h1>Alerts</h1>
        {params?.error === "ticket" ? <p className="error">That alert could not open a ticket.</p> : null}
        {params?.error && params.error !== "ticket" ? <p className="error">That rule could not be saved.</p> : null}
        {devices.length > 0 ? (
          <section className="job">
            <h2>Rule</h2>
            <form action={createAlertRule}>
              <label>
                Device
                <select name="deviceId" required defaultValue={devices[0].id}>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>{device.hostname}</option>
                  ))}
                </select>
              </label>
              <label>
                Metric
                <select name="metric" defaultValue="disk">
                  <option value="cpu">CPU</option>
                  <option value="memory">Memory</option>
                  <option value="disk">Disk</option>
                </select>
              </label>
              <label>
                At or above
                <input name="threshold" type="number" min="1" max="100" required defaultValue="10" />
              </label>
              <button type="submit">Create rule</button>
            </form>
          </section>
        ) : null}
        <h2>Inbox</h2>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Metric</th>
              <th>Reading</th>
              <th>Rule</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td className="empty" colSpan={5}>No alerts yet.</td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.hostname}</td>
                  <td>{metricLabel[alert.metric] || alert.metric}</td>
                  <td>{alert.value}%</td>
                  <td>At or above {alert.threshold}%</td>
                  <td>
                    {alert.ticketId ? (
                      <a href={`/tickets/${alert.ticketId}`}>Open ticket</a>
                    ) : body.canTicket ? (
                      <form action={createTicketFromAlert}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <button type="submit">Create ticket</button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
