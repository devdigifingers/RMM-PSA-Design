import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { AppTitle } from "../mark";
import { DeviceDetails } from "./details-window";
import { OsMark } from "./os-mark";
import { RemoteActions } from "./remote-actions";
import { SessionFilter } from "./session-filter";
import { BulkSite, CustomerFilter } from "./device-filters";
import { ColumnPicker } from "./column-picker";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const FILTERS = ["customer", "status", "os", "build", "agent", "outdated", "country", "region", "city", "group", "site", "disk", "patch"];

const STATUS_LABELS = { online: "Online", offline: "Offline", stale: "Not seen for 7+ days" };

function filterLabel(key, value, customers) {
  if (key === "customer") return value === "none" ? "No customer" : customers.find((item) => String(item.id) === value)?.name || "Customer";
  if (key === "status") return STATUS_LABELS[value] || value;
  if (key === "agent") return value === "outdated" ? "Outdated agents" : `Agent ${value}`;
  if (key === "country") return value === "other" ? "Outside South Africa" : value === "ZA" ? "South Africa" : value === "Unknown" ? "Unknown location" : `Country ${value}`;
  if (key === "outdated") return value === "1" ? "Outdated" : "Up to date";
  if (key === "disk") return "Low disk";
  if (key === "patch") return "Missing patches";
  if (key === "site") return value === "none" ? "No site" : `Site ${value}`;
  if (key === "build") return `Build ${value}`;
  return value;
}

const REMOTE_AGENT_LABEL = {
  stopped: "Remote support stopped",
  missing: "Remote support missing",
  repairing: "Reinstalling remote support",
  blocked: "Remote support blocked",
};

export default async function DevicesPage({ searchParams }) {
  const params = await searchParams;
  const q = typeof params?.q === "string" ? params.q : "";
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const hiddenColumns = (jar.get("df_device_cols")?.value || "").split(",").filter(Boolean);
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  for (const key of FILTERS) {
    if (typeof params?.[key] === "string" && params[key]) query.set(key, params[key]);
  }

  const response = await fetch(`${apiUrl}/v1/devices?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/control");
  const body = await response.json();
  const devices = body.devices || [];
  const customers = body.customers || [];
  const active = Object.entries(body.filter || {});
  const without = (key) => {
    const next = new URLSearchParams(query);
    next.delete(key);
    const text = next.toString();
    return text ? `/devices?${text}` : "/devices";
  };

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
            {active.map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          </form>
          <CustomerFilter customers={customers} value={body.filter?.customer || ""} />
          {body.canRemote ? <SessionFilter /> : null}
        </div>
        <p className="org-name">
          {body.org?.name || "Your organisation"} · {active.length || q
            ? `${body.deviceCount || 0} of ${body.enrolledCount ?? body.deviceCount ?? 0} enrolled`
            : `${body.deviceCount || 0} enrolled`}
        </p>
        {active.length ? (
          <div className="active-filters" aria-label="Active filters">
            {active.map(([key, value]) => (
              <a key={key} className="active-filter" href={without(key)} aria-label={`Remove filter ${filterLabel(key, value, customers)}`}>
                {filterLabel(key, value, customers)}
                <span aria-hidden="true">×</span>
              </a>
            ))}
            <a className="active-filters-clear" href={q ? `/devices?q=${encodeURIComponent(q)}` : "/devices"}>Clear filters</a>
          </div>
        ) : null}
        <BulkSite />
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
        <div className="systems-tools">
          <ColumnPicker initialHidden={hiddenColumns} />
        </div>
        <div className="systems">
        <table>
          <thead>
            <tr>
              <th className="pick-col"><input type="checkbox" className="bulk-all" aria-label="Select all devices" /></th>
              <th className="status-col">Status</th>
              <th>Display name</th>
              <th>Hostname</th>
              <th>Address</th>
              <th>Account</th>
              <th>Site / Location</th>
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
                <td className="empty" colSpan={12}>
                  {active.length || q ? "No devices match these filters." : <>No devices enrolled yet. <a href="/downloads">Download the agent installer</a>.</>}
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id} data-device={device.id}>
                  <td className="pick-col"><input type="checkbox" className="bulk-pick" value={device.id} aria-label={`Select ${device.displayName || device.hostname}`} /></td>
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
                    {device.siteOverride
                      ? <span className="site-tag" title="Site / Branch set on this device">{device.siteOverride}</span>
                      : device.location || "Unknown"}
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
                    <span className={device.agentOutdated ? "agent-version agent-old" : "agent-version"} title={device.agentOutdated ? `Version ${device.agentLatest} is available` : undefined}>
                      {device.agentVersion || (device.agentOutdated ? "1.4.0 or older" : "—")}
                    </span>
                    {device.remoteAgent && !device.remoteAgent.ok ? (
                      <span className={`remote-agent-warn remote-agent-${device.remoteAgent.state}`} title={[device.remoteAgent.message, device.remoteAgent.detail].filter(Boolean).join(" ")}>
                        {REMOTE_AGENT_LABEL[device.remoteAgent.state] || "Remote support issue"}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {body.canRemote ? (
                      <RemoteActions
                        deviceId={device.id}
                        hostname={device.hostname}
                        label={device.displayName || ""}
                        users={device.users || []}
                        agent={body.canOperate && device.agentLatest
                          ? { version: device.agentVersion, latest: device.agentLatest, outdated: device.agentOutdated, linux: !/windows/i.test(device.osName || "") }
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
                <td className="empty" colSpan={12}>No remote sessions are open right now.</td>
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

