"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { deviceDetails } from "../actions";
import { openRemoteSession } from "./remote-window";

export function DeviceDetails({ deviceId, hostname, canRemote, users }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function show() {
    setOpen(true);
    setState(null);
    setState(await deviceDetails(String(deviceId)));
  }

  function connect() {
    const chosen = (state?.users || users || [])[0] || "";
    openRemoteSession({ deviceId, hostname, user: chosen });
  }

  const remote = state?.ok ? state.canRemote : canRemote;
  const title = state?.ok ? state.hostname : hostname;

  return (
    <>
      <button type="button" className="hostname-link" onClick={show}>
        {hostname}
      </button>
      {open && mounted
        ? createPortal(
            <div className="details-backdrop" onMouseDown={() => setOpen(false)}>
              <section
                className="details-window"
                role="dialog"
                aria-modal="true"
                aria-label="Device Details"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="details-titlebar">
                  <h2>Device Details</h2>
                  <button type="button" className="details-close" aria-label="Close" onClick={() => setOpen(false)}>
                    ×
                  </button>
                </header>
                <div className="details-head">
                  <div className="details-identity">
                    <SectionIcon name="device" />
                    <div>
                      <p className="details-name">{title}</p>
                      {!state ? (
                        <p className="details-presence">Reading MeshCentral…</p>
                      ) : state.ok ? (
                        <p className={`details-presence details-${state.presence}`}>
                          <span className={`presence presence-${state.presence}`} />
                          {state.presenceLabel}
                        </p>
                      ) : (
                        <p className="details-presence">Details unavailable</p>
                      )}
                    </div>
                  </div>
                  {remote ? (
                    <button type="button" className="details-connect" onClick={connect}>
                      Connect
                    </button>
                  ) : null}
                </div>
                {state && !state.ok ? <p className="error">{state.error}</p> : null}
                {state?.ok && state.note ? <p className="details-note">{state.note}</p> : null}
                {state?.ok ? (
                  <div className="details-columns">
                    <div>{state.left.map((section) => <DetailCard key={section.key} section={section} />)}</div>
                    <div>{state.right.map((section) => <DetailCard key={section.key} section={section} />)}</div>
                  </div>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function DetailColumns({ left, right }) {
  return (
    <div className="details-columns">
      <div>{(left || []).map((section) => <DetailCard key={section.key} section={section} />)}</div>
      <div>{(right || []).map((section) => <DetailCard key={section.key} section={section} />)}</div>
    </div>
  );
}

function DetailCard({ section }) {
  return (
    <article className="detail-card">
      <h3>
        <SectionIcon name={section.icon} />
        <span>{section.title}</span>
      </h3>
      <dl>
        {section.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {section.adapters?.map((adapter) => <AdapterFold key={adapter.name} adapter={adapter} />)}
    </article>
  );
}

function AdapterFold({ adapter }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="adapter-fold">
      <button type="button" className="adapter-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{adapter.name}</span>
        <span className={open ? "adapter-arrow open" : "adapter-arrow"} aria-hidden="true" />
      </button>
      {open ? (
        <dl>
          {adapter.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function SectionIcon({ name }) {
  return (
    <span className={`detail-icon detail-icon-${name}`} aria-hidden="true">
      {name === "os" ? <Disk /> : null}
      {name === "agent" ? <Tower /> : null}
      {name === "network" ? <Wifi /> : null}
      {name === "bios" ? <Chip /> : null}
      {name === "board" ? <Board /> : null}
      {name === "device" ? <Monitor /> : null}
      {name === "hardware" ? <Processor /> : null}
      {name === "groups" ? <People /> : null}
      {name === "memory" ? <MemoryStick /> : null}
      {name === "storage" ? <Disk /> : null}
    </span>
  );
}

function Monitor() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="4" y="5" width="24" height="16" rx="2" fill="#d7e6f5" stroke="#2f6fe0" strokeWidth="1.6" />
      <rect x="7" y="8" width="18" height="10" rx="1" fill="#7eb6ea" />
      <path d="M12 24h8M16 21v3" stroke="#3d4d60" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Disk() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="6" y="8" width="20" height="16" rx="2" fill="#e7edf3" stroke="#5c6b7a" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="4.2" fill="#f7f9fb" stroke="#2f6fe0" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="1.2" fill="#2f6fe0" />
      <rect x="8" y="10" width="5" height="2" rx="0.4" fill="#9aa8b5" />
    </svg>
  );
}

function Tower() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="8" y="4" width="16" height="22" rx="2" fill="#d9e3ee" stroke="#31455c" strokeWidth="1.4" />
      <rect x="11" y="7" width="10" height="6" rx="1" fill="#7eb6ea" />
      <circle cx="13" cy="17.5" r="1" fill="#1f8a4c" />
      <rect x="16" y="16.5" width="6" height="2" rx="0.4" fill="#8aa0b4" />
      <rect x="11" y="21" width="10" height="2" rx="0.5" fill="#31455c" />
    </svg>
  );
}

function Wifi() {
  return (
    <svg viewBox="0 0 32 32">
      <path d="M6 14c6-6 14-6 20 0" fill="none" stroke="#2f6fe0" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 18c3.6-3.4 8.4-3.4 12 0" fill="none" stroke="#3d9cf2" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 22c1.2-1 2.8-1 4 0" fill="none" stroke="#1f6fe0" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="25" r="1.4" fill="#1f6fe0" />
    </svg>
  );
}

function Chip() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="9" y="9" width="14" height="14" rx="2" fill="#dfe8c8" stroke="#5d7340" strokeWidth="1.4" />
      <rect x="13" y="13" width="6" height="6" rx="1" fill="#f4f7ea" stroke="#5d7340" strokeWidth="1" />
      <path d="M12 9V5M16 9V5M20 9V5M12 27v-4M16 27v-4M20 27v-4M9 12H5M9 16H5M9 20H5M27 12h-4M27 16h-4M27 20h-4" stroke="#5d7340" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function Board() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="4" y="6" width="24" height="20" rx="2" fill="#1f6b45" />
      <rect x="8" y="9" width="8" height="8" rx="1" fill="#d9e3ee" stroke="#cfd8e3" />
      <circle cx="22" cy="12" r="1.3" fill="#e7c56a" />
      <circle cx="22" cy="17" r="1.3" fill="#d0d7df" />
      <path d="M8 21h16M8 24h10" stroke="#8fd0a4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function Processor() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="8" y="8" width="16" height="16" rx="2" fill="#c5d0dc" stroke="#31455c" strokeWidth="1.4" />
      <rect x="12" y="12" width="8" height="8" fill="#8aa0b4" />
      <path d="M12 8V5M16 8V5M20 8V5M12 27v-3M16 27v-3M20 27v-3M8 12H5M8 16H5M8 20H5M27 12h-3M27 16h-3M27 20h-3" stroke="#31455c" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function People() {
  return (
    <svg viewBox="0 0 32 32">
      <circle cx="12" cy="12" r="3" fill="#7eb6ea" />
      <circle cx="20" cy="13" r="2.4" fill="#b9cbe0" />
      <path d="M6 23c1.2-3.2 3.4-4.8 6-4.8s4.8 1.6 6 4.8" fill="#d7e6f5" stroke="#2f6fe0" strokeWidth="1.2" />
      <path d="M17 22.5c.8-2.2 2.2-3.3 4-3.3 1.6 0 2.8.8 3.6 2.6" fill="none" stroke="#5c6b7a" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MemoryStick() {
  return (
    <svg viewBox="0 0 32 32">
      <rect x="6" y="11" width="20" height="10" rx="1" fill="#1f6b45" />
      <rect x="9" y="13" width="3" height="6" fill="#e7c56a" />
      <rect x="14" y="13" width="3" height="6" fill="#d0d7df" />
      <rect x="19" y="13" width="3" height="6" fill="#e7c56a" />
    </svg>
  );
}
