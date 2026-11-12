"use client";

import { useEffect, useState } from "react";
import { changeHostname, deviceDetails, deviceDiagnostics, deviceSoftware, renameDevice, restartPendingDevice, setDeviceProvince, setDeviceSite } from "../actions";
import { DiagnosticIcon, TileIcon } from "./diagnostic-icons";
import { DIAGNOSTIC_TOOLS, diagnosticTool } from "./diagnostic-tools";
import { DetailColumns } from "./details-window";
import { FileManager } from "./files-panel";
import { TerminalPanel } from "./terminal-panel";
import { RemoteActions } from "./remote-actions";
import { TaskManager } from "./tasks-panel";
import { ServiceList } from "./services-panel";
import { UpdatesPanel } from "./updates-panel";
import { TimelineView } from "../timeline/timeline-view";
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
    const load = selected.kind === "files" || selected.kind === "updates" || selected.kind === "timeline"
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
  if (selected.kind === "updates") return <UpdatesPanel deviceId={deviceId} />;
  if (selected.kind === "timeline") return <TimelineView scope="devices" id={deviceId} customerBase="/customers" />;
  if (selected.id === "tasks") return <TaskManager deviceId={deviceId} canRemote={canRemote} state={state} query={query} reloadKey={reloadKey} onReload={onReload} />;
  if (selected.id === "services") return <ServiceList deviceId={deviceId} canRemote={canRemote} state={state} query={query} onReload={onReload} />;
  if (selected.kind === "live") return <p className="diag-note">{LIVE[selected.id]}</p>;
  if (!state) return <p className="diag-note">Reading from MeshCentral…</p>;
  if (!state.ok) return <p className="error">{state.error}</p>;
  if (selected.kind === "details" && state.overview) {
    return (
      <>
        {state.note ? <p className="diag-note">{state.note}</p> : null}
        <Overview
          deviceId={deviceId}
          overview={state.overview}
          users={state.users || users || []}
          restart={state.restart || {}}
          onRename={(name) => setState({ ...state, displayName: name, overview: { ...state.overview, device: state.overview.device.map((row) => row.label === "Device Name" ? { ...row, value: name } : row) } })}
          onSite={(site) => setState({ ...state, siteOverride: site, overview: { ...state.overview, device: state.overview.device.map((row) => row.label === "Site / Branch" ? { ...row, value: site } : row) } })}
        />
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

const EDITABLE = {
  "Device Name": { label: "Device name", action: "Rename" },
  "Site / Branch": { label: "Site or branch", action: "Change", empty: "Not set", placeholder: "e.g. Durban branch" },
  Province: { label: "Province", action: "Change" },
};

function HostnameRow({ deviceId, row, users, access, busy, onBusy }) {
  const hostname = row.value;
  const [pending, setPending] = useState(row.restart || { pending: false, reasons: [], newName: "" });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  function startEdit() {
    setDraft(pending.newName || hostname);
    setEditing(true);
    setOpen(false);
    setError("");
    onBusy(true);
  }

  function stopEdit() {
    setEditing(false);
    setError("");
    onBusy(false);
  }

  async function saveName() {
    const name = draft.trim().toUpperCase();
    if (!name) {
      setError("Enter a computer name.");
      return;
    }
    setSending("name");
    setError("");
    const result = await changeHostname(String(deviceId), name);
    setSending("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const reasons = pending.reasons.filter((reason) => reason !== "New computer name");
    setPending({ pending: true, reasons: [...reasons, "New computer name"], newName: result.name });
    setSent("");
    stopEdit();
    setOpen(true);
  }

  async function send(mode) {
    setSending(mode);
    setError("");
    const result = await restartPendingDevice(String(deviceId), mode, access.isServer);
    setSending("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setSent(mode === "ask"
      ? `A restart request was shown on ${hostname}.`
      : result.warned
        ? `${hostname} restarts in 5 minutes. The logged-on user was warned.`
        : `${hostname} is restarting.`);
  }

  const reasons = pending.reasons.map((reason) => reason === "New computer name" && pending.newName ? `new computer name (${pending.newName})` : reason.toLowerCase());
  const who = users.length === 0
    ? "No one is logged on, so it restarts within a few seconds."
    : `${users.join(", ")} ${users.length === 1 ? "is" : "are"} logged on and will get a 5-minute warning to save their work.`;

  return (
    <div className="name-line host-line">
      <dt>{row.label}</dt>
      <dd>
        {editing ? (
          <input
            value={draft}
            aria-label="Computer name"
            placeholder="e.g. CLUB-MALMESBURY"
            maxLength={15}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => { if (event.key === "Enter") saveName(); }}
          />
        ) : (
          <span className="host-value">
            {hostname}
            {pending.pending ? (
              <button
                type="button"
                className={sent ? "restart-tag is-sent" : "restart-tag"}
                aria-expanded={open}
                onClick={() => { setOpen((value) => !value); setError(""); }}
              >
                {sent && !open ? "Restart sent" : "Reboot required"}
              </button>
            ) : null}
          </span>
        )}
      </dd>
      {access.canRename ? (
        <span className="rename-actions">
          {editing ? (
            <>
              <button type="button" onClick={stopEdit}>Cancel</button>
              <button type="button" onClick={saveName} disabled={sending === "name"}>{sending === "name" ? "Sending…" : "Save"}</button>
            </>
          ) : (
            <button type="button" disabled={busy || !access.online} title={access.online ? undefined : "This computer is offline."} onClick={startEdit}>Change</button>
          )}
        </span>
      ) : null}
      {editing ? (
        <p className="host-hint">
          Windows renames the computer when it restarts. Up to 15 letters, numbers or hyphens. Device Name (the RMM label) stays as it is.
          {error ? <span className="error"> {error}</span> : null}
        </p>
      ) : null}
      {open ? (
        <section className="restart-confirm" role="alertdialog" aria-label={`Restart ${hostname}`}>
          <strong>{hostname} is still running</strong>
          <p>It needs a restart to finish: {reasons.join(", ")}.</p>
          {!access.online ? (
            <p>This computer is offline. Restart it when it is back online.</p>
          ) : !access.canRestart ? (
            <p>An admin can restart this computer.</p>
          ) : (
            <>
              <p>Restart it now? {who} Any open remote session is closed.</p>
              {access.isServer ? <p className="restart-server">{hostname} is a server. Restarting it disconnects everyone who uses it.</p> : null}
            </>
          )}
          {error ? <p className="error">{error}</p> : null}
          <span className="restart-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            {access.online && access.canRestart ? (
              <>
                {users.length > 0 ? (
                  <button type="button" disabled={Boolean(sending)} onClick={() => send("ask")}>{sending === "ask" ? "Sending…" : "Ask user to restart"}</button>
                ) : null}
                <button type="button" className="restart-now" disabled={Boolean(sending)} onClick={() => send("auto")}>
                  {sending === "auto" ? "Sending…" : access.isServer ? "Restart server now" : "Restart now"}
                </button>
              </>
            ) : null}
          </span>
        </section>
      ) : null}
      {sent && !open ? <p className="restart-sent">{sent}</p> : null}
    </div>
  );
}

function Overview({ deviceId, overview, users, restart, onRename, onSite }) {
  const [editing, setEditing] = useState("");
  const [hostEditing, setHostEditing] = useState(false);
  const [province, setProvince] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = draft.trim();
    if (editing === "Device Name" && !value) {
      setError("Enter a device name.");
      return;
    }
    setSaving(true);
    setError("");
    const result = editing === "Device Name"
      ? await renameDevice(String(deviceId), value)
      : editing === "Province"
        ? await setDeviceProvince([deviceId], value)
        : await setDeviceSite([deviceId], value);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (editing === "Device Name") onRename(result.name);
    else if (editing === "Province") setProvince(result.province);
    else onSite(result.site);
    setEditing("");
  }

  function shown(row, edit) {
    if (row.label !== "Province") return row.value || edit?.empty || "";
    const value = province ?? row.value;
    if (value) return value;
    return row.detected ? `${row.detected} (from internet address)` : "Not set";
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
            {overview.device.map((row) => {
              const edit = EDITABLE[row.label];
              const open = editing === row.label;
              if (row.label === "Hostname") {
                return (
                  <HostnameRow
                    key={row.label}
                    deviceId={deviceId}
                    row={row}
                    users={users}
                    access={restart}
                    busy={Boolean(editing) || hostEditing}
                    onBusy={setHostEditing}
                  />
                );
              }
              return (
                <div key={row.label} className={edit ? "name-line" : undefined}>
                  <dt>{row.label}</dt>
                  <dd>
                    {open && row.options ? (
                      <select value={draft} aria-label={edit.label} onChange={(event) => setDraft(event.target.value)}>
                        <option value="">{row.detected ? `From IP (${row.detected})` : "Not set"}</option>
                        {row.options.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    ) : open ? (
                      <input
                        value={draft}
                        aria-label={edit.label}
                        placeholder={edit.placeholder}
                        maxLength={80}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") save(); }}
                      />
                    ) : shown(row, edit)}
                  </dd>
                  {edit ? (
                    <span className="rename-actions">
                      {open ? (
                        <>
                          <button type="button" onClick={() => { setEditing(""); setError(""); }}>Cancel</button>
                          <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                        </>
                      ) : (
                        <button type="button" disabled={Boolean(editing) || hostEditing} onClick={() => { setDraft((row.label === "Province" ? province ?? row.value : row.value) || ""); setEditing(row.label); setError(""); }}>{edit.action}</button>
                      )}
                    </span>
                  ) : null}
                </div>
              );
            })}
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
