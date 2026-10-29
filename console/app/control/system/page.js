import { readFile } from "node:fs/promises";
import path from "node:path";
import { platformGet } from "../api";
import { formatDate } from "../catalog";

export const metadata = { title: "System · Digital Fingers RMM" };

const STATE = { current: ["Current", ""], outdated: ["Outdated", " is-near"], unknown: ["1.4 or older", " is-full"] };
const ACTION = {
  offer: "Offered by auto-update",
  request: "Update requested",
  bulk: "Bulk update",
  deny: "Update refused",
};

export default async function SystemPage() {
  const [data, changes] = await Promise.all([platformGet("/v1/platform/system"), changelog()]);
  const { releases, fleet, updates, services } = data;

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>System</h1>
          <p className="org-name">
            Agent releases, the fleet across every tenant, and service health. How to release and deploy:{" "}
            <code>docs/OPERATIONS.md</code> in the project.
          </p>
        </div>
      </header>

      <div className="admin-cards">
        <section className="admin-card">
          <h2>Windows agent</h2>
          {releases.windows ? (
            <dl className="sys-facts">
              <dt>Published</dt><dd><strong>{releases.windows.version}</strong> · {formatDate(releases.windows.publishedAt, true)}</dd>
              <dt>Hash</dt><dd><code title={releases.windows.sha256}>{releases.windows.sha256.slice(0, 12)}…</code></dd>
              <dt>Test channel</dt>
              <dd>{releases.windowsStaged ? `Staged ${formatDate(releases.windowsStaged.stagedAt, true)}` : "Nothing staged"}</dd>
            </dl>
          ) : <p className="org-name">No Windows build is published.</p>}
        </section>
        <section className="admin-card">
          <h2>Linux agent</h2>
          {releases.linux ? (
            <dl className="sys-facts">
              <dt>Published</dt><dd><strong>{releases.linux.version}</strong> · {formatDate(releases.linux.publishedAt, true)}</dd>
              <dt>Processors</dt><dd>{releases.linux.arches.join(", ") || "None"}</dd>
              <dt>Updates</dt><dd>From the console, through the remote desktop agent</dd>
            </dl>
          ) : <p className="org-name">No Linux build is published.</p>}
        </section>
        <section className="admin-card">
          <h2>Automatic updates</h2>
          <dl className="sys-facts">
            <dt>Windows auto-update</dt><dd>{updates.autoUpdate ? "On" : "Off"}</dd>
            <dt>Offers, last 24 hours</dt><dd>{updates.offersToday}{updates.lastOfferAt ? ` · last ${formatDate(updates.lastOfferAt, true)}` : ""}</dd>
            <dt>Waiting for check-in</dt><dd>{updates.waiting}</dd>
          </dl>
        </section>
        <section className="admin-card">
          <h2>Services</h2>
          <dl className="sys-facts">
            <dt>Database</dt><dd><Health ok={services.postgres} /></dd>
            <dt>Cache</dt><dd><Health ok={services.redis} /></dd>
            <dt>Locations</dt>
            <dd><Health ok={services.geoip.loaded} label={services.geoip.loaded ? "Loaded" : "Missing"} />{services.geoip.updatedAt ? ` · data from ${formatDate(services.geoip.updatedAt)}` : ""}</dd>
            <dt>API running since</dt><dd>{formatDate(services.apiStartedAt, true)} · Node {services.node}</dd>
          </dl>
        </section>
      </div>

      <section className="admin-card admin-wide">
        <div className="admin-card-head">
          <h2>Fleet agent versions</h2>
          <span className="org-name">{fleet.total} devices · {fleet.online} online now</span>
        </div>
        <div className="usage-table admin-table">
          <table>
            <thead>
              <tr><th>Platform</th><th>Release</th><th>Version</th><th>Devices</th><th>State</th></tr>
            </thead>
            <tbody>
              {fleet.platforms.length === 0 ? (
                <tr><td className="empty" colSpan={5}>No devices enrolled.</td></tr>
              ) : fleet.platforms.flatMap((platform) => platform.versions.map((item, index) => {
                const [label, level] = STATE[item.state];
                return (
                  <tr key={`${platform.platform}-${item.version}`}>
                    <td>{index === 0 ? <strong>{platform.label}</strong> : null}</td>
                    <td>{index === 0 ? (platform.release || "—") : null}</td>
                    <td>{item.version}</td>
                    <td>{item.count}</td>
                    <td><span className={`usage-state${level}`}>{label}</span></td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card admin-wide">
        <h2>Recent agent updates</h2>
        <div className="usage-table admin-table">
          <table>
            <thead>
              <tr><th>When</th><th>What</th><th>Tenant</th><th>Device</th><th>Version</th><th>By</th></tr>
            </thead>
            <tbody>
              {updates.recent.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No agent updates yet.</td></tr>
              ) : updates.recent.map((item, index) => (
                <tr key={`${item.at}-${index}`}>
                  <td>{formatDate(item.at, true)}</td>
                  <td>
                    {ACTION[item.action] || item.action}
                    {item.platform === "linux" ? " (Linux)" : item.legacy ? " (old agent)" : ""}
                    {item.error ? <span className="org-name"> · {item.error}</span> : null}
                  </td>
                  <td>{item.org || "—"}</td>
                  <td>{item.device || (item.count != null ? `${item.count} devices` : "—")}</td>
                  <td>{item.from ? `${item.from} → ${item.to}` : item.to || "—"}</td>
                  <td>{item.actor || "Automatic"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card admin-wide">
        <h2>Change log</h2>
        {changes.length === 0 ? (
          <p className="org-name">The change log is not on this server.</p>
        ) : changes.map((section) => (
          <div key={section.title} className="sys-log">
            <h3>{section.title}</h3>
            {section.blocks.map((block, index) => block.type === "heading"
              ? <p key={index} className="sys-log-head">{inline(block.text)}</p>
              : <ul key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>)}
          </div>
        ))}
      </section>
    </section>
  );
}

function Health({ ok, label }) {
  return <span className={`usage-state${ok ? "" : " is-full"}`}>{label || (ok ? "Working" : "Not answering")}</span>;
}

// The change log ships with the console as CHANGELOG.md; only the two newest dated sections are shown.
async function changelog() {
  for (const file of [path.join(process.cwd(), "CHANGELOG.md"), path.join(process.cwd(), "..", "docs", "CHANGELOG.md")]) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text) return parseChangelog(text).slice(0, 2);
  }
  return [];
}

function parseChangelog(text) {
  const sections = [];
  let section = null;
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      section = { title: line.slice(3).trim(), blocks: [] };
      sections.push(section);
      list = null;
    } else if (!section || !line.trim()) {
      list = null;
    } else if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      section.blocks.push({ type: "heading", text: line.trim() });
      list = null;
    } else if (line.startsWith("- ")) {
      if (!list) {
        list = { type: "list", items: [] };
        section.blocks.push(list);
      }
      list.items.push(line.slice(2));
    } else if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return sections;
}

function inline(text) {
  const parts = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}
