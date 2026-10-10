"use client";

import { useEffect, useRef, useState } from "react";
import { deleteDeviceNotice, dismissRibbon, markDeviceNoticeRead } from "./actions";

export function SystemNotices({ items, showOrg }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(items || []);
  const [spot, setSpot] = useState(null);
  const root = useRef(null);
  const unread = rows.some((item) => !item.read);

  useEffect(() => {
    setRows(items || []);
  }, [items]);

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
    await markDeviceNoticeRead(item.id);
    if (item.deviceId) window.location.href = `/devices/${item.deviceId}/diagnostics`;
  }

  async function remove(item, event) {
    event.stopPropagation();
    setRows((current) => current.filter((row) => row.id !== item.id));
    await deleteDeviceNotice(item.id);
  }

  return (
    <div className="notice-menu" ref={root}>
      <button type="button" className={unread ? "notice-btn has-new" : "notice-btn"} aria-label="System notifications" aria-expanded={open} onClick={toggle}>
        <Megaphone />
      </button>
      {open && spot ? (
        <div className="notice-panel" style={{ top: spot.top, right: spot.right }}>
          <p className="notice-title">New systems</p>
          {rows.length === 0 ? <p className="notice-empty">No new systems.</p> : (
            <ul>
              {rows.map((item) => (
                <li key={item.id} className={item.read ? "is-read" : "is-new"}>
                  <button type="button" onClick={() => openItem(item)}>
                    <strong>{item.hostname}</strong>
                    <span>{showOrg ? `${item.orgName} · ` : ""}{when(item.createdAt)}</span>
                  </button>
                  <button type="button" aria-label={`Delete ${item.hostname}`} onClick={(event) => remove(item, event)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Ribbon({ notice }) {
  const [visible, setVisible] = useState(true);
  if (!visible || !notice) return null;

  async function close() {
    setVisible(false);
    await dismissRibbon(notice.id);
  }

  return (
    <div className="ribbon" role="status">
      <p>
        {notice.body}
        {notice.linkUrl ? <> <a href={notice.linkUrl}>{notice.linkLabel || "Know more"}</a></> : null}
      </p>
      <button type="button" aria-label="Dismiss notice" onClick={close}>×</button>
    </div>
  );
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function Megaphone() {
  return <img src="/brand/megaphone.png" alt="" width={22} height={24} />;
}
