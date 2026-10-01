import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout, runJob } from "../actions";

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
      <header className="topbar">
        <img className="wordmark" src="/brand/wordmark-silver.png" alt="Digital Fingers" />
        <form action={logout}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="main">
        <h1>Devices</h1>
        <p className="org-name">
          {body.org?.name || "Your organisation"} · {body.deviceCount || 0} enrolled
        </p>
        {remoteNote(body.remoteReason)}
        {params?.error === "remote" && !body.remoteReason ? (
          <p className="error">Remote desktop is not available on this license.</p>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>Hostname</th>
              <th>Operating system</th>
              <th>Last seen</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>No devices enrolled yet.</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.hostname}</td>
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
            <form action={runJob}>
              <input type="hidden" name="deviceId" value={device.id} />
              <label>
                Command
                <input name="command" defaultValue="uname -srm" required />
              </label>
              <button type="submit">Run</button>
            </form>
            {device.latestJob ? (
              <pre className="output">{device.latestJob.status === "finished" ? device.latestJob.output : device.latestJob.status}</pre>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  );
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
