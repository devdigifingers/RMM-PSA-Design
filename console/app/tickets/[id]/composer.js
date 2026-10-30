"use client";

import { useRef, useState } from "react";
import { addComment } from "../../actions";
import { FileDrop } from "../file-drop";

export function fillVariables(text, variables) {
  return String(text || "").replace(/\{(contact\.name|ticket\.id|agent\.name)\}/g, (match, key) => variables?.[key] ?? match);
}

export function Composer({ ticketId, initialKind, canned = [], variables = {} }) {
  const [kind, setKind] = useState(initialKind === "note" ? "note" : "reply");
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const area = useRef(null);
  const note = kind === "note";

  function insertCanned(id) {
    const reply = canned.find((item) => String(item.id) === String(id));
    if (!reply) return;
    const text = fillVariables(reply.body, variables);
    const el = area.current;
    const start = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`.slice(0, 4000);
    setBody(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = Math.min(next.length, start + text.length);
    });
  }

  return (
    <form className={`job composer${note ? " is-note" : ""}`} action={addComment}>
      <div className="composer-tabs" role="tablist" aria-label="Write">
        <button type="button" role="tab" aria-selected={!note} className={!note ? "is-active" : undefined} onClick={() => setKind("reply")}>
          Reply
        </button>
        <button type="button" role="tab" aria-selected={note} className={note ? "is-active" : undefined} onClick={() => setKind("note")}>
          Internal note
        </button>
        {canned.length ? (
          <select
            className="composer-canned"
            aria-label="Insert a canned reply"
            value=""
            onChange={(event) => insertCanned(event.target.value)}
          >
            <option value="">Insert canned reply…</option>
            {canned.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        ) : null}
      </div>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="kind" value={kind} />
      <textarea
        ref={area}
        name="body"
        rows={5}
        maxLength={4000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        autoFocus={initialKind === "reply" || initialKind === "note"}
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
