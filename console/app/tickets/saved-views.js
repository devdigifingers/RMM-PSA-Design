"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTicketView, saveTicketView } from "../actions";

export function SaveView({ query, columns, canShare }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function save(event) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await saveTicketView(name, query, columns, shared);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/tickets?${query ? `${query}&` : ""}saved=${result.id}`);
      router.refresh();
    });
  }

  return (
    <div className="desk-pop-wrap">
      <button type="button" className="desk-tool" aria-expanded={open} onClick={() => setOpen(!open)}>Save view</button>
      {open ? (
        <form className="desk-pop" onSubmit={save}>
          <label>
            View name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required autoFocus />
          </label>
          {canShare ? (
            <label className="desk-tick">
              <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> Share with the team
            </label>
          ) : null}
          <p className="composer-hint">Saves the current filters, sort and columns.</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="desk-pop-actions">
            <button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="desk-bulk-clear" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function DeleteView({ id, name, active }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Remove the view "${name}"?`)) return;
    startTransition(async () => {
      const result = await deleteTicketView(id);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      if (active) router.push("/tickets");
      router.refresh();
    });
  }

  return (
    <button type="button" className="desk-saved-remove" onClick={remove} disabled={busy} aria-label={`Remove view ${name}`} title="Remove view">
      ×
    </button>
  );
}
