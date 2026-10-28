import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
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
  if (response.status === 403) forbidden();
  const body = await response.json();
  const devices = body.devices || [];
  const tickets = body.openTickets || [];
  const compliance = body.compliance || [];
  const schedule = body.schedule || null;
  const latest = schedule?.latest || null;
  const reporting = devices.filter((device) => device.reporting).length;
  const overdue = tickets.filter((ticket) => late(ticket.clock)).length;
  const rows = compliance.flatMap((group) => group.devices.map((device) => ({ group: group.name, key: `${group.id}-${device.hostname}`, ...device })));
  const patched = rows.reduce((sum, row) => sum + row.patched.length, 0);
  const missing = rows.reduce((sum, row) => sum + row.missing.length, 0);

  return (
    <div className="console">
      <ConsoleBar
        showTickets={body.canTicket}
        showAlerts={body.canMonitor}
        showPatches={body.canPatch}
        showDashboard
      />
      <main className="main">
        <h1>Dashboard</h1>
        <p className="org-name">{body.org?.name || "Your organisation"}</p>

        <section className="dash-stats">
          <Stat tone="blue" label="Devices" value={body.deviceCount || 0} note={`${reporting} reporting`} icon={<MonitorIcon />} />
          <Stat tone="amber" label="Open tickets" value={tickets.length} note={body.sla ? `${overdue} past SLA` : "No SLA targets yet"} icon={<TicketIcon />} />
          <Stat tone="green" label="Patched" value={patched} note="Updates installed" icon={<ShieldIcon />} />
          <Stat tone="red" label="Missing" value={missing} note="Updates outstanding" icon={<AlertIcon />} />
        </section>

        <div className="dash-grid">
          <section className="dash-card dash-wide">
            <header>
              <h2>Health</h2>
              <span>{`${reporting} of ${devices.length} reporting`}</span>
            </header>
            {devices.length === 0 ? <p className="dash-empty">No devices yet.</p> : (
              <ul className="dash-health">
                {devices.map((device) => (
                  <li key={device.hostname}>
                    <div className="dash-device">
                      <i className={device.reporting ? "dash-dot on" : "dash-dot"} title={device.reporting ? "Reporting" : "Not reporting"} />
                      <div>
                        <strong>{device.hostname}</strong>
                        <span>{device.customerName || "No customer"}</span>
                      </div>
                    </div>
                    {device.reporting && device.cpuPercent != null ? (
                      <div className="dash-meters">
                        <Meter label="CPU" value={device.cpuPercent} />
                        <Meter label="Memory" value={device.memoryPercent} />
                        <Meter label="Disk" value={device.diskPercent} />
                      </div>
                    ) : (
                      <p className="dash-quiet">{device.reporting ? "Reporting" : "Not reporting"}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dash-card">
            <header>
              <h2>Open tickets</h2>
              <a href="/tickets">View all</a>
            </header>
            {tickets.length === 0 ? <p className="dash-empty">No open tickets.</p> : (
              <ul className="dash-tickets">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <a href={`/tickets/${ticket.id}`}>{ticket.subject}</a>
                    {body.sla && ticket.clock ? (
                      <div className="dash-sla">
                        <Clock label="Response" used={ticket.clock.responseElapsed} target={ticket.clock.responseMinutes} />
                        <Clock label="Resolve" used={ticket.clock.resolveElapsed} target={ticket.clock.resolveMinutes} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {body.sla ? null : <p className="dash-empty">No SLA targets yet.</p>}
          </section>

          <section className="dash-card">
            <header>
              <h2>Scheduled export</h2>
              {latest ? <a href="/dashboard/export">Download CSV</a> : null}
            </header>
            {schedule ? (
              latest ? (
                <>
                  <p className="dash-quiet">
                    {schedule.intervalMinutes === 1440
                      ? `CSV once a day. Next file in ${schedule.nextInHours} hours.`
                      : `CSV every ${schedule.intervalMinutes} ${schedule.intervalMinutes === 1 ? "minute" : "minutes"}.`}
                  </p>
                  <dl className="dash-facts">
                    <div><dt>Devices</dt><dd>{latest.deviceCount}</dd></div>
                    <div><dt>Open tickets</dt><dd>{latest.openTicketCount}</dd></div>
                    <div><dt>Response</dt><dd>{`${latest.responseMinutes} min`}</dd></div>
                    <div><dt>Resolve</dt><dd>{`${latest.resolveMinutes} min`}</dd></div>
                    <div><dt>Patched</dt><dd>{latest.patchedCount}</dd></div>
                    <div><dt>Missing</dt><dd>{latest.missingCount}</dd></div>
                  </dl>
                  <details className="dash-more">
                    <summary>Preview CSV</summary>
                    <pre className="output">{latest.csv}</pre>
                  </details>
                </>
              ) : (
                <p className="dash-quiet">CSV every {schedule.intervalMinutes} {schedule.intervalMinutes === 1 ? "minute" : "minutes"}. No file yet.</p>
              )
            ) : (
              <form className="dash-form" action={scheduleExport}>
                <label>
                  Every minutes
                  <input name="intervalMinutes" type="number" min={1} max={1440} defaultValue={1440} required />
                </label>
                <button type="submit">Schedule export</button>
              </form>
            )}
          </section>

          <section className="dash-card dash-wide">
            <header>
              <h2>Patch compliance</h2>
              <span>{`${patched} patched · ${missing} missing`}</span>
            </header>
            {rows.length === 0 ? <p className="dash-empty">No devices yet.</p> : (
              <div className="dash-table">
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
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.group}</td>
                        <td>{row.hostname}</td>
                        <td><Updates names={row.patched} tone="good" /></td>
                        <td><Updates names={row.missing} tone="bad" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Stat({ tone, label, value, note, icon }) {
  return (
    <div className={`dash-stat ${tone}`}>
      <span className="dash-stat-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function Meter({ label, value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = pct >= 85 ? "bad" : pct >= 70 ? "warn" : "good";
  return (
    <div className="dash-meter">
      <span>{label}</span>
      <div className={`dash-bar ${tone}`}><i style={{ width: `${pct}%` }} /></div>
      <b>{`${pct}%`}</b>
    </div>
  );
}

function Clock({ label, used, target }) {
  const over = Number(used) > Number(target);
  return (
    <span className={over ? "dash-chip bad" : "dash-chip"}>
      {`${label} ${duration(used)} / ${duration(target)}`}
    </span>
  );
}

function Updates({ names, tone }) {
  if (!names.length) return <span className="dash-chip">None</span>;
  return (
    <details className="dash-more">
      <summary><span className={`dash-chip ${tone}`}>{names.length}</span></summary>
      <ul>
        {names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
      </ul>
    </details>
  );
}

function late(clock) {
  if (!clock) return false;
  return clock.responseElapsed > clock.responseMinutes || clock.resolveElapsed > clock.resolveMinutes;
}

function duration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours}h ${total % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function MonitorIcon() {
  return <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function TicketIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M14 5v14" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2" /></svg>;
}

function ShieldIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function AlertIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v4M12 17v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
