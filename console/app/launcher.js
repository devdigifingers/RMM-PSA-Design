"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { APPS, SHOW_SOON } from "./apps";
import { AppIcon } from "./mark";
import { appForPath } from "./nav-links";

const SERVICE_ORDER = ["service-desk", "remote-desk"];

const SECTIONS = [
  {
    title: "Service",
    apps: SERVICE_ORDER.map((id) => APPS.find((app) => app.id === id)).filter((app) => app.status === "live"),
  },
  {
    title: "Coming soon",
    apps: SHOW_SOON ? APPS.filter((app) => app.status === "soon") : [],
  },
];

export function AppLauncher({ entitledApps, lastApp }) {
  const current = appForPath(usePathname() || "") || lastApp;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  const search = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
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
  }

  const entitled = (app) => app.status === "soon" || entitledApps.includes(app.entitlementKey);
  const available = SECTIONS.map((section) => ({ ...section, apps: section.apps.filter(entitled) }))
    .filter((section) => section.apps.length);
  const term = query.trim().toLowerCase();
  const sections = available.map((section) => ({
    ...section,
    apps: section.apps.filter((app) => !term || `${app.name} ${app.description}`.toLowerCase().includes(term)),
  })).filter((section) => section.apps.length);

  return (
    <div className="launcher" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={open ? "launcher-btn open" : "launcher-btn"}
        aria-label="Apps"
        title="Apps"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Grid />
      </button>
      {open ? (
        <div className="launcher-panel" role="dialog" aria-label="Apps">
          <label className="launcher-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" aria-label="Search apps" />
          </label>
          {available.length === 0 ? <p className="launcher-empty">No apps are included in your package.</p> : null}
          {available.length > 0 && sections.length === 0 ? <p className="launcher-empty">No apps match “{query.trim()}”.</p> : null}
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <div className="launcher-apps">
                {section.apps.map((app) => {
                  const soon = app.status === "soon";
                  const isCurrent = current === app.key;
                  const body = (
                    <>
                      <span className={`launcher-icon launcher-icon--${app.key}`}>
                        <AppIcon app={app} size={48} />
                      </span>
                      <span className="launcher-name">{app.name}</span>
                      <span className="launcher-detail">{app.description}</span>
                      {soon ? <span className="launcher-soon">Soon</span> : null}
                    </>
                  );
                  const cls = `launcher-app${soon ? " soon" : ""}${isCurrent ? " current" : ""}`;
                  if (soon) return <div key={app.id} className={cls} aria-disabled="true">{body}</div>;
                  return (
                    <Link key={app.id} className={cls} href={app.route} aria-current={isCurrent ? "page" : undefined} onClick={() => setOpen(false)}>{body}</Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Grid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="currentColor" />))}
    </svg>
  );
}
