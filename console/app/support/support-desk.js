"use client";

import { useCallback, useEffect, useState } from "react";
import { endSupportSession, saveSupportSession, startSupportSession, supportSessions } from "../actions";

const STATUS = {
  waiting: ["Waiting for customer", "is-waiting"],
  connected: ["Customer joined", "is-live"],
  ended: ["Ended", "is-ended"],
  expired: ["Code expired", "is-ended"],
};

export function SupportDesk({ initial, wrapId }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState("sessions");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [wrapping, setWrapping] = useState(wrapId);
  const wrapSession = wrapping
    ? data.live.find((item) => item.id === wrapping) || data.history.find((item) => item.id === wrapping)
    : null;

  const refresh = useCallback(async () => {
    const result = await supportSessions();
    if (result.ok) setData(result);
  }, []);

  useEffect(() => {
    const poll = setInterval(refresh, data.live.length ? 5000 : 30000);
    return () => clearInterval(poll);
  }, [refresh, data.live.length]);

  useEffect(() => {
    if (!data.live.length) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [data.live.length]);

  async function start(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    setBusy(true);
    setMessage(null);
    const result = await startSupportSession(input);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    form.reset();
    setTab("sessions");
    setMessage({
      kind: "saved",
      text: input.customerEmail
        ? result.emailed
          ? `Session ${spaced(result.code)} started. The invite was emailed to ${input.customerEmail}.`
          : `Session ${spaced(result.code)} started, but the email could not be sent. Read the code to the customer instead.`
        : `Session ${spaced(result.code)} started. Give the customer the code or the link.`,
    });
    await refresh();
  }

  const used = data.live.length;
  return (
    <>
      <header className="sup-head">
        <div>
          <h1>Remote Support</h1>
          <p className="org-name">One-off help for any Windows computer. The customer runs a small app, clicks Allow, and nothing stays installed.</p>
        </div>
        <span className={`sup-usage${used >= data.limit ? " is-full" : ""}`}>
          {used} of {data.limit} session{data.limit === 1 ? "" : "s"} in use
        </span>
      </header>

      {message ? <p className={message.kind}>{message.text}</p> : null}

      {wrapSession ? (
        <WrapUp
          session={wrapSession}
          onDone={async (text) => {
            setWrapping("");
            window.history.replaceState({}, "", "/support");
            setMessage({ kind: "saved", text });
            setTab("history");
            await refresh();
          }}
        />
      ) : null}

      <section className="sup-start">
        <form onSubmit={start}>
          <h2>Access Remote Screen</h2>
          <p>Start a session, then give the customer the 6-digit code or the link.</p>
          <label>
            What is the problem?
            <input name="topic" maxLength={200} placeholder="For example: Outlook keeps asking for a password" />
          </label>
          <div className="sup-pair">
            <label>
              <span>Customer email <small>(optional)</small></span>
              <input name="customerEmail" type="email" maxLength={200} placeholder="We email them the link" />
            </label>
            <label>
              <span>Ticket number <small>(optional)</small></span>
              <input name="ticketId" inputMode="numeric" pattern="\d*" maxLength={12} />
            </label>
          </div>
          <button type="submit" disabled={busy || used >= data.limit}>
            {busy ? "Starting…" : "Start session"}
          </button>
          {used >= data.limit ? <small className="sup-limit">End a running session to start another.</small> : null}
        </form>
        <ol className="sup-steps">
          <li><b>1</b><span>The customer opens <strong>rmm.digitalfingers.co.za/join</strong> and types the code.</span></li>
          <li><b>2</b><span>They download and run <strong>DigitalFingersQuickSupport.exe</strong>. No admin rights are needed.</span></li>
          <li><b>3</b><span>When they appear here, click <strong>Connect</strong>. They click Allow on their screen.</span></li>
          <li><b>4</b><span>End the session when you are done. The app closes and removes itself.</span></li>
        </ol>
      </section>

      <nav className="sup-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "sessions"} onClick={() => setTab("sessions")}>
          Sessions{used ? ` (${used})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          History
        </button>
      </nav>

      {tab === "sessions" ? (
        data.live.length ? (
          <div className="sup-live">
            {data.live.map((session) => (
              <LiveSession key={session.id} session={session} now={now} onChange={refresh} />
            ))}
          </div>
        ) : (
          <p className="sup-empty">No sessions running. Start one above.</p>
        )
      ) : (
        <History rows={data.history} />
      )}
    </>
  );
}

function LiveSession({ session, now, onChange }) {
  const [copied, setCopied] = useState("");
  const [ending, setEnding] = useState(false);
  const [notes, setNotes] = useState(session.notes);
  const [ticketId, setTicketId] = useState(session.ticketId);
  const [saved, setSaved] = useState("");
  const [origin, setOrigin] = useState("https://rmm.digitalfingers.co.za");
  const [label, tone] = STATUS[session.status] || STATUS.ended;
  const link = `${origin}/join?code=${session.code}`;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const left = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - now) / 1000));

  function copy(text, what) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    }, () => {});
  }

  function connect() {
    const query = new URLSearchParams();
    if (session.hostname) query.set("host", session.hostname);
    const popup = window.open(
      `/support/${session.id}/session?${query}`,
      `df-support-${session.id}`,
      "popup=yes,width=1280,height=800,resizable=yes",
    );
    if (popup) popup.focus();
  }

  async function end() {
    if (!window.confirm("End this support session? The customer is disconnected and the app removes itself.")) return;
    setEnding(true);
    await endSupportSession(session.id);
    await onChange();
  }

  async function save(event) {
    event.preventDefault();
    const result = await saveSupportSession(session.id, { notes, ticketId });
    setSaved(result.ok ? "Saved." : result.error);
    setTimeout(() => setSaved(""), 3000);
  }

  return (
    <article className="sup-session">
      <header>
        <span className={`sup-status ${tone}`}>{label}</span>
        <h3>{session.topic || "Support session"}</h3>
        <small>Started by {session.createdBy || "a technician"}</small>
      </header>
      {session.status === "waiting" ? (
        <div className="sup-code">
          <div>
            <p>Code</p>
            <strong>{spaced(session.code)}</strong>
            <small>{left ? `Works for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} more` : "Expiring…"}</small>
          </div>
          <div className="sup-link">
            <p>Link for the customer</p>
            <code>{link}</code>
            <div>
              <button type="button" onClick={() => copy(link, "link")}>{copied === "link" ? "Copied" : "Copy link"}</button>
              <button type="button" onClick={() => copy(session.code, "code")}>{copied === "code" ? "Copied" : "Copy code"}</button>
            </div>
          </div>
        </div>
      ) : (
        <dl className="sup-device">
          <div><dt>Computer</dt><dd>{session.hostname || "Unknown"}</dd></div>
          <div><dt>System</dt><dd>{session.osName || "Unknown"}</dd></div>
          <div><dt>Joined</dt><dd>{when(session.joinedAt)}</dd></div>
        </dl>
      )}
      <form className="sup-notes" onSubmit={save}>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={4000} placeholder="What was done in this session" />
        </label>
        <label>
          Ticket
          <input value={ticketId} onChange={(event) => setTicketId(event.target.value)} inputMode="numeric" pattern="\d*" maxLength={12} />
        </label>
        <button type="submit" className="sup-quiet">Save</button>
        {saved ? <small>{saved}</small> : null}
      </form>
      <footer>
        <button type="button" className="sup-connect" onClick={connect} disabled={session.status !== "connected"}>
          Connect
        </button>
        {session.status === "connected" ? (
          <a className="sup-quiet" href="/agent/windows" title="Download the enrollment installer, copy it to this computer during the session, and run Install.cmd as an administrator.">
            Make managed
          </a>
        ) : null}
        <button type="button" className="sup-end" onClick={end} disabled={ending}>
          {ending ? "Ending…" : "End session"}
        </button>
      </footer>
    </article>
  );
}

function WrapUp({ session, onDone }) {
  const [notes, setNotes] = useState(session.notes);
  const [ticketId, setTicketId] = useState(session.ticketId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (session.status === "waiting" || session.status === "connected") await endSupportSession(session.id);
    const result = await saveSupportSession(session.id, { notes, ticketId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onDone(`Session ${session.hostname ? `with ${session.hostname} ` : ""}closed off.`);
  }

  return (
    <section className="sup-wrap">
      <header>
        <span className="sup-status is-ended">Session ended</span>
        <h2>Wrap up{session.hostname ? `: ${session.hostname}` : ""}</h2>
        <small>
          {session.topic || "Support session"}
          {session.joinedAt && session.endedAt ? ` · ${length(session.joinedAt, session.endedAt)}` : ""}
        </small>
      </header>
      <form className="sup-notes" onSubmit={save}>
        <label>
          What was done
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={4000} placeholder="For example: Reset the Outlook profile and re-entered the password" autoFocus />
        </label>
        <label>
          Ticket
          <input value={ticketId} onChange={(event) => setTicketId(event.target.value)} inputMode="numeric" pattern="\d*" maxLength={12} />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save and close off"}</button>
        {error ? <small className="sup-limit">{error}</small> : null}
      </form>
    </section>
  );
}

function History({ rows }) {
  if (!rows.length) return <p className="sup-empty">No finished sessions yet.</p>;
  return (
    <div className="sup-history">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Problem</th>
            <th>Computer</th>
            <th>Technician</th>
            <th>Length</th>
            <th>Result</th>
            <th>Ticket</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{when(row.createdAt)}</td>
              <td>{row.topic || "—"}</td>
              <td>{row.hostname || "—"}</td>
              <td>{row.createdBy || "—"}</td>
              <td>{row.joinedAt && row.endedAt ? length(row.joinedAt, row.endedAt) : "—"}</td>
              <td>{row.status === "expired" ? "Customer did not join" : row.endedBy ? `Ended by ${row.endedBy}` : "Customer closed the app"}</td>
              <td>{row.ticketId ? <a href={`/tickets/${row.ticketId}`}>#{row.ticketId}</a> : "—"}</td>
              <td className="sup-note-cell">{row.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function spaced(code) {
  return code ? `${code.slice(0, 3)} ${code.slice(3)}` : "";
}

function when(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function length(from, to) {
  const minutes = Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
