"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { setDeviceSite } from "../actions";

export function CustomerFilter({ customers, value }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  function choose(next) {
    const query = new URLSearchParams(search.toString());
    if (next) query.set("customer", next);
    else query.delete("customer");
    const text = query.toString();
    router.push(text ? `${pathname}?${text}` : pathname);
  }
  return (
    <select className="device-customer" value={value || ""} onChange={(event) => choose(event.target.value)} aria-label="Customer">
      <option value="">All customers</option>
      {customers.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
      <option value="none">No customer</option>
    </select>
  );
}

// Works on the server-rendered table: rows carry .bulk-pick checkboxes, the header a .bulk-all checkbox.
export function BulkSite() {
  const router = useRouter();
  const [picked, setPicked] = useState([]);
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sync = () => setPicked([...document.querySelectorAll(".bulk-pick:checked")].map((box) => box.value));
    const change = (event) => {
      if (event.target.matches?.(".bulk-all")) {
        document.querySelectorAll(".bulk-pick").forEach((box) => { box.checked = event.target.checked; });
      }
      if (event.target.matches?.(".bulk-pick, .bulk-all")) sync();
    };
    document.addEventListener("change", change);
    sync();
    return () => document.removeEventListener("change", change);
  }, []);

  async function save(value) {
    setBusy(true);
    setMessage("");
    const result = await setDeviceSite(picked, value);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(value ? `Site set to ${value} on ${result.updated} ${result.updated === 1 ? "device" : "devices"}.` : `Site cleared on ${result.updated} ${result.updated === 1 ? "device" : "devices"}.`);
    document.querySelectorAll(".bulk-pick, .bulk-all").forEach((box) => { box.checked = false; });
    setPicked([]);
    setSite("");
    router.refresh();
  }

  if (!picked.length) return message ? <p className="saved bulk-message" role="status">{message}</p> : null;
  return (
    <form className="bulk-bar" onSubmit={(event) => { event.preventDefault(); if (site.trim()) save(site.trim()); }}>
      <strong>{`${picked.length} selected`}</strong>
      <label>
        <span>Site / Branch</span>
        <input value={site} maxLength={80} placeholder="e.g. Durban branch" onChange={(event) => setSite(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || !site.trim()}>{busy ? "Saving…" : "Set site"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => save("")}>Clear site</button>
      {message ? <span className="error">{message}</span> : null}
    </form>
  );
}
