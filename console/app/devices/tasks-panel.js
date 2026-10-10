"use client";

import { useEffect, useState } from "react";
import { deviceDiagnostics, endDeviceProcess, setDeviceStartup } from "../actions";

const PROCESS_COLUMNS = [
  { key: "name", label: "Process Name" },
  { key: "pid", label: "PID" },
  { key: "status", label: "Status" },
  { key: "user", label: "User Name" },
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "Memory" },
];

const STARTUP_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "type", label: "Startup Type" },
  { key: "location", label: "Location" },
  { key: "user", label: "User" },
  { key: "status", label: "Status" },
];

export function TaskManager({ deviceId, canRemote, state, query, reloadKey, onReload }) {
  const [tab, setTab] = useState("process");
  const [startup, setStartup] = useState(null);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState("");
  const [ending, setEnding] = useState("");
  const [endError, setEndError] = useState("");
  const [pending, setPending] = useState("");

  useEffect(() => {
    if (tab !== "startup") return undefined;
    let current = true;
    setStartup(null);
    deviceDiagnostics(String(deviceId), "startup").then((result) => {
      if (current) setStartup(result);
    });
    return () => {
      current = false;
    };
  }, [deviceId, tab, reloadKey]);

  const processRows = state?.rows || [];
  const startupRows = startup?.rows || [];
  const rows = tab === "startup" ? startupRows : processRows;
  const columns = tab === "startup" ? STARTUP_COLUMNS : PROCESS_COLUMNS;
  const shown = sortRows(filterRows(rows, columns, query), sort);

  async function end(row) {
    if (!window.confirm(`End ${row.name} (PID ${row.pid}) on this computer?`)) return;
    setEnding(row.pid);
    setEndError("");
    const result = await endDeviceProcess(String(deviceId), row.pid);
    setEnding("");
    if (!result.ok) {
      setEndError(result.error);
      return;
    }
    setSelected("");
    onReload();
  }

  async function toggleStartup(row) {
    const key = `${row.name}|${row.locationRaw}`;
    setPending(key);
    setEndError("");
    const result = await setDeviceStartup(String(deviceId), {
      name: row.name,
      location: row.locationRaw,
      enabled: !row.enabled,
    });
    if (!result.ok) {
      setPending("");
      setEndError(result.error);
      return;
    }
    const next = await deviceDiagnostics(String(deviceId), "startup");
    setPending("");
    if (next.ok) setStartup(next);
    else setEndError(next.error);
  }

  return (
    <div className="tasks">
      <div className="task-tabs" role="tablist" aria-label="Task Manager">
        <button type="button" role="tab" aria-selected={tab === "process"} className={tab === "process" ? "is-active" : ""} onClick={() => setTab("process")}>Process</button>
        <button type="button" role="tab" aria-selected={tab === "startup"} className={tab === "startup" ? "is-active" : ""} onClick={() => setTab("startup")}>Startup Apps</button>
      </div>
      {tab === "process" && !state ? <p className="diag-note">Reading from MeshCentral…</p> : null}
      {tab === "process" && state && !state.ok ? <p className="error">{state.error}</p> : null}
      {tab === "process" && state?.note ? <p className="diag-note">{state.note}</p> : null}
      {tab === "startup" && !startup ? <p className="diag-note">Reading from MeshCentral…</p> : null}
      {tab === "startup" && startup && !startup.ok ? <p className="error">{startup.error}</p> : null}
      {tab === "startup" && startup?.note ? <p className="diag-note">{startup.note}</p> : null}
      {tab === "startup" && startup?.warning ? <p className="diag-note">{startup.warning}</p> : null}
      {endError ? <p className="error">{endError}</p> : null}
      {(tab === "process" && state?.ok && !state.note) || (tab === "startup" && startup?.ok && !startup.note) ? (
        <>
          <p className="diag-total"><strong>Total:</strong> {rows.length} {tab === "startup" ? "Apps" : "Processes"}</p>
          <div className="diag-table">
            <table className="task-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="task-sort" onClick={() => setSort((current) => ({ key: column.key, dir: current.key === column.key && current.dir === "asc" ? "desc" : "asc" }))}>
                        {column.label}
                        {sort.key === column.key ? <span aria-hidden="true">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
                      </button>
                    </th>
                  ))}
                  {tab === "process" ? <th className="task-end-head" /> : null}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td className="empty" colSpan={columns.length + (tab === "process" ? 1 : 0)}>{query.trim() ? "No rows match." : tab === "startup" ? "No startup apps are reported." : "No processes are reported."}</td></tr>
                ) : shown.map((row) => (
                  <tr
                    key={tab === "process" ? row.pid : `${row.name}-${row.location}`}
                    className={tab === "process" && selected === row.pid ? "is-selected" : ""}
                    onClick={tab === "process" ? () => setSelected(row.pid) : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={column.key === "location" ? "task-location" : column.key === "status" && tab === "startup" ? "task-status" : ""} title={column.key === "name" ? row.command || row.name : column.key === "location" ? row.location : undefined}>
                        {column.key === "status" && tab === "startup" ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(row.enabled)}
                            aria-label={`${row.enabled ? "Turn off" : "Turn on"} ${row.name}`}
                            className={row.enabled ? "task-switch is-on" : "task-switch"}
                            disabled={!canRemote || !row.canToggle || pending === `${row.name}|${row.locationRaw}`}
                            title={row.canToggle ? (row.enabled ? "On" : "Off") : "This startup item cannot be switched from here."}
                            onClick={() => toggleStartup(row)}
                          />
                        ) : (row[column.key] || "—")}
                      </td>
                    ))}
                    {tab === "process" ? (
                      <td className="task-end">
                        {canRemote && row.endable && selected === row.pid ? (
                          <button type="button" className="task-end-btn" disabled={ending === row.pid} onClick={(event) => { event.stopPropagation(); end(row); }}>
                            <span aria-hidden="true">×</span>
                            {ending === row.pid ? "Ending…" : "End Process"}
                          </button>
                        ) : null}
                      </td>
                    ) : null}
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

function filterRows(rows, columns, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => columns.some((column) => String(row[column.key] || "").toLowerCase().includes(needle)));
}

function sortRows(rows, sort) {
  const sign = sort.dir === "desc" ? -1 : 1;
  const numeric = sort.key === "pid" ? "pidValue" : sort.key === "cpu" ? "cpuValue" : sort.key === "memory" ? "memValue" : sort.key === "status" ? "enabledValue" : "";
  return [...rows].sort((a, b) => {
    if (numeric === "enabledValue" && a.enabledValue == null && b.enabledValue == null) {
      return String(a.status || "").localeCompare(String(b.status || ""), "en", { sensitivity: "base" }) * sign;
    }
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
