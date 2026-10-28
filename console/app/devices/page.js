import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { AppTitle } from "../mark";
import { DeviceDetails } from "./details-window";
import { OsMark } from "./os-mark";
import { RemoteActions } from "./remote-actions";
import { SessionFilter } from "./session-filter";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DevicesPage({ searchParams }) {
  const params = await searchParams;
  const q = typeof params?.q === "string" ? params.q : "";
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/devices?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/control");
  const body = await response.json();
  const devices = body.devices || [];

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <h1><AppTitle app="remote-desk">Devices</AppTitle></h1>
        <div className="find-row">
          <form className="find" method="get">
            <label className="search">
              <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input name="q" placeholder="Search" defaultValue={q} aria-label="Search" />
            </label>
          </form>
          {body.canRemote ? <SessionFilter /> : null}
        </div>
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
        <div className="systems">
        <table>
          <thead>
            <tr>
              <th className="status-col">Status</th>
              <th>Display name</th>
              <th>Hostname</th>
              <th>Address</th>
              <th>Account</th>
              <th>Operating system</th>
              <th>Active Users</th>
              <th>Last seen</th>
              <th>Agent</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td className="empty" colSpan={10}>No devices enrolled yet.</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id} data-device={device.id}>
                  <td className="status-col"><Presence presence={device.presence} /></td>
                  <td>{device.displayName || device.hostname}</td>
                  <td>
                    <DeviceDetails
                      deviceId={device.id}
                      hostname={device.hostname}
                      canRemote={Boolean(body.canRemote)}
                      users={device.users || []}
                    />
                  </td>
                  <td>{device.ipv4 || "—"}</td>
                  <td>
                    {device.customerName && device.customerId ? (
                      <a href={`/remote/customers/${device.customerId}?tab=devices`}>{device.customerName}</a>
                    ) : device.customerName || "No account"}
                  </td>
                  <td>
                    <span className="os-name">
                      {device.osName ? <OsMark osName={device.osName} /> : null}
                      {device.osName || "—"}
                    </span>
                  </td>
                  <td>{device.users?.length ? device.users.join(", ") : "—"}</td>
                  <td>{formatSeen(device.lastSeenAt)}</td>
                  <td>
                    <span className={device.agentOutdated ? "agent-version agent-old" : "agent-version"} title={device.agentOutdated ? `Version ${body.latestAgent} is available` : undefined}>
                      {device.agentVersion || (device.agentOutdated ? "1.4.0 or older" : "—")}
                    </span>
                  </td>
                  <td>
                    {body.canRemote ? (
                      <RemoteActions
                        deviceId={device.id}
                        hostname={device.hostname}
                        label={device.displayName || ""}
                        users={device.users || []}
                        agent={body.canOperate && body.latestAgent && /windows/i.test(device.osName || "")
                          ? { version: device.agentVersion, latest: body.latestAgent, outdated: device.agentOutdated }
                          : null}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
            {devices.length ? (
              <tr className="no-live">
                <td className="empty" colSpan={10}>No remote sessions are open right now.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </main>
    </div>
  );
}

function Presence({ presence }) {
  const label = presence === "online" ? "Online" : presence === "rebooting" ? "Rebooting" : "Offline";
  const tone = presence === "online" || presence === "rebooting" ? presence : "offline";
  return <span className={`presence presence-${tone}`} title={label} aria-label={label} />;
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

