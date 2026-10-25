"use client";

import { useEffect, useRef, useState } from "react";

function sectionsFor({ platform, manage, allowed, flags }) {
  if (platform) {
    return [
      { title: "Platform", icon: <OrgIcon />, items: [["Tenants and licences", "/control"], ["Action Log Viewer", "/audit"]] },
      { title: "My Login", icon: <ShieldIcon />, items: [["My Account", "/account"], ["Password", "/account"], ["Multi-Factor Authentication (MFA)", "/settings/mfa"]] },
    ];
  }
  return [
    {
      title: "Organization",
      icon: <OrgIcon />,
      items: [
        manage ? ["Manage Technicians", "/settings/technicians"] : null,
        ["Departments", null],
        ["Organization Details", "/organization"],
        manage ? ["Subscription", "/subscription"] : null,
        ["Offers", "/offers"],
        ["Billing", null],
      ],
    },
    {
      title: "General",
      icon: <GlobeIcon />,
      items: [
        ["My Account", "/account"],
        flags.alerts ? ["Alert Rules", "/alerts"] : null,
        allowed.service ? ["Service Levels (SLA)", "/tickets"] : null,
        flags.dashboard ? ["Scheduled Reports", "/dashboard"] : null,
        ["Email Templates", null],
        ["Session Recording", null],
        ["Survey", null],
      ],
    },
    {
      title: "Remote Support",
      icon: <HeadsetIcon />,
      items: [
        allowed.support ? ["Quick Support", "/support"] : null,
        allowed.service ? ["Contacts", "/tickets"] : null,
        ["Customer Widget", null],
        ["Self-Service Portal", null],
      ],
    },
    {
      title: "Unattended Access",
      icon: <MonitorIcon />,
      items: [
        manage ? ["Deployment", "/settings/deployment"] : null,
        flags.patches ? ["Patch Policies", "/patches"] : null,
        ["Groups", null],
        ["Wake on LAN", null],
        ["Session Confirmation", null],
        ["Device Cleanup Policy", null],
      ],
    },
    {
      title: "Security & Compliance",
      icon: <ShieldIcon />,
      items: [
        ["Action Log Viewer", "/audit"],
        ["Password", "/account"],
        ["Multi-Factor Authentication (MFA)", "/settings/mfa"],
        manage ? ["IP Based Restriction", "/settings/ip-restriction"] : null,
        ["Data Cleanup", null],
      ],
    },
    {
      title: "Integrations",
      icon: <PlugIcon />,
      items: [["API", null], ["Webhooks", null], ["Apps", null]],
    },
  ];
}

export function SettingsMenu(props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const term = query.trim().toLowerCase();
  const sections = sectionsFor(props)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item && (!term || `${section.title} ${item[0]}`.toLowerCase().includes(term))),
    }))
    .filter((section) => section.items.length);

  return (
    <div className="settings-menu" ref={root}>
      <button
        type="button"
        className={open ? "settings-btn open" : "settings-btn"}
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        <Gear />
      </button>
      {open ? (
        <div className="settings-panel" role="dialog" aria-label="Settings">
          <div className="settings-head">
            <label className="settings-search">
              <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What are you looking for?" aria-label="Search settings" />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </label>
            <button type="button" className="settings-close" aria-label="Close settings" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {sections.length === 0 ? <p className="settings-empty">No settings match “{query.trim()}”.</p> : null}
          <div className="settings-grid">
            {sections.map((section) => (
              <section key={section.title}>
                <h2>{section.icon}{section.title}</h2>
                <ul>
                  {section.items.map(([label, href]) => (
                    <li key={label}>
                      {href ? (
                        <a href={href}>{label}</a>
                      ) : (
                        <span className="settings-soon" title="Coming soon">{label}<em>Soon</em></span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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

function OrgIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="16" width="6" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="15" y="16" width="6" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4M6 16v-4h12v4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5M12 3.5C9.6 5.9 8.5 8.7 8.5 12s1.1 6.1 3.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13" width="4" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="16.5" y="13" width="4" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20h6M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6l7-2.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8zM12 16.5v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
