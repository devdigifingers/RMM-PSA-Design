"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "./actions";

const LINKS = [
  ["faq", "/faq", "FAQ"],
  ["help", "/help", "Help"],
  ["pricing", "/pricing", "Pricing"],
  ["offers", "/offers", "Offers"],
  ["blogs", "/blogs", "Blogs"],
  ["contact", "/contact", "Contact Us"],
];
const TENANT_ONLY = new Set(["pricing", "offers", "blogs"]);

export function AccountMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState(false);
  const [dark, setDark] = useState(false);
  const [spot, setSpot] = useState(null);
  const root = useRef(null);
  const close = () => setOpen(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("df-theme") === "dark";
    setDark(saved);
    document.documentElement.dataset.theme = saved ? "dark" : "light";
  }, []);

  useEffect(() => {
    function close(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggle(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setSpot({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
    setOpen((current) => !current);
  }

  function setTheme(next) {
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("df-theme", next ? "dark" : "light");
  }

  return (
    <div className="account-menu" ref={root}>
      <button type="button" className="account-btn" aria-label="Account" aria-expanded={open} onClick={toggle}>
        <Person />
      </button>
      {open && spot ? (
        <div className="account-panel" style={{ top: spot.top, right: spot.right }}>
          <div className="account-head">
            <span className="account-avatar" aria-hidden="true"><Person /></span>
            <p className="account-name">{user.name}</p>
            <p className="account-email">{user.email}</p>
            <p className="account-id">User ID: {user.accountNumber}</p>
            <div className="account-shortcuts">
              <Link href="/account" onClick={close}>My Account</Link>
              {user.isPlatformAdmin ? <Link href="/control/tenants" onClick={close}>Control panel</Link> : <Link href="/organization" onClick={close}>My Organization</Link>}
            </div>
          </div>
          <Link className="account-sub" href="/subscription" onClick={close}>
            <Doc />
            Manage Subscription
          </Link>
          <div className="account-grid">
            {LINKS.filter(([icon]) => !(user.isPlatformAdmin && TENANT_ONLY.has(icon))).map(([icon, href, label]) => (
              <Link key={href} href={href} onClick={close}>{iconFor(icon)}{label}</Link>
            ))}
          </div>
          <div className="account-updates">
            <button type="button" aria-expanded={updates} onClick={() => setUpdates((current) => !current)}>
              <span>Agent Updates</span>
              <Chevron open={updates} />
            </button>
            {updates ? (
              <div className="account-platforms">
                <p>Updates the agent on a computer that already has it. The computer keeps its enrollment. Windows: extract the zip and run Install. Linux: extract it and run <code>sudo ./install.sh</code>. For a new computer, use <Link href="/downloads" onClick={close}>Downloads</Link>.</p>
                <a href="/agent/windows?update=1"><Window /> Windows</a>
                <span title="Coming soon"><Apple /> Mac</span>
                <a href="/agent/linux?update=1"><Penguin /> Linux</a>
              </div>
            ) : null}
          </div>
          <div className="account-theme">
            <span>Dark mode</span>
            <button type="button" className="switch" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={() => setTheme(!dark)}>
              <i />
            </button>
          </div>
          <div className="account-foot">
            <div className="account-social">
              <a href="https://digitalfingers.co.za" aria-label="Digital Fingers"><MarkX /></a>
              <a href="https://digitalfingers.co.za" aria-label="Digital Fingers"><MarkIn /></a>
              <a href="https://digitalfingers.co.za" aria-label="Digital Fingers"><MarkPlay /></a>
            </div>
            <form action={logout}>
              <button type="submit">Sign Out</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function iconFor(name) {
  if (name === "faq") return <Help />;
  if (name === "help") return <Doc />;
  if (name === "pricing") return <Tag />;
  if (name === "offers") return <Gift />;
  if (name === "blogs") return <News />;
  return <Mail />;
}

function Person() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19.2c1.2-3 3.5-4.4 6.5-4.4s5.3 1.4 6.5 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Doc() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 3.5V8h4.5M8 12h8M8 16h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Help() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.8-1.2 1.6V14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" />
    </svg>
  );
}

function Tag() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 12.5 12 4h7.5v7.5L11 20.5 3.5 12.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="16" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function Gift() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 10h16M12 10v9M12 10c-2.2 0-3.5-2.8-2-4s3.2.2 2 1.6C13.2 6.2 15.4 4.4 17 6s.2 4-2 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function News() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h11.5A1.5 1.5 0 0 1 18 7v11.5H7A2 2 0 0 1 5 16.5v-11z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9h7M8 12.5h7M8 16h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Mail() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? "chevron open" : "chevron"}>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Window() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5 11 5.4v6.2H4V6.5zm8 .9 8-1.2v6.4h-8V7.4zM4 13h7v6.3L4 18.2V13zm8 0h8v7.2l-8-1.1V13z" fill="currentColor" />
    </svg>
  );
}

function Apple() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.2 12.6c0-2 1.6-3 1.7-3.1-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.7-.7c-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.4.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.2s-2.2-.9-2.3-3.7zM14.6 6.8c.6-.7 1-1.7.9-2.7-1 .1-2.1.6-2.7 1.4-.6.7-1.1 1.7-.9 2.6 1 .1 2-.5 2.7-1.3z" fill="currentColor" />
    </svg>
  );
}

function Penguin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5c2.8 0 4.5 2.2 4.5 5.2 0 1.6-.4 2.8-1 3.6.8.5 1.5 1.4 1.5 2.7 0 2.6-2.2 5.5-5 5.5s-5-2.9-5-5.5c0-1.3.7-2.2 1.5-2.7-.6-.8-1-2-1-3.6 0-3 1.7-5.2 4.5-5.2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10.2" cy="9" r="0.7" fill="currentColor" />
      <circle cx="13.8" cy="9" r="0.7" fill="currentColor" />
    </svg>
  );
}

function MarkX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MarkIn() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10.5V16M8 8.2v.2M12 16v-3.2c0-1 .8-1.8 1.8-1.8S15.5 11.8 15.5 12.8V16M12 16v-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MarkPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 10.2v3.6l3-1.8-3-1.8z" fill="currentColor" />
    </svg>
  );
}
