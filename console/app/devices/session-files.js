"use client";

import { useEffect, useRef, useState } from "react";
import { deviceFiles } from "../actions";
import { FileManager } from "./files-panel";
import { fetchFile, sendFile, sizeLabel, UPLOAD_LIMIT } from "./transfer";

async function homeFolder(device) {
  if (device.linux) return device.user && device.user !== "root" ? `/home/${device.user}` : "/root";
  if (!device.user) return "";
  const result = await deviceFiles(device.id, "C:/Users");
  if (!result.ok || result.note) return "";
  const want = device.user.toLowerCase();
  const names = (result.entries || []).filter((entry) => entry.kind === "folder").map((entry) => entry.name);
  const found = names.find((name) => name.toLowerCase() === want) || names.find((name) => name.toLowerCase().startsWith(`${want}.`));
  return found ? `C:/Users/${found}` : "";
}

function places(device, home) {
  if (device.linux) {
    return [
      { label: "Root", path: "/" },
      { label: "Home", path: home },
      { label: "Temp", path: "/tmp" },
    ];
  }
  const list = [{ label: "This PC", path: "" }];
  if (home) {
    list.push(
      { label: "Desktop", path: `${home}/Desktop` },
      { label: "Documents", path: `${home}/Documents` },
      { label: "Downloads", path: `${home}/Downloads` },
    );
  }
  list.push({ label: "Public", path: "C:/Users/Public" });
  return list;
}

function landing(device, home) {
  if (device.linux) return [home, "/tmp"];
  return [home ? `${home}/Downloads` : "", home ? `${home}/Desktop` : "", "C:/Users/Public/Downloads", "C:/Windows/Temp"].filter(Boolean);
}

export function SessionFileManager({ device }) {
  const [home, setHome] = useState(device.linux ? "/root" : "");
  const list = places(device, home);
  const [place, setPlace] = useState(device.linux ? "/" : "");
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    let current = true;
    homeFolder(device).then((found) => {
      if (current) setHome(found);
    });
    return () => {
      current = false;
    };
  }, [device]);

  return (
    <div className={narrow ? "sf-page is-narrow" : "sf-page"}>
      <aside className="sf-side">
        <div className="sf-device" title={device.name}>
          <span className="sf-device-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
          </span>
          <span className="sf-device-text">
            <strong>{device.name}</strong>
            <small>{device.osName || "Unknown OS"}{device.user ? ` · ${device.user}` : ""}</small>
          </span>
        </div>
        <p className="sf-head">File Manager</p>
        <nav className="sf-places" aria-label="Locations">
          {list.map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.path || item.label}
              className={item.path === place ? "is-active" : ""}
              onClick={() => setPlace(item.path)}
            >
              <PlaceIcon label={item.label} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="sf-collapse" onClick={() => setNarrow((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={narrow ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} /></svg>
          <span>Collapse</span>
        </button>
      </aside>
      <main className="sf-main">
        <FileManager key={place} deviceId={device.id} startPath={place} />
      </main>
    </div>
  );
}

function PlaceIcon({ label }) {
  if (label === "This PC" || label === "Root") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="11" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>;
  }
  if (label === "Downloads") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
}

export function FileTransfer({ device }) {
  const [phase, setPhase] = useState("wait");
  const [problem, setProblem] = useState("");
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState([]);
  const [browsing, setBrowsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const picker = useRef(null);
  const queue = useRef(Promise.resolve());
  const counter = useRef(0);

  async function list(path) {
    const result = await deviceFiles(device.id, path);
    if (!result.ok || result.note) return null;
    return result.entries || [];
  }

  async function exists(path) {
    const parent = parentOf(path, device.linux);
    if (parent === null) return true;
    const name = path.replace(/\/$/, "").split("/").pop().toLowerCase();
    const siblings = await list(parent);
    return Boolean(siblings?.some((entry) => entry.kind !== "file" && entry.name.toLowerCase() === name));
  }

  async function connect() {
    setPhase("wait");
    setProblem("");
    const home = await homeFolder(device);
    for (const path of landing(device, home)) {
      if (!(await exists(path))) continue;
      const found = await list(path);
      if (found) {
        setFolder(path);
        setEntries(found);
        setPhase("ready");
        return;
      }
    }
    setProblem("The remote computer did not answer. Check that it is online and try again.");
    setPhase("error");
  }

  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(path) {
    setLoading(true);
    const found = await list(path);
    setLoading(false);
    if (!found) return;
    setFolder(path);
    setEntries(found);
  }

  function update(id, patch) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function enqueue(work) {
    queue.current = queue.current.then(work, work);
  }

  function send(files) {
    const target = folder;
    for (const file of files) {
      counter.current += 1;
      const id = counter.current;
      const tooBig = file.size > UPLOAD_LIMIT;
      setItems((current) => [...current, {
        id,
        way: "send",
        name: file.name,
        size: file.size,
        state: tooBig ? "failed" : "queued",
        status: tooBig ? "Larger than 8 GB" : "Waiting",
      }]);
      if (tooBig) continue;
      enqueue(async () => {
        update(id, { state: "busy", status: "0%" });
        const result = await sendFile(device.id, target, file, (status) => update(id, { status }));
        update(id, result.ok ? { state: "done", status: "Sent" } : { state: "failed", status: result.error });
        if (result.ok && target === folder) {
          const found = await list(target);
          if (found) setEntries(found);
        }
      });
    }
  }

  function receive(entry, source = folder) {
    counter.current += 1;
    const id = counter.current;
    const name = entry.kind === "folder" ? `${entry.name}.zip` : entry.name;
    setItems((current) => [...current, { id, way: "receive", name, size: entry.size, state: "queued", status: "Waiting" }]);
    enqueue(async () => {
      update(id, { state: "busy", status: "Preparing" });
      const result = await fetchFile(device.id, source, entry, (status) => update(id, { status }));
      update(id, result.ok ? { state: "done", status: "Received" } : { state: "failed", status: result.error });
    });
  }

  const receiveLatest = useRef(receive);
  receiveLatest.current = receive;
  const panel = useRef("");

  useEffect(() => {
    panel.current = crypto.randomUUID();
    if (typeof BroadcastChannel === "undefined") return undefined;
    const channel = new BroadcastChannel(transferChannel(device.id));
    channel.onmessage = (event) => {
      const message = event.data || {};
      if (message.type !== "receive" || message.to !== panel.current || !Array.isArray(message.items)) return;
      for (const item of message.items) {
        if (item?.entry?.name && typeof item.path === "string") receiveLatest.current(item.entry, item.path);
      }
      channel.postMessage({ type: "queued", nonce: message.nonce });
    };
    return () => channel.close();
  }, [device.id]);

  function receiveClicked() {
    const host = parentOrigin();
    if (!host) {
      setBrowsing((value) => !value);
      return;
    }
    window.parent.postMessage({ type: "df-receive", path: folder, to: panel.current }, host);
  }

  function dropped(event) {
    event.preventDefault();
    setOver(false);
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.size > 0 || file.type);
    if (files.length) send(files);
  }

  if (phase !== "ready") {
    return (
      <div className="wft-page wft-wait">
        {phase === "wait" ? <span className="wft-spin" aria-hidden="true" /> : null}
        <strong>{phase === "wait" ? "Please Wait" : "Connection failed"}</strong>
        <p>{phase === "wait" ? "We are establishing your remote connection for file transfer." : problem}</p>
        {phase === "error" ? <button type="button" className="wft-button" onClick={connect}>Try again</button> : null}
      </div>
    );
  }

  const parent = parentOf(folder, device.linux);
  const finished = items.some((item) => item.state === "done" || item.state === "failed");

  return (
    <div
      className={over ? "wft-page is-over" : "wft-page"}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setOver(false); }}
      onDrop={dropped}
    >
      <div className="wft-actions">
        <button type="button" className="wft-button" onClick={() => picker.current?.click()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V7M7 12l5-5 5 5M5 4h14" /></svg>
          Send Files
        </button>
        <button type="button" className={browsing ? "wft-button is-on" : "wft-button"} onClick={receiveClicked}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v12M7 12l5 5 5-5M5 20h14" /></svg>
          Receive Files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => { send(Array.from(event.target.files || [])); event.target.value = ""; }}
        />
      </div>
      <p className="wft-folder" title={folder}>Remote folder: <b>{folder || "This PC"}</b></p>

      {browsing ? (
        <div className="wft-browse">
          <div className="wft-browse-bar">
            <button type="button" disabled={parent === null || loading} onClick={() => open(parent)} aria-label="Up one folder">↑</button>
            <button type="button" disabled={loading} onClick={() => open(folder)} aria-label="Refresh">↻</button>
            <span>{loading ? "Loading…" : "Pick a file to receive"}</span>
          </div>
          <ul>
            {entries.length === 0 ? <li className="wft-empty">This folder is empty.</li> : null}
            {entries.map((entry) => (
              <li key={`${entry.kind}:${entry.name}`}>
                {entry.kind !== "file" ? (
                  <button type="button" className="wft-entry" onClick={() => open(joinPath(folder, entry.name, device.linux))}>
                    <span className="wft-kind is-folder" aria-hidden="true" />{entry.name}
                  </button>
                ) : (
                  <span className="wft-entry"><span className="wft-kind" aria-hidden="true" />{entry.name}</span>
                )}
                <small>{entry.size == null ? "" : sizeLabel(entry.size)}</small>
                {entry.kind === "drive" ? <span /> : <button type="button" className="wft-get" onClick={() => receive(entry)}>Receive</button>}
              </li>
            ))}
          </ul>
        </div>
      ) : items.length === 0 ? (
        <div className="wft-drop">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9M12 12v8M9 15l3-3 3 3" /></svg>
          <span>Drag and drop files here to send them to {device.name}</span>
        </div>
      ) : (
        <ul className="wft-list">
          {items.map((item) => (
            <li key={item.id} className={`is-${item.state}`}>
              <span className={item.way === "send" ? "wft-way is-send" : "wft-way"} aria-label={item.way === "send" ? "Sent" : "Received"} />
              <span className="wft-name" title={item.name}>{item.name}</span>
              <small>{item.size == null ? "" : sizeLabel(item.size)}</small>
              <span className="wft-status" title={item.status}>{item.status}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="wft-foot">
        <span>{items.length ? `${items.length} transfer${items.length === 1 ? "" : "s"}` : "Drop files anywhere in this window"}</span>
        <button
          type="button"
          disabled={!finished}
          onClick={() => setItems((current) => current.filter((item) => item.state === "queued" || item.state === "busy"))}
        >
          Clear All
        </button>
      </div>
    </div>
  );
}

function transferChannel(deviceId) {
  return `df-transfer-${deviceId}`;
}

function parentOrigin() {
  if (window.parent === window) return "";
  const ancestors = window.location.ancestorOrigins;
  if (ancestors && ancestors.length) return ancestors[0];
  try {
    return document.referrer ? new URL(document.referrer).origin : "";
  } catch {
    return "";
  }
}

function closePopup() {
  const host = parentOrigin();
  if (host) window.parent.postMessage({ type: "df-receive-close" }, host);
}

function whenLabel(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function ReceivePicker({ device, startPath, to }) {
  const [path, setPath] = useState(startPath);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    deviceFiles(device.id, path).then((result) => {
      if (!current) return;
      setLoading(false);
      if (!result.ok || result.note) {
        setEntries([]);
        setError(result.error || result.note);
        return;
      }
      setEntries(result.entries || []);
    });
    return () => {
      current = false;
    };
  }, [device.id, path, tick]);

  function visit(next) {
    setPath(next);
    setPicked([]);
    setQuery("");
  }

  function toggle(entry) {
    setPicked((current) => (current.some((item) => item.name === entry.name && item.kind === entry.kind)
      ? current.filter((item) => !(item.name === entry.name && item.kind === entry.kind))
      : [...current, { name: entry.name, kind: entry.kind, size: entry.size }]));
  }

  async function pull() {
    if (!picked.length) return;
    const items = picked.map((entry) => ({ path, entry }));
    const nonce = crypto.randomUUID();
    const queued = await new Promise((resolve) => {
      if (!to || typeof BroadcastChannel === "undefined") {
        resolve(false);
        return;
      }
      const channel = new BroadcastChannel(transferChannel(device.id));
      const timer = setTimeout(() => { channel.close(); resolve(false); }, 1500);
      channel.onmessage = (event) => {
        if (event.data?.type !== "queued" || event.data.nonce !== nonce) return;
        clearTimeout(timer);
        channel.close();
        resolve(true);
      };
      channel.postMessage({ type: "receive", items, nonce, to });
    });
    if (queued) {
      closePopup();
      return;
    }
    for (const [index, item] of items.entries()) {
      setBusy(`Receiving ${index + 1} of ${items.length}: ${item.entry.name}`);
      const result = await fetchFile(device.id, item.path, item.entry, (status) => setBusy(`${item.entry.name}: ${status}`));
      if (!result.ok) {
        setBusy("");
        setError(`${item.entry.name}: ${result.error}`);
        return;
      }
    }
    setBusy("");
    closePopup();
  }

  const needle = query.trim().toLowerCase();
  const rows = entries.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  const parent = parentOf(path, device.linux);
  const crumbs = path ? path.split("/").filter(Boolean) : [];
  const absolute = path.startsWith("/");

  return (
    <div className="rcv-page">
      <div className="rcv-bar">
        <button type="button" aria-label="Up one folder" disabled={parent === null || loading} onClick={() => visit(parent)}>↑</button>
        <button type="button" aria-label="Refresh" disabled={loading} onClick={() => setTick((value) => value + 1)}>↻</button>
        <nav className="rcv-crumbs" aria-label="Folder path">
          <button type="button" onClick={() => visit(device.linux ? "/" : "")}>{device.linux ? "/" : "This PC"}</button>
          {crumbs.map((part, index) => (
            <span key={`${index}:${part}`}>
              <i aria-hidden="true">›</i>
              <button type="button" onClick={() => visit(`${absolute ? "/" : ""}${crumbs.slice(0, index + 1).join("/")}`)}>{part}</button>
            </span>
          ))}
        </nav>
        <input value={query} placeholder="Search this folder" aria-label="Search this folder" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="rcv-table">
        <table>
          <thead>
            <tr>
              <th aria-label="Select" />
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Date Modified</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="rcv-empty">Reading from {device.name}…</td></tr> : null}
            {!loading && error ? <tr><td colSpan={5} className="rcv-empty is-error">{error}</td></tr> : null}
            {!loading && !error && rows.length === 0 ? <tr><td colSpan={5} className="rcv-empty">This folder is empty.</td></tr> : null}
            {!loading && rows.map((entry) => {
              const chosen = picked.some((item) => item.name === entry.name && item.kind === entry.kind);
              return (
                <tr key={`${entry.kind}:${entry.name}`} className={chosen ? "is-picked" : ""}>
                  <td>
                    {entry.kind === "drive" ? null : (
                      <input type="checkbox" checked={chosen} aria-label={`Select ${entry.name}`} onChange={() => toggle(entry)} />
                    )}
                  </td>
                  <td>
                    {entry.kind === "file" ? (
                      <span className="wft-entry" onClick={() => toggle(entry)}><span className="wft-kind" aria-hidden="true" />{entry.name}</span>
                    ) : (
                      <button type="button" className="wft-entry" onClick={() => visit(joinPath(path, entry.name, device.linux))}>
                        <span className="wft-kind is-folder" aria-hidden="true" />{entry.name}
                      </button>
                    )}
                  </td>
                  <td>{entry.kind === "drive" ? "Drive" : entry.kind === "folder" ? "Folder" : "File"}</td>
                  <td>{entry.size == null ? "--" : sizeLabel(entry.size)}</td>
                  <td>{whenLabel(entry.modified)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rcv-foot">
        <span>{busy || (picked.length ? `${picked.length} selected · folders arrive as .zip` : "Tick the files or folders to pull to this computer")}</span>
        <button type="button" className="rcv-cancel" onClick={closePopup}>Cancel</button>
        <button type="button" className="wft-button" disabled={!picked.length || Boolean(busy)} onClick={pull}>
          Receive{picked.length ? ` (${picked.length})` : ""}
        </button>
      </div>
    </div>
  );
}

function joinPath(base, name, linux) {
  if (!base) return name;
  if (linux && base === "/") return `/${name}`;
  return `${base.replace(/\/$/, "")}/${name}`;
}

function parentOf(path, linux) {
  if (!path || path === "/") return null;
  const trimmed = path.replace(/\/$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index < 0) return linux ? "/" : "";
  if (index === 0) return "/";
  return trimmed.slice(0, index);
}
