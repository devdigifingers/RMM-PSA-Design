"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { appForPath } from "./nav-links";

const SECTIONS = [
  {
    title: "Service",
    apps: [
      { id: "service", name: "Service Desk", detail: "Tickets and customer support", href: "/tickets", icon: <TicketIcon /> },
      { id: "remote", name: "Remote Desk", detail: "Remote monitoring and support", href: "/devices", icon: <RemoteIcon /> },
    ],
  },
];

export function AppLauncher({ allowed, lastApp }) {
  const current = appForPath(usePathname() || "") || lastApp;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [locked, setLocked] = useState(null);
  const root = useRef(null);
  const search = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    search.current?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((value) => !value);
    setQuery("");
    setLocked(null);
  }

  const term = query.trim().toLowerCase();
  const sections = SECTIONS.map((section) => ({
    ...section,
    apps: section.apps.filter((app) => !term || `${app.name} ${app.detail}`.toLowerCase().includes(term)),
  })).filter((section) => section.apps.length);

  return (
    <div className="launcher" ref={root}>
      <button
        type="button"
        className={open ? "launcher-btn open" : "launcher-btn"}
        aria-label="Applications"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? <img src="/brand/logo-tile.svg" alt="" /> : <Grid />}
      </button>
      {open ? (
        <div className="launcher-panel" role="dialog" aria-label="Applications">
          <label className="launcher-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Applications" aria-label="Search Applications" />
          </label>
          {sections.length === 0 ? <p className="launcher-empty">No applications match “{query.trim()}”.</p> : null}
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <div className="launcher-apps">
                {section.apps.map((app) => {
                  const ok = allowed[app.id] === true;
                  const body = (
                    <>
                      <span className="launcher-icon">{app.icon}{ok ? null : <span className="launcher-lock"><Lock /></span>}</span>
                      <span className="launcher-name">{app.name}</span>
                      <span className="launcher-detail">{ok ? app.detail : "Not on your licence"}</span>
                    </>
                  );
                  const cls = `launcher-app${ok ? "" : " locked"}${current === app.id ? " current" : ""}`;
                  return ok ? (
                    <a key={app.id} className={cls} href={app.href} aria-current={current === app.id ? "true" : undefined}>{body}</a>
                  ) : (
                    <button key={app.id} type="button" className={cls} onClick={() => setLocked(app)}>{body}</button>
                  );
                })}
              </div>
            </section>
          ))}
          {locked ? (
            <div className="launcher-note" role="status">
              <p><strong>{locked.name}</strong> is not included on your licence. It is licensed separately.</p>
              <a href="/contact">Contact us</a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Grid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill="currentColor" />))}
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 10h6M9 14h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 20h6M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 8l4.2 1.8-1.8.7-.7 1.8-1.7-4.3z" fill="currentColor" />
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="9" rx="1.8" fill="currentColor" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
