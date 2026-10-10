"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deviceSoftware } from "../actions";

export function SoftwareWindow({ deviceId, hostname, open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState(null);
  const [query, setQuery] = useState("");
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setQuery("");
    setState(null);
    let cancel = false;
    deviceSoftware(String(deviceId)).then((result) => {
      if (!cancel) setState(result);
    });
    function onKey(event) {
      if (event.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancel = true;
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, deviceId]);

  const apps = state?.ok ? state.apps || [] : [];
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter((app) => `${app.name} ${app.vendor} ${app.version}`.toLowerCase().includes(needle));
  }, [apps, query]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="details-backdrop" onMouseDown={onClose}>
      <section
        className="details-window software-window"
        role="dialog"
        aria-modal="true"
        aria-label="Software"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="details-titlebar">
          <h2>Software</h2>
          <button type="button" className="details-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="software-head">
          <div>
            <p className="details-name">{state?.ok ? state.hostname : hostname}</p>
            <p className="software-total">
              {state?.ok ? `Total: ${state.total} software` : "Reading installed software from MeshCentral…"}
            </p>
          </div>
          <label className="search software-search">
            <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input value={query} placeholder="Search" aria-label="Search software" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {state && !state.ok ? <p className="error">{state.error}</p> : null}
        {state?.ok && state.note ? <p className="details-note">{state.note}</p> : null}
        {state?.ok && !state.note ? (
          <div className="software-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Vendor</th>
                  <th>Installed Date</th>
                  <th>Installed Location</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={6}>No installed software matches.</td>
                  </tr>
                ) : shown.map((app) => (
                  <tr key={`${app.name}-${app.version}-${app.location}`}>
                    <td>{app.name}</td>
                    <td>{app.version || "—"}</td>
                    <td>{app.vendor || "—"}</td>
                    <td>{app.installed || "—"}</td>
                    <td>{app.location || "—"}</td>
                    <td>{app.size || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
