"use client";

import { useCallback, useEffect, useState } from "react";
import { deviceUpdateAction, deviceUpdates } from "../actions";
import { sizeLabel } from "./transfer";

const GROUPS = [
  ["Security", "Security updates"],
  ["Critical", "Critical updates"],
  ["Rollup", "Update rollups"],
  ["Definition", "Definition updates"],
  ["Driver", "Drivers"],
  ["Feature", "Feature packs"],
  ["Service pack", "Service packs"],
  ["Upgrade", "Upgrades"],
  ["Tool", "Tools"],
  ["Update", "Other updates"],
];

const SEVERITY_RANK = { Critical: 0, Important: 1, Moderate: 2, Low: 3 };

const RESTART_CHOICES = [
  ["later", "Decide later"],
  ["ask", "Ask the user to restart"],
  ["auto", "Restart when finished"],
];

const BUSY = new Set(["queued", "running"]);

export function UpdatesPanel({ deviceId }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [restartMode, setRestartMode] = useState("later");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await deviceUpdates(String(deviceId));
    setData(result);
    if (result.ok) {
      const names = new Set(result.updates.map((item) => item.name));
      setSelected((current) => new Set([...current].filter((name) => names.has(name))));
    }
  }, [deviceId]);

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    load();
  }, [load]);

  const busy = Boolean(data?.ok) && (data.scanning || data.updates.some((item) => BUSY.has(item.status)));
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [busy, load]);

  if (!data) return <p className="diag-note">Reading updates…</p>;
  if (!data.ok) return <p className="error">{data.error}</p>;

  const updates = data.updates;
  const urgent = updates.filter((item) => item.pushNow);
  const groups = [
    ["now", "Push now", urgent],
    ...GROUPS.map(([key, label]) => [key, label, updates.filter((item) => !item.pushNow && groupKey(item) === key)]),
  ].filter(([, , items]) => items.length > 0);
  const picked = updates.filter((item) => selected.has(item.name));
  const toApprove = data.canApprove ? picked.filter(canApprove) : [];
  const toPush = picked.filter((item) => item.status === "approved");

  function toggle(names, on) {
    setSelected((current) => {
      const next = new Set(current);
      for (const name of names) {
        if (on) next.add(name);
        else next.delete(name);
      }
      return next;
    });
  }

  async function run(action, input, done) {
    setPending(action);
    setError("");
    setMessage("");
    let result = await deviceUpdateAction(String(deviceId), action, input);
    if (!result.ok && result.needsConfirm && window.confirm(serverQuestion(data.hostname))) {
      result = await deviceUpdateAction(String(deviceId), action, { ...input, confirmServer: true });
    }
    setPending("");
    if (!result.ok) {
      if (!result.needsConfirm) setError(result.error);
      return;
    }
    setMessage(done(result));
    load();
  }

  function scan() {
    run("scan", {}, () => "Checking for updates. The list refreshes when the computer reports back.");
  }

  function approve(items) {
    run("approve", { names: items.map((item) => item.name) }, (result) => `${plural(result.approved, "update")} approved.`);
  }

  function push(items) {
    const names = items.map((item) => item.name);
    const serverAuto = data.isServer && restartMode === "auto";
    if (serverAuto && !window.confirm(serverQuestion(data.hostname))) return;
    run("push", { names, restartMode, confirmServer: serverAuto }, (result) => {
      setSelected((current) => new Set([...current].filter((name) => !names.includes(name))));
      return `${plural(result.pushed, "update")} sent to ${data.hostname}. ${restartNote(restartMode, data.usersLoggedOn)}`;
    });
  }

  function restart(mode) {
    if (mode === "auto") {
      const question = data.usersLoggedOn > 0
        ? `Restart ${data.hostname}? The logged-in user gets a 5-minute warning to save their work.`
        : `Restart ${data.hostname} now? No one is logged in, so it restarts within a few seconds.`;
      if (!window.confirm(question)) return;
      if (data.isServer && !window.confirm(serverQuestion(data.hostname))) return;
    }
    run("restart", { mode, confirmServer: mode === "auto" && data.isServer }, () => mode === "ask"
      ? `A restart request was shown on ${data.hostname}.`
      : data.usersLoggedOn > 0
        ? `${data.hostname} restarts in 5 minutes. The user was warned.`
        : `${data.hostname} is restarting.`);
  }

  return (
    <div className="upd">
      <div className="upd-bar">
        <p className="upd-status">
          {data.scanning ? <span className="upd-spin" aria-hidden="true" /> : null}
          {data.scanning
            ? "Checking for updates…"
            : data.checkedAt
              ? `Last checked ${ago(data.checkedAt)}`
              : "Not checked yet"}
          {data.checkedAt && !data.scanning ? <span> · {plural(updates.length, "update")} available{urgent.length ? ` · ${urgent.length} to push now` : ""}</span> : null}
        </p>
        <button type="button" className="upd-scan" onClick={scan} disabled={pending !== "" || data.scanning}>
          {data.scanning ? "Checking…" : "Get updates"}
        </button>
      </div>

      {!data.online ? <p className="diag-note">This computer is offline. It checks for updates and installs pushed updates when it comes back online.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="upd-message">{message}</p> : null}

      {data.rebootPending ? (
        <div className="upd-restart" role="status">
          <div>
            <strong>Restart needed</strong>
            <p>Updates are installed, but {data.hostname} needs a restart to finish them.</p>
          </div>
          <div className="upd-restart-actions">
            <button type="button" className="upd-ghost" onClick={() => restart("ask")} disabled={pending !== "" || !data.online}>Ask user to restart</button>
            <button type="button" className="upd-danger" onClick={() => restart("auto")} disabled={pending !== "" || !data.online}>Restart now</button>
          </div>
        </div>
      ) : null}

      {updates.length > 0 ? (
        <div className="upd-actions">
          <span className="upd-picked">{picked.length ? `${picked.length} selected` : "Select updates"}</span>
          <label className="upd-mode">
            After installing
            <select value={restartMode} onChange={(event) => setRestartMode(event.target.value)}>
              {RESTART_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {data.canApprove ? (
            <button type="button" className="upd-ghost" onClick={() => approve(toApprove)} disabled={pending !== "" || toApprove.length === 0}>
              Approve{toApprove.length ? ` (${toApprove.length})` : ""}
            </button>
          ) : null}
          <button type="button" className="upd-primary" onClick={() => push(toPush)} disabled={pending !== "" || toPush.length === 0}>
            Push{toPush.length ? ` (${toPush.length})` : ""}
          </button>
        </div>
      ) : null}
      {!data.canApprove && updates.length > 0 ? <p className="diag-note">An admin approves updates. You can push updates once they are approved.</p> : null}

      {data.checkedAt && updates.length === 0 && !data.scanning ? <p className="upd-clear">This computer is up to date.</p> : null}

      {groups.map(([key, label, items]) => {
        const names = items.map((item) => item.name);
        const all = names.every((name) => selected.has(name));
        return (
          <section key={key} className={key === "now" ? "upd-group is-now" : "upd-group"}>
            <h3>
              <label>
                <input type="checkbox" checked={all} onChange={(event) => toggle(names, event.target.checked)} aria-label={`Select all ${label}`} />
                {label}
              </label>
              <span className="upd-count">{items.length}</span>
              {key === "now" ? <small>Critical security fixes. Install these first.</small> : null}
            </h3>
            <div className="diag-table">
              <table className="upd-table">
                <thead>
                  <tr>
                    <th className="upd-check" />
                    <th>Update</th>
                    <th>Severity</th>
                    <th>Size</th>
                    <th>Restart</th>
                    <th>Status</th>
                    <th className="upd-row-action" />
                  </tr>
                </thead>
                <tbody>
                  {sortItems(items).map((item) => (
                    <tr key={item.name} className={selected.has(item.name) ? "is-selected" : ""}>
                      <td className="upd-check">
                        <input type="checkbox" checked={selected.has(item.name)} onChange={(event) => toggle([item.name], event.target.checked)} aria-label={`Select ${item.name}`} />
                      </td>
                      <td className="upd-name" title={item.name}>
                        {item.name}
                        {item.kb ? <small>{item.kb}</small> : null}
                      </td>
                      <td>{item.severity ? <span className={`upd-sev is-${item.severity.toLowerCase()}`}>{item.severity}</span> : "—"}</td>
                      <td>{item.sizeBytes ? sizeLabel(item.sizeBytes) : "—"}</td>
                      <td>{item.restart ? "May need restart" : "—"}</td>
                      <td><span className={statusClass(item)} title={item.detail || undefined}>{statusLabel(item)}</span></td>
                      <td className="upd-row-action">
                        {item.status === "approved" ? (
                          <button type="button" className="upd-primary" onClick={() => push([item])} disabled={pending !== ""}>Push</button>
                        ) : data.canApprove && canApprove(item) ? (
                          <button type="button" className="upd-ghost" onClick={() => approve([item])} disabled={pending !== ""}>Approve</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {data.history.length > 0 ? (
        <section className="upd-group">
          <h3>Recently installed</h3>
          <div className="diag-table">
            <table className="upd-table">
              <thead>
                <tr>
                  <th>Update</th>
                  <th>Type</th>
                  <th>Result</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((item) => (
                  <tr key={`${item.name}-${item.finishedAt}`}>
                    <td className="upd-name" title={item.name}>
                      {item.name}
                      {item.kb ? <small>{item.kb}</small> : null}
                    </td>
                    <td>{item.category}</td>
                    <td><span className={statusClass(item)} title={item.detail || undefined}>{statusLabel(item)}</span></td>
                    <td>{item.finishedAt ? ago(item.finishedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function groupKey(item) {
  return GROUPS.some(([key]) => key === item.category) ? item.category : "Update";
}

function sortItems(items) {
  return [...items].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.name.localeCompare(b.name));
}

function canApprove(item) {
  return ["available", "waiting", "failed", "succeeded"].includes(item.status);
}

function statusLabel(item) {
  if (item.status === "succeeded") return item.restartRequired ? "Installed, restart needed" : "Installed";
  return {
    available: "Available",
    waiting: "Waiting for approval",
    approved: "Approved",
    queued: "Queued",
    running: "Installing",
    failed: "Failed",
  }[item.status] || item.status;
}

function statusClass(item) {
  if (item.status === "succeeded") return item.restartRequired ? "upd-state is-restart" : "upd-state is-done";
  if (item.status === "failed") return "upd-state is-failed";
  if (BUSY.has(item.status)) return "upd-state is-busy";
  if (item.status === "approved") return "upd-state is-approved";
  return "upd-state";
}

function restartNote(mode, users) {
  if (mode === "auto") return users > 0 ? "It restarts after installing, with a 5-minute warning for the user." : "It restarts after installing.";
  if (mode === "ask") return "The user is asked to restart after installing.";
  return "You can choose to restart once they are installed.";
}

function serverQuestion(hostname) {
  return `${hostname} is a server. Restarting it disconnects everyone who uses it. Restart it anyway?`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ago(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}
