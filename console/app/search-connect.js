"use client";

import { useEffect, useRef, useState } from "react";
import { findDevices } from "./actions";
import { openRemoteSession } from "./devices/remote-window";

export function SearchConnect() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ devices: [], canRemote: false });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const root = useRef(null);
  const input = useRef(null);
  const asked = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    }
    function close(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", close);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const ticket = ++asked.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const found = await findDevices(query).catch(() => ({ devices: [], canRemote: false }));
      if (ticket !== asked.current) return;
      setResult({ devices: found.devices || [], canRemote: found.canRemote === true, q: query });
      setActive(0);
      setLoading(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  function canConnect(device) {
    return result.canRemote && device.presence === "online";
  }

  function connect(device) {
    if (!canConnect(device)) return;
    const opened = openRemoteSession({
      deviceId: device.id,
      hostname: device.hostname,
      label: device.displayName,
      user: device.users[0] || "",
    });
    if (!opened) {
      setNote("Allow pop-ups for this site to open the remote session.");
      return;
    }
    setNote("");
    setOpen(false);
    setQuery("");
    input.current?.blur();
  }

  function show(device) {
    window.location.href = `/devices?q=${encodeURIComponent(device.hostname)}`;
  }

  function onKeyDown(event) {
    const list = result.devices;
    if (event.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    } else if (event.key === "ArrowDown" && list.length) {
      event.preventDefault();
      setActive((index) => (index + 1) % list.length);
    } else if (event.key === "ArrowUp" && list.length) {
      event.preventDefault();
      setActive((index) => (index - 1 + list.length) % list.length);
    } else if (event.key === "Enter" && list[active]) {
      event.preventDefault();
      if (canConnect(list[active])) connect(list[active]);
      else show(list[active]);
    }
  }

  return (
    <div className="search-connect" ref={root}>
      <label className={open ? "sc-box open" : "sc-box"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={query}
          placeholder="Search and Connect"
          aria-label="Search and Connect"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setNote(""); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        <kbd>Ctrl K</kbd>
      </label>
      {open ? (
        <div className="sc-panel" role="listbox" aria-label="Devices">
          <p className="sc-head">{query.trim() ? "Devices" : "All devices"}</p>
          {!result.devices.length && (loading || result.q !== query) ? <p className="sc-empty">Searching…</p> : null}
          {!result.devices.length && !loading && result.q === query ? <p className="sc-empty">No devices match “{query.trim()}”.</p> : null}
          {result.devices.map((device, index) => {
            const online = device.presence === "online";
            return (
              <div
                key={device.id}
                role="option"
                aria-selected={index === active}
                className={index === active ? "sc-row on" : "sc-row"}
                onMouseEnter={() => setActive(index)}
              >
                <button type="button" className="sc-name" onClick={() => show(device)}>
                  <span className={`presence presence-${online ? "online" : device.presence === "rebooting" ? "rebooting" : "offline"}`} aria-hidden="true" />
                  <span>
                    <strong>{device.displayName || device.hostname}</strong>
                    <small>{[device.displayName && device.displayName !== device.hostname ? device.hostname : "", device.customerName].filter(Boolean).join(" · ") || (online ? "Online" : "Offline")}</small>
                  </span>
                </button>
                {result.canRemote ? (
                  <button type="button" className="sc-connect" disabled={!online} title={online ? `Connect to ${device.hostname}` : "This device is offline"} onClick={() => connect(device)}>
                    Connect
                  </button>
                ) : null}
              </div>
            );
          })}
          {note ? <p className="sc-note">{note}</p> : null}
          <p className="sc-foot">↑ ↓ to choose · Enter to connect · Esc to close</p>
        </div>
      ) : null}
    </div>
  );
}
