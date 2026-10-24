"use client";

import { useEffect, useRef, useState } from "react";
import { createDeviceFolder, deviceFiles } from "../actions";
import { fetchFile, sendFile, sizeLabel, UPLOAD_LIMIT } from "./transfer";

export function FileManager({ deviceId, startPath = "" }) {
  const [path, setPath] = useState(startPath);
  const [history, setHistory] = useState([startPath]);
  const [cursor, setCursor] = useState(0);
  const [entries, setEntries] = useState([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [making, setMaking] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);
  const [events, setEvents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [dock, setDock] = useState("jobs");
  const [dockOpen, setDockOpen] = useState(true);
  const [picked, setPicked] = useState(null);
  const picker = useRef(null);
  const ids = useRef(0);

  function nextId() {
    ids.current += 1;
    return ids.current;
  }

  function record(text) {
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date());
    setEvents((items) => [...items, { id: nextId(), time, text }]);
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    deviceFiles(String(deviceId), path).then((result) => {
      if (!current) return;
      setLoading(false);
      if (!result.ok) {
        setEntries([]);
        setError(result.error);
        return;
      }
      setNote(result.note || "");
      setEntries(result.entries || []);
    });
    return () => {
      current = false;
    };
  }, [deviceId, path, tick]);

  function visit(next) {
    const trimmed = history.slice(0, cursor + 1);
    trimmed.push(next);
    setHistory(trimmed);
    setCursor(trimmed.length - 1);
    setPath(next);
    setQuery("");
    setMaking(false);
    setPicked(null);
  }

  function jump(index) {
    setCursor(index);
    setPath(history[index]);
    setQuery("");
    setMaking(false);
    setPicked(null);
  }

  const needle = query.trim().toLowerCase();
  const rows = entries.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  const crumbs = crumbList(path);
  const inside = Boolean(path);

  async function createFolder() {
    const name = draft.trim();
    if (!name) {
      setError("Enter a folder name.");
      return;
    }
    setBusy("Creating…");
    setError("");
    const result = await createDeviceFolder(String(deviceId), path, name);
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      record(`Folder was not created: ${name}. ${result.error}`);
      return;
    }
    record(`Created folder ${name}`);
    setDraft("");
    setMaking(false);
    setTick((value) => value + 1);
  }

  function setJob(id, patch) {
    setJobs((items) => items.map((job) => job.id === id ? { ...job, ...patch } : job));
  }

  async function upload(file) {
    if (!file) return;
    if (file.size > UPLOAD_LIMIT) {
      setError("That file is larger than 8 GB.");
      return;
    }
    const id = nextId();
    setJobs((items) => [...items, { id, name: file.name, size: file.size, state: "uploading", status: "0%" }]);
    setDock("jobs");
    setDockOpen(true);
    record(`Upload started: ${file.name} (${sizeLabel(file.size)})`);
    setBusy("Uploading…");
    setError("");
    const result = await sendFile(deviceId, path, file, (status) => setJob(id, { status }));
    setBusy("");
    if (picker.current) picker.current.value = "";
    if (!result.ok) {
      setJob(id, { state: "failed", status: result.error });
      record(`Upload failed: ${file.name}. ${result.error}`);
      return;
    }
    setJob(id, { state: "complete", status: "Complete" });
    record(`Upload complete: ${file.name}`);
    setTick((value) => value + 1);
  }

  async function downloadPicked() {
    if (!picked) return;
    const id = nextId();
    const label = picked.kind === "folder" ? `${picked.name}.zip` : picked.name;
    setJobs((items) => [...items, { id, name: label, size: picked.size, state: "uploading", status: "Queued" }]);
    setDock("jobs");
    setDockOpen(true);
    record(`Download started: ${label}`);
    setBusy("Downloading…");
    setError("");
    const result = await fetchFile(deviceId, path, picked, (status) => setJob(id, { status }));
    setBusy("");
    if (!result.ok) {
      setJob(id, { state: "failed", status: result.error });
      record(`Download failed: ${label}. ${result.error}`);
      return;
    }
    setJob(id, { state: "complete", status: "Complete" });
    record(`Download complete: ${result.name}`);
  }

  return (
    <div className="files">
      <div className="files-body">
      <div className="files-bar">
        <div className="files-nav">
          <button type="button" aria-label="Back" disabled={cursor === 0} onClick={() => jump(cursor - 1)}>‹</button>
          <button type="button" aria-label="Forward" disabled={cursor >= history.length - 1} onClick={() => jump(cursor + 1)}>›</button>
          <button type="button" aria-label="Up" disabled={!path} onClick={() => visit(parentPath(path))}>↑</button>
          <button type="button" aria-label="Refresh" onClick={() => setTick((value) => value + 1)}>↻</button>
          <nav className="files-crumbs" aria-label="Folder path">
            {crumbs.length === 0 ? <span>This computer</span> : crumbs.map((crumb, index) => (
              <span key={crumb.path}>
                {index > 0 ? <span aria-hidden="true"> &gt; </span> : null}
                <button type="button" onClick={() => visit(crumb.path)}>{crumb.label}</button>
                {index === crumbs.length - 1 ? <span aria-hidden="true"> &gt; </span> : null}
              </span>
            ))}
          </nav>
        </div>
        <div className="files-tools">
          {searching ? (
            <input value={query} placeholder="Search" aria-label="Search files" autoFocus onChange={(event) => setQuery(event.target.value)} />
          ) : (
            <button type="button" className="files-icon" aria-label="Search" onClick={() => setSearching(true)}>
              <SearchGlyph />
            </button>
          )}
          <button type="button" className="files-text" aria-label="New Folder" disabled={!inside || Boolean(busy)} onClick={() => { setMaking(true); setDraft(""); setError(""); }}>
            <NewFolderGlyph /> New Folder
          </button>
          <button type="button" className="files-text" aria-label="Download" disabled={!picked || Boolean(busy)} onClick={downloadPicked}>{busy === "Downloading…" ? "Downloading…" : "Download"}</button>
          <button type="button" className="files-upload" disabled={!inside || Boolean(busy)} onClick={() => picker.current?.click()}>{busy === "Uploading…" ? "Uploading…" : "Upload"}</button>
          <input ref={picker} type="file" hidden onChange={(event) => upload(event.target.files?.[0])} />
        </div>
      </div>
      {making ? (
        <form className="files-create" onSubmit={(event) => { event.preventDefault(); createFolder(); }}>
          <input value={draft} aria-label="Folder name" placeholder="Folder name" onChange={(event) => setDraft(event.target.value)} />
          <button type="button" onClick={() => setMaking(false)}>Cancel</button>
          <button type="submit" disabled={busy === "Creating…"}>{busy === "Creating…" ? "Creating…" : "Create"}</button>
        </form>
      ) : null}
      <p className="files-total">Total: {rows.length} {rows.length === 1 ? "item" : "items"}</p>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="diag-note">{note}</p> : null}
      {loading ? <p className="diag-note">Reading from MeshCentral…</p> : (
        <div className="diag-table">
          <table className="files-table">
            <thead>
              <tr>
                <th className="file-pick"></th>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Date Modified</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="empty" colSpan={5}>{note ? "" : "This folder is empty."}</td></tr>
              ) : rows.map((entry) => {
                const chosen = picked && picked.name === entry.name && picked.kind === entry.kind;
                return (
                <tr key={`${entry.kind}:${entry.name}`} className={chosen ? "is-picked" : ""}>
                  <td className="file-pick">
                    {entry.kind === "drive" ? null : (
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.name}`}
                        checked={Boolean(chosen)}
                        disabled={Boolean(busy)}
                        onChange={() => setPicked(chosen ? null : { name: entry.name, kind: entry.kind, size: entry.size })}
                      />
                    )}
                  </td>
                  <td>
                    {entry.kind === "file" ? (
                      <span className="file-name"><FileGlyph />{entry.name}</span>
                    ) : (
                      <button type="button" className="file-open" onClick={() => visit(childPath(path, entry.name))}>
                        <FolderGlyph />{entry.name}
                      </button>
                    )}
                  </td>
                  <td>{entry.kind === "drive" ? "Drive" : entry.kind === "folder" ? "Folder" : "File"}</td>
                  <td>{entry.size == null ? "--" : sizeLabel(entry.size)}</td>
                  <td>{entry.modified ? dateLabel(entry.modified) : "--"}</td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
      </div>
      <section className={dockOpen ? "files-dock" : "files-dock is-collapsed"} aria-label="File activity">
        <div className="files-dock-bar">
          <button type="button" className={dock === "events" ? "is-active" : ""} onClick={() => { setDock("events"); setDockOpen(true); }}>Event Log</button>
          <button type="button" className={dock === "jobs" ? "is-active" : ""} onClick={() => { setDock("jobs"); setDockOpen(true); }}>Job Queue ({jobs.length})</button>
          <button type="button" className="files-dock-toggle" aria-label={dockOpen ? "Hide activity" : "Show activity"} onClick={() => setDockOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {dockOpen ? (
          <div className="files-dock-body">
            {dock === "jobs" ? (
              jobs.length === 0 ? <p className="files-dock-empty">No jobs in queue</p> : (
                <table>
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>{job.name}</td>
                        <td>{job.size == null ? "--" : sizeLabel(job.size)}</td>
                        <td className={`job-${job.state}`}>
                          {job.status}
                          {job.state === "uploading" && jobPercent(job.status) != null ? <progress value={jobPercent(job.status)} max="100" /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : events.length === 0 ? <p className="files-dock-empty">No events</p> : (
              <ul className="files-events">
                {events.map((event) => (
                  <li key={event.id}><time>{event.time}</time> {event.text}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function crumbList(path) {
  if (!path || path === "/") return path === "/" ? [{ label: "/", path: "/" }] : [];
  const absolute = path.startsWith("/");
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, index) => ({
    label,
    path: `${absolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`,
  }));
}

function parentPath(path) {
  if (!path || path === "/") return "";
  const slash = path.lastIndexOf("/");
  if (slash < 0) return "";
  if (slash === 0) return "/";
  return path.slice(0, slash);
}

function childPath(path, name) {
  if (!path) return name;
  if (path === "/") return `/${name}`;
  return `${path}/${name}`;
}

function jobPercent(status) {
  const match = /(\d+)%/.exec(status || "");
  return match ? Number(match[1]) : null;
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(",", ",");
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NewFolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.2A1.5 1.5 0 0 1 4.5 5.7h4.1l1.5 1.7H19.5A1.5 1.5 0 0 1 21 8.9v8.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5M9.5 13.5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l1.6 1.8H19.5A1.5 1.5 0 0 1 21 9.3v8.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f5b04a" stroke="#d0892a" strokeWidth="1.2" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7z" fill="#eef3f8" stroke="#8aa0b5" strokeWidth="1.2" />
      <path d="M14 3.5V8h4.2" fill="none" stroke="#8aa0b5" strokeWidth="1.2" />
    </svg>
  );
}
