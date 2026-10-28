"use client";

import { useState } from "react";
import { addComment } from "../../actions";
import { FileDrop } from "../file-drop";

export function Composer({ ticketId, initialKind }) {
  const [kind, setKind] = useState(initialKind === "note" ? "note" : "reply");
  const [busy, setBusy] = useState(false);
  const note = kind === "note";

  return (
    <form className={`job composer${note ? " is-note" : ""}`} action={addComment}>
      <div className="composer-tabs" role="tablist" aria-label="Write">
        <button type="button" role="tab" aria-selected={!note} className={!note ? "is-active" : undefined} onClick={() => setKind("reply")}>
          Reply
        </button>
        <button type="button" role="tab" aria-selected={note} className={note ? "is-active" : undefined} onClick={() => setKind("note")}>
          Internal note
        </button>
      </div>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="kind" value={kind} />
      <textarea
        name="body"
        rows={5}
        maxLength={4000}
        aria-label={note ? "Internal note" : "Reply"}
        placeholder={note ? "Only your team sees internal notes." : "Write a reply to the customer."}
      />
      {note ? <p className="composer-hint">Internal notes are never emailed or shown to the customer.</p> : null}
      <FileDrop ticketId={ticketId} onBusy={setBusy} />
      <div className="composer-actions">
        <button type="submit" disabled={busy}>{busy ? "Uploading…" : note ? "Add Note" : "Add Reply"}</button>
      </div>
    </form>
  );
}
