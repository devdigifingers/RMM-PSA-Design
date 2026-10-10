"use client";

import { useState } from "react";
import { setDeviceService } from "../actions";

const COLUMNS = [
  { key: "name", label: "Display Name" },
  { key: "status", label: "Status" },
  { key: "start", label: "Startup Type" },
  { key: "pid", label: "PID" },
  { key: "description", label: "Description" },
  { key: "account", label: "Log On As" },
  { key: "location", label: "Location" },
];

const ACTIONS = [
  ["stop", "Stop", "canStop"],
  ["restart", "Restart", "canRestart"],
  ["pause", "Pause", "canPause"],
  ["resume", "Resume", "canResume"],
  ["start", "Start", "canStart"],
];

const START_TYPES = [
  ["auto", "Automatic"],
  ["manual", "Manual"],
  ["disabled", "Disable"],
];

export function ServiceList({ deviceId, canRemote, state, query, onReload }) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const rows = state?.rows || [];
  const shown = sortRows(filterRows(rows, query), sort);

  async function run(row, action, label) {
    const question = action === "auto" || action === "manual"
      ? `Set the startup type for ${row.name} to ${label} on this computer?`
      : action === "disabled"
        ? `Disable ${row.name} on this computer?`
        : `${label} ${row.name} on this computer?`;
    if (!window.confirm(question)) return;
    setPending(`${row.service}:${action}`);
    setError("");
    const result = await setDeviceService(String(deviceId), { name: row.service, action });
    setPending("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected("");
    onReload();
  }

  return (
    <div className="tasks">
      {!state ? <p className="diag-note">Reading from MeshCentral…</p> : null}
      {state && !state.ok ? <p className="error">{state.error}</p> : null}
      {state?.note ? <p className="diag-note">{state.note}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {state?.ok && !state.note ? (
        <>
          <p className="diag-total"><strong>Total:</strong> {rows.length} Services</p>
          <div className="diag-table">
            <table className="service-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="task-sort" onClick={() => setSort((current) => ({ key: column.key, dir: current.key === column.key && current.dir === "asc" ? "desc" : "asc" }))}>
                        {column.label}
                        {sort.key === column.key ? <span aria-hidden="true">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
                      </button>
                    </th>
                  ))}
                  <th className="service-menu-head" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td className="empty" colSpan={COLUMNS.length + 1}>{query.trim() ? "No rows match." : "No services are reported."}</td></tr>
                ) : shown.map((row) => (
                  <tr key={row.service} className={selected === row.service ? "is-selected" : ""} onClick={() => setSelected(row.service)}>
                    <td title={row.name}>{row.name}</td>
                    <td><span className={statusClass(row.status)}>{row.status}</span></td>
                    <td>{row.start}</td>
                    <td>{row.pid}</td>
                    <td className="service-clip" title={row.description}>{row.description}</td>
                    <td>{row.account}</td>
                    <td className="service-clip" title={row.location}>{row.location}</td>
                    <td className="service-menu-cell">
                      {canRemote && selected === row.service ? (
                        <div className="service-menu" role="menu" aria-label={`${row.name} actions`} onClick={(event) => event.stopPropagation()}>
                          {ACTIONS.map(([action, label, flag]) => (
                            <button key={action} type="button" role="menuitem" disabled={!row[flag] || pending === `${row.service}:${action}`} onClick={() => run(row, action, label)}>{label}</button>
                          ))}
                          <p>Start type</p>
                          {START_TYPES.map(([action, label]) => (
                            <button key={action} type="button" role="menuitem" disabled={!row.canConfigure || pending === `${row.service}:${action}`} onClick={() => run(row, action, label)}>{label}</button>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function statusClass(status) {
  if (status === "Running") return "service-state is-running";
  if (status === "Stopped") return "service-state is-stopped";
  return "service-state";
}

function filterRows(rows, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => COLUMNS.some((column) => String(row[column.key] || "").toLowerCase().includes(needle)));
}

function sortRows(rows, sort) {
  const sign = sort.dir === "desc" ? -1 : 1;
  const numeric = sort.key === "pid" ? "pidValue" : sort.key === "status" ? "statusValue" : "";
  return [...rows].sort((a, b) => {
    if (numeric) {
      const left = a[numeric];
      const right = b[numeric];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return (left - right) * sign;
    }
    return String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""), "en", { sensitivity: "base" }) * sign;
  });
}
