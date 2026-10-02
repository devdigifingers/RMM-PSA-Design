import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scheduleExport } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DashboardPage() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/dashboard`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=report");
  const body = await response.json();
  const devices = body.devices || [];
  const tickets = body.openTickets || [];
  const compliance = body.compliance || [];
  const schedule = body.schedule || null;
  const latest = schedule?.latest || null;

  return (
    <div className="console">
      <ConsoleBar
        showTickets={body.canTicket}
        showAlerts={body.canMonitor}
        showPatches={body.canPatch}
        showDashboard
        showLicenses
      />
      <main className="main">
        <h1>Dashboard</h1>
        <p className="org-name">{body.org?.name || "Your organisation"}</p>
        <h2>Devices</h2>
        <p className="org-name">{body.deviceCount || 0} enrolled</p>
        <ul className="updates">
          {devices.map((device) => (
            <li key={device.hostname}>{device.hostname}</li>
          ))}
        </ul>
        <h2>Open tickets</h2>
        {tickets.length === 0 ? (
          <p className="org-name">No open tickets.</p>
        ) : (
          <ul className="updates">
            {tickets.map((ticket) => (
              <li key={ticket.id}>{ticket.subject}</li>
            ))}
          </ul>
        )}
        <h2>SLA</h2>
        <p className="org-name">
          {body.sla
            ? `Response ${body.sla.responseMinutes} minutes. Resolve ${body.sla.resolveMinutes} minutes.`
            : "No SLA targets yet."}
        </p>
        <h2>Health</h2>
        <ul className="updates">
          {devices.map((device) => (
            <li key={`health-${device.hostname}`}>{healthLine(device)}</li>
          ))}
        </ul>
        <h2>Patch compliance</h2>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Device</th>
              <th>Patched</th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {compliance.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>No devices yet.</td>
              </tr>
            ) : (
              compliance.flatMap((group) => group.devices.map((device) => (
                <tr key={`${group.id}-${device.hostname}`}>
                  <td>{group.name}</td>
                  <td>{device.hostname}</td>
                  <td>{device.patched.length > 0 ? device.patched.join(", ") : "None"}</td>
                  <td>{device.missing.length > 0 ? device.missing.join(", ") : "None"}</td>
                </tr>
              )))
            )}
          </tbody>
        </table>
        <h2>Scheduled export</h2>
        {schedule ? (
          latest ? (
            <>
              <p className="org-name">
                {schedule.intervalMinutes === 1440
                  ? `CSV once a day. Next file in ${schedule.nextInHours} hours.`
                  : `CSV every ${schedule.intervalMinutes} ${schedule.intervalMinutes === 1 ? "minute" : "minutes"}.`}
              </p>
              <ul className="updates">
                <li>{`Devices ${latest.deviceCount}`}</li>
                <li>{`Open tickets ${latest.openTicketCount}`}</li>
                <li>{`Response ${latest.responseMinutes} minutes`}</li>
                <li>{`Resolve ${latest.resolveMinutes} minutes`}</li>
                <li>{`Patched ${latest.patchedCount}`}</li>
                <li>{`Missing ${latest.missingCount}`}</li>
              </ul>
              <p className="org-name">
                <a href="/dashboard/export">Download CSV</a>
              </p>
              <pre className="output">{latest.csv}</pre>
            </>
          ) : (
            <p className="org-name">CSV every {schedule.intervalMinutes} {schedule.intervalMinutes === 1 ? "minute" : "minutes"}. No file yet.</p>
          )
        ) : (
          <section className="job">
            <form className="stack" action={scheduleExport}>
              <label>
                Every minutes
                <input name="intervalMinutes" type="number" min={1} max={1440} defaultValue={1440} required />
              </label>
              <button type="submit">Schedule export</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

function healthLine(device) {
  if (!device.reporting) return `${device.hostname} is not reporting.`;
  if (device.cpuPercent == null) return `${device.hostname} is reporting.`;
  return `${device.hostname} is reporting. CPU ${device.cpuPercent}%. Memory ${device.memoryPercent}%. Disk ${device.diskPercent}%.`;
}
