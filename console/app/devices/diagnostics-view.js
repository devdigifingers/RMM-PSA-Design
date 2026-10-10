"use client";

import { useEffect, useState } from "react";
import { deviceDetails, deviceDiagnostics, deviceSoftware, renameDevice } from "../actions";
import { DiagnosticIcon, TileIcon } from "./diagnostic-icons";
import { DIAGNOSTIC_TOOLS, diagnosticTool } from "./diagnostic-tools";
import { DetailColumns } from "./details-window";
import { FileManager } from "./files-panel";
import { TerminalPanel } from "./terminal-panel";
import { RemoteActions } from "./remote-actions";
import { TaskManager } from "./tasks-panel";
import { ServiceList } from "./services-panel";
import { OsMark } from "./os-mark";

const LIVE = {
  command: "Command Prompt stays on this page. A live session on this computer is the next step.",
  files: "File Manager stays on this page. A live session on this computer is the next step.",
  registry: "Registry Editor stays on this page. A live session on this computer is the next step.",
  devmgr: "Device Manager stays on this page. A live session on this computer is the next step.",
  scheduler: "Task Scheduler stays on this page. A live session on this computer is the next step.",
};

const HARDWARE = new Set(["hardware", "bios", "board", "memory", "storage"]);

export function DiagnosticsView({ deviceId, tool, hostname, osName, users, canRemote }) {
  const selected = diagnosticTool(tool);
  const [state, setState] = useState(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setQuery("");
    setState(null);
  }, [deviceId, selected.id]);

  useEffect(() => {
    let current = true;
    if (selected.id !== "tasks") setState(null);
    const load = selected.kind === "files"
      ? Promise.resolve({ ok: true, files: true })
      : selected.kind === "software"
      ? deviceSoftware(String(deviceId))
      : selected.kind === "details" || selected.kind === "hardware"
        ? deviceDetails(String(deviceId))
        : selected.kind === "list"
          ? deviceDiagnostics(String(deviceId), selected.id)
          : Promise.resolve({ ok: true, live: true });
    load.then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [deviceId, selected.id, selected.kind, reloadKey]);

  return (
    <div className={collapsed ? "diag-shell is-collapsed" : "diag-shell"}>
      <aside className="diag-nav">
        <p className="diag-nav-label">Diagnostic Tools</p>
        <nav aria-label="Diagnostic Tools">
          {DIAGNOSTIC_TOOLS.map((item) => (
            <a
              key={item.id}
              className={item.id === selected.id ? "diag-link active" : "diag-link"}
              href={`/devices/${deviceId}/diagnostics?tool=${item.id}`}
              aria-current={item.id === selected.id ? "page" : undefined}
              title={item.label}
            >
              <DiagnosticIcon name={item.id} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <button type="button" className="diag-collapse" onClick={() => setCollapsed((open) => !open)}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </aside>
      <div className="diag-main">
        <header className="diag-top">
          <h1><OsMark osName={osName} />{hostname}</h1>
          {canRemote ? <RemoteActions deviceId={deviceId} hostname={hostname} users={users || []} connectOnly /> : null}
        </header>
        <section className="diag-panel" aria-label={selected.label}>
          {selected.id === "overview" || selected.kind === "files" || selected.kind === "terminal" ? null : (
            <header className="diag-panel-head">
              <h2>
                <DiagnosticIcon name={selected.id} />
                {selected.label}
              </h2>
              {selected.id === "tasks" || selected.kind === "software" || selected.kind === "list" ? (
                <div className="task-tools">
                  <label className="search software-search">
                    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                      <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <input value={query} placeholder="Search" aria-label={`Search ${selected.label}`} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                  {selected.id === "tasks" || selected.id === "services" ? (
                    <button type="button" className="task-refresh" aria-label="Refresh" onClick={() => setReloadKey((value) => value + 1)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19.5 12a7.5 7.5 0 0 1-12.7 5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M16.2 4.2h3.4V7.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M7.8 19.8H4.4V16.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </header>
          )}
          <ToolBody deviceId={deviceId} osName={osName} users={users} canRemote={canRemote} selected={selected} state={state} setState={setState} query={query} reloadKey={reloadKey} onReload={() => setReloadKey((value) => value + 1)} />
        </section>
      </div>
    </div>
  );
}

function ToolBody({ deviceId, osName, users, canRemote, selected, state, setState, query, reloadKey, onReload }) {
  if (selected.kind === "terminal") return <TerminalPanel deviceId={deviceId} osName={osName} users={users} />;
  if (selected.kind === "files") return <FileManager deviceId={deviceId} />;
  if (selected.id === "tasks") return <TaskManager deviceId={deviceId} canRemote={canRemote} state={state} query={query} reloadKey={reloadKey} onReload={onReload} />;
  if (selected.id === "services") return <ServiceList deviceId={deviceId} canRemote={canRemote} state={state} query={query} onReload={onReload} />;
  if (selected.kind === "live") return <p className="diag-note">{LIVE[selected.id]}</p>;
  if (!state) return <p className="diag-note">Reading from MeshCentral…</p>;
  if (!state.ok) return <p className="error">{state.error}</p>;
  if (selected.kind === "details" && state.overview) {
    return (
      <>
        {state.note ? <p className="diag-note">{state.note}</p> : null}
        <Overview deviceId={deviceId} overview={state.overview} onRename={(name) => setState({ ...state, displayName: name, overview: { ...state.overview, device: state.overview.device.map((row) => row.label === "Device Name" ? { ...row, value: name } : row) } })} />
      </>
    );
  }
  if (state.note) return <p className="diag-note">{state.note}</p>;
  if (selected.kind === "details") return <DetailColumns left={state.left} right={state.right} />;
  if (selected.kind === "hardware") {
    const sections = [...(state.left || []), ...(state.right || [])].filter((section) => HARDWARE.has(section.key));
    return <DetailColumns left={sections} right={[]} />;
  }
  if (selected.kind === "software") return <SoftwareTable apps={state.apps || []} query={query} />;
  return <RowsTable columns={state.columns || []} rows={state.rows || []} query={query} />;
}

function Overview({ deviceId, overview, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const current = overview.device.find((row) => row.label === "Device Name")?.value || "";

  async function save() {
    const name = draft.trim();
    if (!name) {
      setError("Enter a device name.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await renameDevice(String(deviceId), name);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRename(result.name);
    setEditing(false);
  }

  return (
    <div className="overview">
      <div className="overview-tiles">
        {overview.tiles.map((tile) => (
          <article key={tile.label} className="overview-tile">
            <span className="tile-label">
              <TileIcon name={tile.label} />
              {tile.label}
            </span>
            <strong>{tile.value}</strong>
            {tile.detail ? <small>{tile.detail}</small> : null}
          </article>
        ))}
      </div>
      <div className="overview-specs">
        <article className="overview-card">
          <h3><TileIcon name="device" />Device Specifications</h3>
          <dl>
            {overview.device.map((row) => (
              <div key={row.label} className={row.label === "Device Name" ? "name-line" : undefined}>
                <dt>{row.label}</dt>
                <dd>
                  {row.label === "Device Name" && editing ? (
                    <input value={draft} aria-label="Device name" onChange={(event) => setDraft(event.target.value)} />
                  ) : row.value}
                </dd>
                {row.label === "Device Name" ? (
                  <span className="rename-actions">
                    {editing ? (
                      <>
                        <button type="button" onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
                        <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setDraft(current); setEditing(true); setError(""); }}>Rename</button>
                    )}
                  </span>
                ) : null}
              </div>
            ))}
          </dl>
          {error ? <p className="error">{error}</p> : null}
        </article>
        <article className="overview-card">
          <h3><TileIcon name="windows" />{overview.windowsTitle}</h3>
          <dl>
            {overview.windows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </article>
      </div>
    </div>
  );
}

function SoftwareTable({ apps, query }) {
  const needle = query.trim().toLowerCase();
  const rows = apps.filter((item) => !needle || `${item.name} ${item.vendor} ${item.version}`.toLowerCase().includes(needle));
  const columns = [
    { key: "name", label: "Name" },
    { key: "version", label: "Version" },
    { key: "vendor", label: "Vendor" },
    { key: "installed", label: "Installed Date" },
    { key: "location", label: "Installed Location" },
    { key: "size", label: "Size" },
  ];
  return (
    <>
      <p className="diag-total">Total: {apps.length} software</p>
      <RowsTable columns={columns} rows={rows.map((item) => ({ ...item, size: item.size || "—" }))} query="" empty="No installed software matches." />
    </>
  );
}

function RowsTable({ columns, rows, query, empty }) {
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => columns.some((column) => String(row[column.key] || "").toLowerCase().includes(needle)))
    : rows;
  return (
    <div className="diag-table">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr><td className="empty" colSpan={columns.length}>{empty || "No rows match."}</td></tr>
          ) : shown.map((row, index) => (
            <tr key={`${row.name || row.pid || index}-${index}`}>
              {columns.map((column) => <td key={column.key}>{row[column.key] || "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
