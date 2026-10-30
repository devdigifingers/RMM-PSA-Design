"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { appForPath } from "./apps";
import { AppIcon } from "./mark";
import { SettingsBody, SettingsGrid } from "./settings-grid";
import { SETTINGS_AREAS, areaForApp, areasFor, searchSections, visibleSections } from "./settings-map";

const PLATFORM_SECTIONS = [
  {
    title: "Platform",
    icon: "org",
    items: [
      { label: "Tenants", href: "/control/tenants" },
      { label: "Packages", href: "/control/packages" },
      { label: "Notices", href: "/control/notices" },
      { label: "System", href: "/control/system" },
      { label: "Action log viewer", href: "/control/audit" },
    ],
  },
  {
    title: "My login",
    icon: "shield",
    items: [
      { label: "My account and password", href: "/settings/org/account" },
      { label: "Multi-factor authentication (MFA)", href: "/settings/org/mfa" },
    ],
  },
];

function startingView(path, access, lastApp) {
  if (path === "/settings/org" || path.startsWith("/settings/org/")) return { area: areaForApp(lastApp, access), view: "org" };
  if (path.startsWith("/remote/settings") && access.remote) return { area: "remote", view: "app" };
  if (path.startsWith("/desk/settings") && access.service) return { area: "desk", view: "app" };
  const area = areaForApp(appForPath(path)?.key || lastApp, access);
  return { area, view: area === "org" ? "org" : "app" };
}

export function SettingsMenu({ platform, access, lastApp }) {
  const path = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("org");
  const [view, setView] = useState("org");
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
    if (!open && !platform) {
      const start = startingView(path, access, lastApp);
      setArea(start.area);
      setView(start.view);
    }
    setQuery("");
    setOpen(!open);
  }

  const appAreas = platform ? [] : areasFor(access).filter((entry) => entry.key !== "org");
  const current = SETTINGS_AREAS[area];
  const searching = Boolean(query.trim());
  const showApp = area !== "org" && (view === "app" || searching);
  const appSections = showApp ? searchSections(visibleSections(area, access), query) : [];
  const orgSections = platform ? [] : searchSections(visibleSections("org", access), query);
  const platformSections = platform ? searchSections(PLATFORM_SECTIONS, query) : [];
  const pick = () => setOpen(false);

  return (
    <div className="settings-menu" ref={root}>
      <button type="button" className={open ? "settings-btn open" : "settings-btn"} aria-label="Settings" aria-expanded={open} onClick={toggle}>
        <Gear />
      </button>
      {open ? (
        <div className={`settings-panel tone-${view === "app" ? area : "org"}`} role="dialog" aria-label="Settings">
          <div className="settings-head">
            {platform ? <h2 className="settings-title">Platform settings</h2> : (
              <div className="settings-for" role="tablist" aria-label="Settings for">
                <span className="settings-for-label">Settings for:</span>
                {appAreas.length ? (
                  <span className={`settings-tab tone-${area}${view === "app" ? " on" : ""}`}>
                    {current?.app ? <AppIcon app={current.app} size={20} /> : null}
                    {appAreas.length > 1 ? (
                      <select
                        className="settings-app-pick"
                        aria-label="App"
                        value={area}
                        onChange={(event) => { setArea(event.target.value); setView("app"); }}
                        onClick={() => setView("app")}
                      >
                        {appAreas.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                      </select>
                    ) : (
                      <button type="button" role="tab" aria-selected={view === "app"} onClick={() => setView("app")}>{current?.label}</button>
                    )}
                  </span>
                ) : null}
                <span className={`settings-tab tone-org${view === "org" ? " on" : ""}`}>
                  <button type="button" role="tab" aria-selected={view === "org"} onClick={() => setView("org")}>Organisation</button>
                </span>
              </div>
            )}
            <div className="settings-tools">
              <label className="settings-search">
                <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What are you looking for?" aria-label="Search settings" />
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </label>
              {platform ? null : (
                <Link className="settings-page-link" href={view === "app" && current ? current.root : SETTINGS_AREAS.org.root} onClick={pick}>Open as page</Link>
              )}
              <button type="button" className="settings-close" aria-label="Close settings" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          {platform ? (
            <>
              {platformSections.length === 0 ? <p className="settings-empty">No settings match “{query.trim()}”.</p> : null}
              <SettingsGrid sections={platformSections} tone="org" onPick={pick} />
            </>
          ) : (
            <SettingsBody areaKey={showApp ? area : "org"} appSections={appSections} orgSections={orgSections} query={query} onPick={pick} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.5 7.5 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4.9 2-3.4-2-1.6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
