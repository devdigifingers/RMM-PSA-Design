"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateOutdatedAgents } from "../actions";
import { Card, InfoTip } from "../cards";
import { AMBER, Bars, Donut, Legend, RED, Ring, seriesColor } from "../charts";
import { ZaMap } from "./za-map";

const REFRESH_MS = 60000;

function devicesHref(customer, params = {}) {
  const query = new URLSearchParams();
  if (customer) query.set("customer", customer);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== "") query.set(key, value);
  const text = query.toString();
  return text ? `/devices?${text}` : "/devices";
}

function seenLabel(value) {
  if (!value) return "Never";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days < 1 ? "Today" : `${days} ${days === 1 ? "day" : "days"} ago`;
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", timeStyle: "short" }).format(new Date(value));
}

function dateTimeLabel(value) {
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DashboardView({ initial, initialCustomer, orgName }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [customer, setCustomer] = useState(initialCustomer || "");
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async (scope) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch(`/dashboard/data${scope ? `?customer=${encodeURIComponent(scope)}` : ""}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/";
        return;
      }
      if (!response.ok) throw new Error("load");
      setData(await response.json());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => load(customer), REFRESH_MS);
    const focus = () => { if (document.visibilityState === "visible") load(customer); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [customer, load]);

  function choose(value) {
    setCustomer(value);
    router.replace(value ? `/dashboard?customer=${encodeURIComponent(value)}` : "/dashboard", { scroll: false });
    load(value);
  }

  const href = (params) => devicesHref(customer, params);
  const k = data.kpis;
  const empty = k.total === 0;

  return (
    <>
      <div className="dx-head">
        <div>
          <h1>Dashboard</h1>
          <p className="org-name">{orgName}</p>
        </div>
        <div className="dx-controls">
          <label>
            <span>Customer</span>
            <select value={customer} onChange={(event) => choose(event.target.value)} aria-label="Customer">
              <option value="">All customers</option>
              {data.customers.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
              <option value="none">No customer</option>
            </select>
          </label>
          <span className={failed ? "dx-updated is-stale" : "dx-updated"} role="status">
            {failed ? "Could not refresh" : `Updated ${timeLabel(data.generatedAt)}`}
          </span>
        </div>
      </div>

      {empty ? (
        <section className="dx-card dx-empty-state">
          <h2>No devices enrolled yet</h2>
          <p>Download the agent installer to add your first computer.</p>
          <a className="dx-button" href="/downloads">Download the agent installer</a>
        </section>
      ) : null}

      <section className="dx-kpis" aria-label="Key figures">
        <Kpi label="Devices" href={href({})} info="Devices online now (checked in within the last minute) out of all enrolled devices." value={`${k.online}/${k.total}`} note="online" visual={<Ring pct={k.onlinePct} label={`${k.onlinePct}% online`} />} />
        {data.tickets ? (
          <Kpi label="Open tickets" href={data.tickets.overdue ? "/tickets?view=overdue" : "/tickets"} info="Tickets with status Open. Overdue counts every unresolved ticket past its resolution target — the same tickets as the Overdue view in Service Desk." value={data.tickets.open} note={data.tickets.sla ? `${data.tickets.overdue} overdue` : "No SLA targets yet"} tone={data.tickets.overdue ? "amber" : ""} />
        ) : null}
        {k.patchedPct != null ? (
          <Kpi label="Patched" href={href({ patch: "missing" })} info="Share of scanned devices with no missing updates." value={`${k.patchedPct}%`} note="fully patched" tone={k.patchedPct < 80 ? "amber" : "green"} />
        ) : null}
        {k.missing != null ? (
          <Kpi label="Missing patches" href={href({ patch: "missing" })} info="Updates available but not yet installed, across all devices." value={k.missing} note={`on ${k.missingDevices} ${k.missingDevices === 1 ? "device" : "devices"}`} tone={k.missing ? "red" : "green"} />
        ) : null}
        <Kpi label="Offline > 7 days" href={href({ status: "stale" })} info="Devices that have not checked in for 7 days or more, or never checked in." value={k.stale} note="not seen" tone={k.stale ? "amber" : "green"} />
        {k.lowDisk != null ? (
          <Kpi label="Low disk" href={href({ disk: "low" })} info="Devices with less than 10% free space on the system drive." value={k.lowDisk} note="under 10% free" tone={k.lowDisk ? "red" : "green"} />
        ) : null}
      </section>

      <div className="dx-grid">
        <AgentCard data={data} customer={customer} href={href} onQueued={() => load(customer)} />
        <OsCard data={data} href={href} />
        <LocationCard data={data} href={href} />
        <WorldCard data={data} href={href} />
        <StaleCard data={data} href={href} />
        <CustomersCard data={data} />
        {data.alerts ? <AlertsCard data={data} /> : null}
      </div>
    </>
  );
}

function Kpi({ label, value, note, href, info, tone = "", visual }) {
  return (
    <div className={`dx-kpi ${tone}`}>
      <a className="dx-kpi-link" href={href}>
        <span className="dx-kpi-text">
          <span className="dx-kpi-label">{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </span>
        {visual}
      </a>
      <InfoTip text={info} />
    </div>
  );
}

function AgentCard({ data, customer, href, onQueued }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { versions, outdated, updatable, releases } = data.agents;
  let colorIndex = 0;
  const segments = versions.map((item) => ({
    key: item.key,
    label: `${item.version === "Unknown" ? "Unknown (1.4 or older)" : item.version}${item.split ? ` · ${item.platforms.join(", ")}` : ""}`,
    value: item.count,
    pct: item.pct,
    color: item.version === "Unknown" ? RED : item.outdated ? AMBER : seriesColor(colorIndex++),
    href: href({ agent: item.version, outdated: item.split ? (item.outdated ? "1" : "0") : null }),
    badge: item.version === "Unknown" ? "Critical" : item.outdated ? "Outdated" : "Current",
    badgeTone: item.version === "Unknown" ? "red" : item.outdated ? "amber" : "green",
    detail: item.outdated && item.version !== "Unknown"
      ? item.platforms.map((platform) => `${platform} release is ${releases[platform.toLowerCase()] || "—"}`).join(" · ")
      : "",
  }));
  const outdatedPct = data.kpis.total ? Math.round((outdated / data.kpis.total) * 100) : 0;

  async function update() {
    if (!window.confirm(`Update ${updatable} outdated ${updatable === 1 ? "agent" : "agents"}? Windows devices update when they are idle; Linux devices update now through the remote desktop agent.`)) return;
    setBusy(true);
    const result = await updateOutdatedAgents(customer);
    setBusy(false);
    if (!result.ok) return setMessage(result.error);
    const parts = [];
    if (result.queued) parts.push(`${result.queued} Windows ${result.queued === 1 ? "update" : "updates"} queued`);
    if (result.sent) parts.push(`${result.sent} Linux ${result.sent === 1 ? "update" : "updates"} sent`);
    const failed = result.failed.map((item) => `${item.hostname}: ${item.error}`).join(" ");
    setMessage(`${parts.join(", ") || "Nothing was sent"}.${failed ? ` Not sent: ${failed}` : ""}`);
    onQueued();
  }

  return (
    <Card
      title="Agent versions"
      info={`Share of devices on each Digital Fingers agent version. Current release: Windows ${releases.windows || "—"}, Linux ${releases.linux || "—"}. Older versions are outdated.`}
      report="agents"
      canReport={data.canReport}
      href={href({ agent: "outdated" })}
    >
      <div className="dx-chart-row">
        <Donut segments={segments} centerValue={`${outdatedPct}%`} centerLabel="outdated" />
        <Legend items={segments} />
      </div>
      <div className="dx-card-foot">
        <a href={href({ agent: "outdated" })}>{`${outdated} outdated ${outdated === 1 ? "device" : "devices"}`}</a>
        {data.canUpdateAgents && updatable > 0 ? (
          <button type="button" className="dx-small-button" disabled={busy} onClick={update}>
            {busy ? "Queuing…" : `Update outdated agents (${updatable})`}
          </button>
        ) : null}
      </div>
      {message ? <p className="dx-note" role="status">{message}</p> : null}
    </Card>
  );
}

function OsCard({ data, href }) {
  const [active, setActive] = useState(null);
  const segments = data.os.map((item, index) => ({
    key: item.family,
    label: item.family,
    value: item.count,
    pct: item.pct,
    color: item.family === "Other" ? "#94A3B8" : seriesColor(index),
    href: href({ os: item.family }),
    detail: item.builds.length ? `Top builds: ${item.builds.map((build) => `${build.build} (${build.count})`).join(", ")}` : "",
  }));
  const current = data.os.find((item) => item.family === active);
  return (
    <Card title="Operating systems" info="Devices by operating system. Hover a slice to see the most common builds." report="os" canReport={data.canReport} href={href({})}>
      <div className="dx-chart-row">
        <Donut segments={segments} centerValue={String(data.kpis.total)} centerLabel="devices" onActive={setActive} />
        <Legend items={segments.map((segment) => ({ ...segment, detail: "" }))} />
      </div>
      <p className="dx-note" aria-live="polite">
        {current
          ? current.builds.length ? `${current.family} top builds: ${current.builds.map((build) => `${build.build} (${build.count})`).join(", ")}` : `${current.family}: no build reported yet.`
          : "Hover a slice to see the top builds."}
      </p>
    </Card>
  );
}

function LocationCard({ data, href }) {
  const [mode, setMode] = useState("location");
  const loc = data.location;
  const zaTotal = loc.zaCount;
  return (
    <Card
      title="South Africa"
      info="Devices by province, from each device's public IP at city level. A Site / Branch set on a device replaces its location when grouping by site."
      report="locations"
      canReport={data.canReport}
      href={href({ country: "ZA" })}
      className="dx-span"
      actions={(
        <span className="dx-toggle" role="group" aria-label="Group by">
          <button type="button" aria-pressed={mode === "location"} onClick={() => setMode("location")}>Location</button>
          <button type="button" aria-pressed={mode === "site"} onClick={() => setMode("site")}>Site</button>
        </span>
      )}
    >
      {mode === "location" ? (
        <div className="dx-location">
          <ZaMap provinces={loc.provinces} hrefFor={(name) => href({ region: name })} />
          <div className="dx-location-lists">
            <h3>Top provinces</h3>
            {zaTotal ? (
              <Bars items={loc.provinces.filter((item) => item.count).sort((a, b) => b.count - a.count).slice(0, 5).map((item) => ({ key: item.name, label: item.name, value: item.count, href: href({ region: item.name }) }))} />
            ) : <p className="dx-note">No devices located in South Africa yet.</p>}
            <h3>Top cities</h3>
            {loc.cities.length ? (
              <Bars items={loc.cities.map((item) => ({ key: `${item.city}-${item.region}`, label: `${item.city}${item.region ? `, ${item.region}` : ""}`, value: item.count, href: href({ city: item.city }) }))} />
            ) : <p className="dx-note">No cities yet.</p>}
          </div>
        </div>
      ) : (
        <div className="dx-location-lists">
          <h3>Sites and locations</h3>
          <Bars items={loc.groups.map((item) => ({ key: item.label, label: `${item.label}${item.kind === "site" ? " · site" : ""}`, value: item.count, href: href({ group: item.label }) }))} />
          <p className="dx-note">Set a Site / Branch on a device, or on many at once from the device list, to group them here.</p>
        </div>
      )}
    </Card>
  );
}

function WorldCard({ data, href }) {
  const loc = data.location;
  return (
    <Card title="Worldwide" info="Where devices connect from. Unknown means a private or unrecognised address, or the location has not been looked up yet." report="locations" canReport={data.canReport} href={href({})}>
      <p className="dx-world">
        <a href={href({ country: "ZA" })}><strong>{`${loc.zaPct}%`}</strong> South Africa</a>
        <span aria-hidden="true">·</span>
        <a href={href({ country: "other" })}><strong>{`${loc.restPct}%`}</strong> Rest of world</a>
      </p>
      <div className="dx-split" aria-hidden="true">
        <i style={{ width: `${loc.zaPct}%`, background: "#22D3EE" }} />
        <i style={{ width: `${loc.restPct}%`, background: "#3B82F6" }} />
        <i style={{ width: `${loc.unknownPct}%`, background: "#64748B" }} />
      </div>
      <h3>Top countries</h3>
      {loc.countries.length ? (
        <Bars items={loc.countries.map((item) => ({ key: item.code, label: item.name, value: item.count, href: href({ country: item.code }) }))} />
      ) : <p className="dx-note">No devices located yet.</p>}
      <p className="dx-unknown"><a href={href({ country: "Unknown" })}>{`Unknown: ${loc.unknown} ${loc.unknown === 1 ? "device" : "devices"} (${loc.unknownPct}%)`}</a></p>
      <p className="dx-credit">This product includes GeoLite2 data created by MaxMind, available from <a href="https://www.maxmind.com" target="_blank" rel="noreferrer">maxmind.com</a>.</p>
    </Card>
  );
}

function StaleCard({ data, href }) {
  return (
    <Card title="Not seen for 7+ days" info="Devices that have not checked in for 7 days or more, longest first." report="uptime" canReport={data.canReport} href={href({ status: "stale" })}>
      {data.stale.devices.length ? (
        <ul className="dx-list">
          {data.stale.devices.map((device) => (
            <li key={device.id}>
              <a href={`/devices/${device.id}/diagnostics`}>{device.name}</a>
              <span>{device.customer || "No customer"}</span>
              <small>{seenLabel(device.lastSeenAt)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="dx-note">Every device has checked in this week.</p>}
      {data.stale.count > 5 ? <p className="dx-card-foot"><a href={href({ status: "stale" })}>{`View all ${data.stale.count}`}</a></p> : null}
    </Card>
  );
}

function CustomersCard({ data }) {
  const [by, setBy] = useState("devices");
  const byAlerts = by === "alerts" && data.alerts;
  const list = byAlerts ? data.alerts.topCustomers : data.topCustomers;
  return (
    <Card
      title="Top customers"
      info={byAlerts ? "Customers with the most alerts in the last 7 days." : "Customers with the most enrolled devices."}
      actions={data.alerts ? (
        <span className="dx-toggle" role="group" aria-label="Rank by">
          <button type="button" aria-pressed={by === "devices"} onClick={() => setBy("devices")}>Devices</button>
          <button type="button" aria-pressed={by === "alerts"} onClick={() => setBy("alerts")}>Alerts</button>
        </span>
      ) : null}
    >
      {list.length ? (
        <Bars items={list.map((item) => ({ key: String(item.id), label: item.name, value: item.count, href: byAlerts ? `/alerts` : `/devices?customer=${item.id}` }))} />
      ) : <p className="dx-note">{byAlerts ? "No alerts in the last 7 days." : "No customers with devices yet."}</p>}
    </Card>
  );
}

function AlertsCard({ data }) {
  return (
    <Card title="Recent alerts" info="The latest monitoring alerts raised by your alert rules." href="/alerts">
      {data.alerts.recent.length ? (
        <ul className="dx-list">
          {data.alerts.recent.map((alert) => (
            <li key={alert.id}>
              <a href={`/devices/${alert.deviceId}/diagnostics`}>{alert.device}</a>
              <span>{`${alert.metric} ${alert.value}% (limit ${alert.threshold}%)`}</span>
              <small>{dateTimeLabel(alert.createdAt)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="dx-note">No alerts yet.</p>}
    </Card>
  );
}
