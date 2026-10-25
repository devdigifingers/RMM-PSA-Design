import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { approveUrgentUpdates, savePatchRules } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const CATEGORY_LABELS = {
  Security: ["Security updates", "Fixes for security holes."],
  Critical: ["Critical updates", "Important fixes that are not security related."],
  Definition: ["Definition updates", "Microsoft Defender virus definitions. Safe to approve automatically."],
  Rollup: ["Update rollups", "Bundles of earlier fixes."],
  Driver: ["Drivers", "Hardware drivers. Best checked by hand."],
  Feature: ["Feature packs", "New Windows features."],
  "Service pack": ["Service packs", "Large bundles of fixes."],
  Tool: ["Tools", "Such as the Malicious Software Removal Tool."],
  Update: ["Other updates", "Everything without a type, including Linux packages."],
  Upgrade: ["Upgrades", "New Windows versions. Best checked by hand."],
};

export default async function PatchesPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/patches`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=patch");
  const body = await response.json();
  const summary = body.summary || {};
  const devices = [...(body.devices || [])].sort(byUrgency);
  const rules = new Set(body.rules || []);
  const approvedCount = params?.approved != null ? Number(params.approved) || 0 : null;

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts={body.canMonitor} showPatches showDashboard={body.canReport} />
      <main className="main patches">
        <header className="patch-head">
          <div>
            <h1>Patches</h1>
            <p className="org-name">Updates across all computers. Open a computer to approve, push and restart.</p>
          </div>
          {body.canOperate ? (
            <form action={approveUrgentUpdates}>
              <button type="submit" className="patch-urgent" disabled={!summary.pushNow}>
                Approve all Push now updates{summary.pushNow ? ` (${summary.pushNow})` : ""}
              </button>
            </form>
          ) : null}
        </header>

        {params?.error === "approve" ? <p className="error">The updates could not be approved.</p> : null}
        {params?.error === "rules" ? <p className="error">The auto-approve rules could not be saved.</p> : null}
        {params?.saved === "rules" ? <p className="patch-done">Auto-approve rules saved.</p> : null}
        {approvedCount != null ? (
          <p className="patch-done">
            {approvedCount ? `${approvedCount} Push now update${approvedCount === 1 ? "" : "s"} approved. A technician can push them from each computer.` : "There were no Push now updates to approve."}
          </p>
        ) : null}

        <section className="dash-stats">
          <Stat tone="red" label="Push now" value={summary.pushNow || 0} note={`On ${plural(summary.pushNowDevices || 0, "computer")}`} icon={<ShieldIcon />} />
          <Stat tone="blue" label="Waiting for approval" value={summary.toApprove || 0} note={`${summary.behind || 0} of ${summary.devices || 0} computers have updates`} icon={<ClockIcon />} />
          <Stat tone="green" label="Approved, not pushed" value={summary.approved || 0} note={`${summary.installing || 0} installing now`} icon={<CheckIcon />} />
          <Stat tone="amber" label="Restart needed" value={summary.restart || 0} note="Computers waiting to restart" icon={<RestartIcon />} />
        </section>

        <section className="dash-card patch-card">
          <header>
            <h2>Computers</h2>
            <span>{plural(devices.length, "computer")}</span>
          </header>
          <div className="patch-table">
            <table>
              <thead>
                <tr>
                  <th>Computer</th>
                  <th>Customer</th>
                  <th>Updates</th>
                  <th>Push now</th>
                  <th>To approve</th>
                  <th>Approved</th>
                  <th>Installing</th>
                  <th>Restart</th>
                  <th>Last checked</th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? (
                  <tr><td className="empty" colSpan={9}>No computers yet.</td></tr>
                ) : devices.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <a className="patch-device" href={`/devices/${device.id}/diagnostics?tool=updates`}>
                        <i className={device.online ? "dash-dot on" : "dash-dot"} title={device.online ? "Online" : "Offline"} />
                        {device.hostname}
                        {device.isServer ? <small>Server</small> : null}
                      </a>
                    </td>
                    <td className="patch-customer">{device.customer || "—"}</td>
                    <td>{device.updates ? device.updates : <span className="patch-ok">Up to date</span>}</td>
                    <td>{device.pushNow ? <span className="patch-pill is-red">{device.pushNow}</span> : "—"}</td>
                    <td>{device.toApprove || "—"}</td>
                    <td>{device.approved ? <span className="patch-pill is-blue">{device.approved}</span> : "—"}</td>
                    <td>{device.installing || "—"}</td>
                    <td>{device.rebootPending ? <span className="patch-pill is-amber">Needed</span> : "—"}</td>
                    <td>{device.checkedAt ? ago(device.checkedAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dash-card patch-card">
          <header>
            <h2>Auto-approve</h2>
            <span>{rules.size ? `${rules.size} type${rules.size === 1 ? "" : "s"} on` : "Off"}</span>
          </header>
          <p className="patch-note">
            Updates of the types ticked here are approved as soon as a computer finds them. A technician still pushes them and chooses how to restart.
            {body.canOperate ? "" : " Only an admin can change these."}
          </p>
          <form action={savePatchRules} className="patch-rules">
            {(body.categories || []).map((category) => {
              const [label, note] = CATEGORY_LABELS[category] || [category, ""];
              return (
                <label key={category} className="patch-rule">
                  <input type="checkbox" name="category" value={category} defaultChecked={rules.has(category)} disabled={!body.canOperate} />
                  <span>
                    <strong>{label}</strong>
                    {note ? <small>{note}</small> : null}
                  </span>
                </label>
              );
            })}
            {body.canOperate ? <div className="patch-rules-save"><button type="submit">Save rules</button></div> : null}
          </form>
        </section>
      </main>
    </div>
  );
}

function byUrgency(a, b) {
  return b.pushNow - a.pushNow
    || Number(b.rebootPending) - Number(a.rebootPending)
    || b.updates - a.updates
    || a.hostname.localeCompare(b.hostname);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
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

function Svg({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function ShieldIcon() {
  return <Svg><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4M12 16h.01" /></Svg>;
}

function ClockIcon() {
  return <Svg><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Svg>;
}

function CheckIcon() {
  return <Svg><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Svg>;
}

function RestartIcon() {
  return <Svg><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></Svg>;
}
