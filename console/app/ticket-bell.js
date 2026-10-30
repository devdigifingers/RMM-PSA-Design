"use client";

import { useEffect, useRef, useState } from "react";
import { markNotificationsRead } from "./actions";

export function TicketBell({ initial }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(initial?.items || []);
  const [spot, setSpot] = useState(null);
  const root = useRef(null);
  const unread = rows.filter((item) => !item.read).length;

  useEffect(() => {
    setRows(initial?.items || []);
  }, [initial]);

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

  async function openItem(item) {
    setRows((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
    await markNotificationsRead([item.id]);
    if (item.ticketId) window.location.href = `/tickets/${item.ticketId}`;
    else if (item.kind === "migration") window.location.href = "/settings/org/migrations";
  }

  async function readAll() {
    setRows((current) => current.map((row) => ({ ...row, read: true })));
    await markNotificationsRead(null);
  }

  return (
    <div className="notice-menu" ref={root}>
      <button
        type="button"
        className={unread ? "notice-btn ticket-bell has-new" : "notice-btn ticket-bell"}
        aria-label={unread ? `Ticket notifications, ${unread} unread` : "Ticket notifications"}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {unread ? <span className="ticket-bell-count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open && spot ? (
        <div className="notice-panel" style={{ top: spot.top, right: spot.right }}>
          <p className="notice-title">
            Ticket notifications
            {unread ? <button type="button" className="notice-read-all" onClick={readAll}>Mark all read</button> : null}
          </p>
          {rows.length === 0 ? <p className="notice-empty">Nothing new.</p> : (
            <ul>
              {rows.map((item) => (
                <li key={item.id} className={item.read ? "is-read" : "is-new"}>
                  <button type="button" onClick={() => openItem(item)}>
                    <strong>{item.title}</strong>
                    <span>{when(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(date);
}
