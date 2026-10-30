"use client";

import { useEffect, useRef, useState } from "react";

const DEVICE_COLUMNS = [
  { key: "status", label: "Status", nth: 2 },
  { key: "display", label: "Display name", nth: 3 },
  { key: "address", label: "Address", nth: 5 },
  { key: "account", label: "Account", nth: 6 },
  { key: "site", label: "Site / Location", nth: 7 },
  { key: "os", label: "Operating system", nth: 8 },
  { key: "users", label: "Active Users", nth: 9 },
  { key: "seen", label: "Last seen", nth: 10 },
  { key: "agent", label: "Agent", nth: 11 },
];

const COLUMN_COOKIE = "df_device_cols";

export function ColumnPicker({ initialHidden = [] }) {
  const [hidden, setHidden] = useState(initialHidden);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = (key) => {
    const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
    setHidden(next);
    document.cookie = `${COLUMN_COOKIE}=${next.join(",")}; path=/devices; max-age=31536000; samesite=lax`;
  };

  const rules = DEVICE_COLUMNS.filter((column) => hidden.includes(column.key))
    .map((column) => `.systems tr > :nth-child(${column.nth}):not(.empty)`)
    .join(", ");

  return (
    <div className="col-picker" ref={box}>
      <button
        type="button"
        className={`filter-chip${hidden.length ? " on" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M4 5h16v14H4zM9.5 5v14M14.5 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        Columns{hidden.length ? ` (${hidden.length} hidden)` : ""}
      </button>
      {open ? (
        <div className="col-picker-menu" role="group" aria-label="Show columns">
          {DEVICE_COLUMNS.map((column) => (
            <label key={column.key}>
              <input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => toggle(column.key)} />
              {column.label}
            </label>
          ))}
          {hidden.length ? (
            <button type="button" className="col-picker-reset" onClick={() => { setHidden([]); document.cookie = `${COLUMN_COOKIE}=; path=/devices; max-age=0`; }}>
              Show all columns
            </button>
          ) : null}
        </div>
      ) : null}
      {rules ? <style>{`${rules} { display: none; }`}</style> : null}
    </div>
  );
}
