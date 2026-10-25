"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bulkUpdateTickets } from "../actions";

const STATUSES = [
  ["open", "Open"],
  ["pending", "Pending"],
  ["resolved", "Resolved"],
];

const CHANNELS = {
  console: "Console",
  alert: "Alert",
  automatic: "Automatic",
  support: "Remote Support",
};

export function TicketTable({ tickets, users, me, empty }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [note, setNote] = useState("");
  const [busy, startTransition] = useTransition();
  const ids = tickets.map((ticket) => ticket.id);
  const chosen = ids.filter((id) => selected.has(id));
  const allChosen = ids.length > 0 && chosen.length === ids.length;

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChosen ? new Set() : new Set(ids));
  }

  function apply(list, changes, done) {
    setNote("Saving…");
    startTransition(async () => {
      const result = await bulkUpdateTickets(list, changes);
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setNote(list.length > 1 ? `Updated ${result.updated} tickets.` : "");
      done?.();
      router.refresh();
    });
  }

  function applyBulk() {
    const changes = {};
    if (bulkStatus) changes.status = bulkStatus;
    if (bulkOwner) changes.assigneeUserId = bulkOwner === "none" ? null : bulkOwner === "me" ? me : bulkOwner;
    if (!Object.keys(changes).length) {
      setNote("Choose a status or an owner first.");
      return;
    }
    apply(chosen, changes, () => {
      setSelected(new Set());
      setBulkStatus("");
      setBulkOwner("");
    });
  }

  return (
    <>
      {chosen.length ? (
        <div className="desk-bulk" role="toolbar" aria-label="Selected tickets">
          <strong>{chosen.length} selected</strong>
          <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} aria-label="Set status">
            <option value="">Set status…</option>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} aria-label="Assign owner">
            <option value="">Assign to…</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {users.filter((user) => user.id !== me).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <button type="button" onClick={applyBulk} disabled={busy}>Apply</button>
          <button type="button" className="desk-bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}
      {note ? <p className="org-name desk-note">{note}</p> : null}
      <div className="systems desk-table">
        <table>
          <thead>
            <tr>
              <th className="desk-check">
                <input type="checkbox" checked={allChosen} onChange={toggleAll} aria-label="Select all tickets" disabled={!ids.length} />
              </th>
              <th>Ticket ID</th>
              <th>Subject</th>
              <th>Contact Name</th>
              <th>Customer</th>
              <th>Device</th>
              <th>Last Activity</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Ticket Owner</th>
              <th>Channel</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td className="empty" colSpan={12}>{empty}</td>
              </tr>
            ) : tickets.map((ticket) => (
              <tr key={ticket.id} className={selected.has(ticket.id) ? "is-selected" : undefined}>
                <td className="desk-check">
                  <input type="checkbox" checked={selected.has(ticket.id)} onChange={() => toggle(ticket.id)} aria-label={`Select ticket ${ticket.id}`} />
                </td>
                <td className="desk-id">#{ticket.id}</td>
                <td className="desk-subject">
                  <a href={`/tickets/${ticket.id}`} title={ticket.subject}>{ticket.subject}</a>
                  {ticket.commentCount ? <span className="desk-comments" title={`${ticket.commentCount} comments`}>{ticket.commentCount}</span> : null}
                </td>
                <td>{ticket.customer?.contactName || "—"}</td>
                <td>{ticket.customer?.name || "—"}</td>
                <td>{ticket.device?.hostname || "—"}</td>
                <td>{when(ticket.lastActivityAt)}</td>
                <td className={ticket.overdue ? "desk-overdue" : undefined}>{ticket.dueAt ? when(ticket.dueAt) : "—"}</td>
                <td>
                  <select
                    className={`status-pick status-${ticket.status}`}
                    value={ticket.status}
                    disabled={busy}
                    aria-label={`Status of ticket ${ticket.id}`}
                    onChange={(event) => apply([ticket.id], { status: event.target.value })}
                  >
                    {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td><span className={`chip priority-${ticket.priority}`}>{ticket.priority}</span></td>
                <td>
                  <span className={ticket.assignee ? "desk-owner" : "desk-owner is-empty"}>
                    <Avatar name={ticket.assignee?.name} />
                    {ticket.assignee?.name || "Unassigned"}
                  </span>
                </td>
                <td>
                  <span className="desk-channel">
                    <ChannelIcon channel={ticket.channel} />
                    {CHANNELS[ticket.channel] || "Console"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function when(value) {
  if (!value) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod || "").toUpperCase()}`;
}

function Avatar({ name }) {
  if (!name) {
    return (
      <span className="desk-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 19c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </span>
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <span className="desk-avatar has-name" aria-hidden="true">{initials}</span>;
}

function ChannelIcon({ channel }) {
  const paths = {
    alert: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
    automatic: <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3.5v4h-4M5.5 20.5v-4h4" />,
    support: <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1z" />,
    console: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  };
  return (
    <svg className="desk-channel-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[channel] || paths.console}
      </g>
    </svg>
  );
}
