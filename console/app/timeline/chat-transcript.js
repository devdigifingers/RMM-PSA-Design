"use client";

import { useRef, useState } from "react";
import { loadChatTranscript } from "../actions";

const timeLabel = (value) => new Date(value).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateLabel = (value) => new Date(value).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

// "View chat" on a timeline entry: the Session Panel conversation of one remote session, read-only.
export function ChatTranscript({ sessionId }) {
  const dialog = useRef(null);
  const [state, setState] = useState({ loading: false, error: "", data: null });

  const open = async () => {
    dialog.current?.showModal();
    if (state.data) return;
    setState({ loading: true, error: "", data: null });
    const result = await loadChatTranscript(sessionId);
    setState(result.ok ? { loading: false, error: "", data: result } : { loading: false, error: result.error, data: null });
  };

  const session = state.data?.session;
  return (
    <>
      <button type="button" className="link-button tl-chat-open" onClick={open}>View chat</button>
      <dialog ref={dialog} className="admin-dialog chat-transcript" aria-label="Chat transcript">
        <h2>Chat with the customer</h2>
        {session ? (
          <p className="org-name">
            {[session.device?.name, session.technician, dateLabel(session.startedAt)].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {state.loading ? <p className="org-name">Loading the conversation…</p> : null}
        {state.error ? <p className="error" role="alert">{state.error}</p> : null}
        {state.data && !state.data.messages.length ? <p className="org-name">No messages were sent.</p> : null}
        {state.data?.messages.length ? (
          <ol className="chat-transcript-list">
            {state.data.messages.map((message) => (
              <li key={message.id} className={message.from === "technician" ? "is-tech" : "is-customer"}>
                <span className="chat-transcript-who">
                  {message.name} <time dateTime={message.at}>{timeLabel(message.at)}</time>
                </span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="form-actions admin-actions">
          <button type="button" className="admin-secondary" onClick={() => dialog.current?.close()}>Close</button>
        </div>
      </dialog>
    </>
  );
}
