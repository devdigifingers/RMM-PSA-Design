import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runJob } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DevicesPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/devices`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const body = await response.json();
  const devices = body.devices || [];

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main">
        <h1>Devices</h1>
        <p className="org-name">
          {body.org?.name || "Your organisation"} · {body.deviceCount || 0} enrolled
        </p>
        {remoteNote(body.remoteReason)}
        {params?.error === "ticket" && body.canTicket === false ? (
          <p className="org-name">Ticketing is not included on this license.</p>
        ) : null}
        {params?.error === "monitor" && body.canMonitor === false ? (
          <p className="org-name">Monitoring is not included on this license.</p>
        ) : null}
        {params?.error === "patch" && body.canPatch === false ? (
          <p className="org-name">Patch management is not included on this license.</p>
        ) : null}
        {params?.error === "report" && body.canReport === false ? (
          <p className="org-name">Reporting is not included on this license.</p>
        ) : null}
        {params?.error === "remote" && !body.remoteReason ? (
          <p className="error">Remote desktop is not available on this license.</p>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>Hostname</th>
              <th>Customer</th>
              <th>Operating system</th>
              <th>Last seen</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td className="empty" colSpan={5}>No devices enrolled yet.</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.hostname}</td>
                  <td>{device.customerName || "No customer"}</td>
                  <td>{device.osName || "—"}</td>
                  <td>{formatSeen(device.lastSeenAt)}</td>
                  <td>
                    {body.canRemote ? (
                      <a className="remote" href={`/devices/${device.id}/remote`}>Open</a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {devices.map((device) => (
          <section className="job" key={`job-${device.id}`}>
            <h2>{device.hostname}</h2>
            <p className="org-name">{assetLine(device)}</p>
            <SoftwareList software={device.software} />
            {body.canMonitor && device.metrics ? <p className="org-name">{formatMetrics(device.metrics)}</p> : null}
            {body.canPatch ? <UpdateList updates={device.updates} /> : null}
            {body.canOperate ? (
              <form action={runJob}>
                <input type="hidden" name="deviceId" value={device.id} />
                <label>
                  Command
                  <input name="command" defaultValue={defaultCommand(device.osName)} required />
                </label>
                <button type="submit">Run</button>
              </form>
            ) : null}
            {device.latestJob ? (
              <pre className="output">{device.latestJob.status === "finished" ? device.latestJob.output : device.latestJob.status}</pre>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  );
}

function defaultCommand(osName) {
  return /windows/i.test(osName || "") ? "ver" : "uname -srm";
}

function remoteNote(reason) {
  if (reason === "expired") return <p className="error">This license has expired.</p>;
  if (reason === "module") return <p className="org-name">Remote desktop is not included on this license.</p>;
  return null;
}

function formatSeen(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function assetLine(device) {
  if (!device.make && !device.model && !device.serial) return "Asset details have not been collected yet.";
  return `Make ${device.make || "—"}. Model ${device.model || "—"}. Serial ${device.serial || "—"}.`;
}

function SoftwareList({ software }) {
  if (!Array.isArray(software)) return <p className="org-name">Installed software has not been collected yet.</p>;
  if (software.length === 0) return <p className="org-name">No installed software reported.</p>;
  return (
    <ul className="updates">
      {software.map((item) => (
        <li key={`${item.name} ${item.version}`}>{item.version ? `${item.name} ${item.version}` : item.name}</li>
      ))}
    </ul>
  );
}

function UpdateList({ updates }) {
  if (!Array.isArray(updates)) return <p className="org-name">Updates have not been collected yet.</p>;
  if (updates.length === 0) return <p className="org-name">No updates waiting.</p>;
  return (
    <ul className="updates">
      {updates.map((item) => (
        <li key={`${item.name} ${item.availableVersion}`}>{formatUpdate(item)}</li>
      ))}
    </ul>
  );
}

function formatUpdate(item) {
  if (item.currentVersion && item.availableVersion) {
    return `${item.name} ${item.currentVersion} → ${item.availableVersion}`;
  }
  if (item.availableVersion && !String(item.name).includes(item.availableVersion)) {
    return `${item.name} (${item.availableVersion})`;
  }
  return item.name;
}

function formatMetrics(metrics) {
  return `CPU ${metrics.cpuPercent}%. Memory ${metrics.memoryPercent}% (${formatBytes(metrics.memoryUsedBytes)} of ${formatBytes(metrics.memoryTotalBytes)}). Disk ${metrics.diskPercent}% (${formatBytes(metrics.diskUsedBytes)} of ${formatBytes(metrics.diskTotalBytes)}). Uptime ${formatUptime(metrics.uptimeSeconds)}.`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatUptime(value) {
  const seconds = Number(value) || 0;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const minuteLabel = minutes === 1 ? "minute" : "minutes";
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${minuteLabel}`;
  return `${minutes} ${minuteLabel}`;
}
