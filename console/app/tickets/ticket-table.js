"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { bulkUpdateTickets, mergeTickets, saveTicketColumns } from "../actions";
import {
  CHANNEL_LABELS,
  COLUMN_LABELS,
  PRIORITY_LABELS,
  SLA_LABELS,
  STATUS_LABELS,
  duration,
  shortcutBlocked,
} from "./columns";

export function TicketTable({
  tickets,
  columns,
  allColumns,
  viewColumns,
  sort,
  dir,
  sortHrefs,
  users,
  me,
  categories,
  tags,
  empty,
  emptyHref,
  tools,
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState({ status: "", priority: "", owner: "", category: "", addTags: "", removeTags: "" });
  const [merging, setMerging] = useState(false);
  const [keep, setKeep] = useState("");
  const [cursor, setCursor] = useState(-1);
  const [note, setNote] = useState("");
  const [busy, startTransition] = useTransition();
  const rows = useRef([]);
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

  function clearBulk() {
    setSelected(new Set());
    setBulk({ status: "", priority: "", owner: "", category: "", addTags: "", removeTags: "" });
    setMerging(false);
  }

  function applyBulk() {
    const changes = {};
    if (bulk.status) changes.status = bulk.status;
    if (bulk.priority) changes.priority = bulk.priority;
    if (bulk.owner) changes.assigneeUserId = bulk.owner === "none" ? null : bulk.owner === "me" ? me : bulk.owner;
    if (bulk.category === "-") changes.category = "";
    else if (bulk.category.trim()) changes.category = bulk.category.trim();
    if (bulk.addTags.trim()) changes.addTags = bulk.addTags;
    if (bulk.removeTags.trim()) changes.removeTags = bulk.removeTags;
    if (!Object.keys(changes).length) {
      setNote("Choose a change first.");
      return;
    }
    apply(chosen, changes, clearBulk);
  }

  function merge() {
    const target = Number(keep);
    if (!chosen.includes(target)) {
      setNote("Choose the ticket to keep.");
      return;
    }
    setNote("Merging…");
    startTransition(async () => {
      const result = await mergeTickets(target, chosen.filter((id) => id !== target));
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setNote(`Merged ${result.merged} ticket${result.merged === 1 ? "" : "s"} into #${target}.`);
      clearBulk();
      router.refresh();
    });
  }

  useEffect(() => {
    function onKey(event) {
      if (shortcutBlocked(event) || tickets.length === 0) return;
      const key = event.key.toLowerCase();
      const current = tickets[cursor];
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = key === "j" ? Math.min(cursor + 1, tickets.length - 1) : Math.max(cursor - 1, 0);
        setCursor(next);
        rows.current[next]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (!current) return;
      if (key === "enter" || key === "o") {
        event.preventDefault();
        router.push(`/tickets/${current.id}`);
      } else if (key === "r" || key === "n") {
        event.preventDefault();
        router.push(`/tickets/${current.id}?compose=${key === "r" ? "reply" : "note"}`);
      } else if (key === "a") {
        event.preventDefault();
        if (current.assignee?.id !== me) apply([current.id], { assigneeUserId: me });
      } else if (key === "x") {
        event.preventDefault();
        toggle(current.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportSelected = `/tickets/export?ids=${chosen.join(",")}`;

  return (
    <>
      <div className="desk-tools">
        {tools}
        <ColumnChooser columns={columns} allColumns={allColumns} locked={viewColumns} />
      </div>
      {chosen.length ? (
        <div className="desk-bulk" role="toolbar" aria-label="Selected tickets">
          <strong>{chosen.length} selected</strong>
          <select value={bulk.status} onChange={(event) => setBulk({ ...bulk, status: event.target.value })} aria-label="Set status">
            <option value="">Status…</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={bulk.priority} onChange={(event) => setBulk({ ...bulk, priority: event.target.value })} aria-label="Set priority">
            <option value="">Priority…</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={bulk.owner} onChange={(event) => setBulk({ ...bulk, owner: event.target.value })} aria-label="Assign owner">
            <option value="">Assign to…</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {users.filter((user) => user.id !== me).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <input
            list="desk-categories"
            value={bulk.category}
            onChange={(event) => setBulk({ ...bulk, category: event.target.value })}
            placeholder="Category…"
            aria-label="Set category (type - to clear)"
            title="Type - to clear the category"
            maxLength={60}
          />
          <datalist id="desk-categories">
            {categories.map((item) => <option key={item} value={item} />)}
          </datalist>
          <input
            list="desk-tags"
            value={bulk.addTags}
            onChange={(event) => setBulk({ ...bulk, addTags: event.target.value })}
            placeholder="Add tags…"
            aria-label="Add tags, comma separated"
          />
          <input
            list="desk-tags"
            value={bulk.removeTags}
            onChange={(event) => setBulk({ ...bulk, removeTags: event.target.value })}
            placeholder="Remove tags…"
            aria-label="Remove tags, comma separated"
          />
          <datalist id="desk-tags">
            {tags.map((item) => <option key={item} value={item} />)}
          </datalist>
          <button type="button" onClick={applyBulk} disabled={busy}>Apply</button>
          <button type="button" className="desk-bulk-alt" onClick={() => apply(chosen, { status: "resolved" }, clearBulk)} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="desk-bulk-alt"
            onClick={() => { setMerging(!merging); setKeep(String(chosen[0])); }}
            disabled={busy || chosen.length < 2}
            aria-expanded={merging}
          >
            Merge…
          </button>
          <a className="desk-bulk-alt" href={exportSelected} download>Export</a>
          <button type="button" className="desk-bulk-clear" onClick={clearBulk}>Clear</button>
          {merging && chosen.length > 1 ? (
            <div className="desk-merge" role="group" aria-label="Merge tickets">
              <label>
                Keep
                <select value={keep} onChange={(event) => setKeep(event.target.value)}>
                  {chosen.map((id) => {
                    const ticket = tickets.find((item) => item.id === id);
                    return <option key={id} value={id}>#{id} {ticket?.subject}</option>;
                  })}
                </select>
              </label>
              <span className="composer-hint">
                The other {chosen.length - 1} will be resolved, and their replies, notes, files and time move into the one you keep.
                Tickets must belong to the same customer.
              </span>
              <button type="button" onClick={merge} disabled={busy}>Merge {chosen.length} tickets</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="org-name desk-note" role="status">{note}</p> : null}
      <div className="systems desk-table">
        <table>
          <thead>
            <tr>
              <th className="desk-check">
                <input
                  type="checkbox"
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(ids))}
                  aria-label="Select all tickets on this page"
                  disabled={!ids.length}
                />
              </th>
              {columns.map((column) => (
                <th key={column} aria-sort={sort === column ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  <a className={`desk-sort${sort === column ? " is-sorted" : ""}`} href={sortHrefs[column]}>
                    {COLUMN_LABELS[column]}
                    {sort === column ? <span aria-hidden="true">{dir === "asc" ? " ▲" : " ▼"}</span> : null}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td className="empty" colSpan={columns.length + 1}>
                  {empty}
                  {emptyHref ? <> <a href={emptyHref}>Clear filters</a></> : null}
                </td>
              </tr>
            ) : tickets.map((ticket, index) => (
              <tr
                key={ticket.id}
                ref={(node) => { rows.current[index] = node; }}
                className={[selected.has(ticket.id) ? "is-selected" : "", index === cursor ? "is-cursor" : ""].join(" ").trim() || undefined}
                onClick={() => setCursor(index)}
              >
                <td className="desk-check">
                  <input type="checkbox" checked={selected.has(ticket.id)} onChange={() => toggle(ticket.id)} aria-label={`Select ticket ${ticket.id}`} />
                </td>
                {columns.map((column) => (
                  <Cell key={column} column={column} ticket={ticket} busy={busy} onStatus={(status) => apply([ticket.id], { status })} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="desk-keys">
        Shortcuts: <kbd>J</kbd>/<kbd>K</kbd> move, <kbd>Enter</kbd> open, <kbd>R</kbd> reply, <kbd>N</kbd> note,
        {" "}<kbd>A</kbd> assign to me, <kbd>X</kbd> select
      </p>
    </>
  );
}

function Cell({ column, ticket, busy, onStatus }) {
  switch (column) {
    case "sla":
      return <td><Sla sla={ticket.sla} /></td>;
    case "id":
      return <td className="desk-id">#{ticket.id}</td>;
    case "subject":
      return (
        <td className="desk-subject">
          <a href={`/tickets/${ticket.id}`} title={ticket.subject}>{ticket.subject}</a>
          {ticket.commentCount ? <span className="desk-comments" title={`${ticket.commentCount} comments`}>{ticket.commentCount}</span> : null}
          {ticket.mergedIntoId ? <a className="desk-merged" href={`/tickets/${ticket.mergedIntoId}`}>Merged into #{ticket.mergedIntoId}</a> : null}
        </td>
      );
    case "contact":
      return <td className="desk-clip" title={ticket.customer?.contactName || undefined}>{ticket.customer?.contactName || "—"}</td>;
    case "account":
      return <td className="desk-clip" title={ticket.customer?.name || undefined}>{ticket.customer?.name || "—"}</td>;
    case "device":
      return <td className="desk-clip" title={ticket.device?.hostname || undefined}>{ticket.device?.hostname || "—"}</td>;
    case "category":
      return <td className="desk-clip" title={ticket.category || undefined}>{ticket.category || "—"}</td>;
    case "tags":
      return (
        <td className="desk-tags">
          {ticket.tags?.length ? ticket.tags.map((tag) => <span key={tag} className="desk-tag">{tag}</span>) : "—"}
        </td>
      );
    case "created":
      return <td>{when(ticket.createdAt)}</td>;
    case "lastActivity":
      return <td>{when(ticket.lastActivityAt)}</td>;
    case "due":
      return (
        <td className={ticket.overdue ? "desk-overdue" : undefined} title={ticket.overdue ? "Overdue" : undefined}>
          {ticket.dueAt ? when(ticket.dueAt) : "—"}
          {ticket.overdue ? <span className="sr-only">, overdue</span> : null}
        </td>
      );
    case "status":
      return (
        <td className="desk-status">
          <select
            className={`status-pick status-${ticket.status}`}
            value={ticket.status}
            title={ticket.statusLabel || undefined}
            disabled={busy}
            aria-label={`Status of ticket ${ticket.id}`}
            onChange={(event) => onStatus(event.target.value)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </td>
      );
    case "priority":
      return <td><span className={`chip priority-${ticket.priority}`}>{ticket.priority}</span></td>;
    case "owner":
      return (
        <td>
          <span className={ticket.assignee ? "desk-owner" : "desk-owner is-empty"}>
            <Avatar name={ticket.assignee?.name} />
            <span className="desk-owner-name" title={ticket.assignee?.name || undefined}>{ticket.assignee?.name || "Unassigned"}</span>
          </span>
        </td>
      );
    case "channel":
      return (
        <td>
          <span className="desk-channel" title={CHANNEL_LABELS[ticket.channel] || "Console"}>
            <ChannelIcon channel={ticket.channel} />
            <span className="sr-only">{CHANNEL_LABELS[ticket.channel] || "Console"}</span>
          </span>
        </td>
      );
    default:
      return <td />;
  }
}

function Sla({ sla }) {
  if (!sla || sla.state === "none") return <span className="sla sla-none" title="No SLA target running">—</span>;
  const target = sla.target === "response" ? "first response" : "resolution";
  const text = sla.state === "breached" ? `${duration(sla.minutesLeft)} over` : `${duration(sla.minutesLeft)} left`;
  return (
    <span className={`sla sla-${sla.state}`} title={`${SLA_LABELS[sla.state]}: ${target} due ${when(sla.dueAt)}`}>
      <span className="sla-dot" aria-hidden="true" />
      <span className="sla-text">{text}</span>
      <span className="sr-only">, {SLA_LABELS[sla.state]} for {target}</span>
    </span>
  );
}

function ColumnChooser({ columns, allColumns, locked }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(() => [...columns, ...allColumns.filter((column) => !columns.includes(column))]);
  const [shown, setShown] = useState(() => new Set(columns));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  if (locked) {
    return <span className="desk-tool is-muted" title="This saved view has its own columns.">Columns from this view</span>;
  }

  function move(index, by) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setOrder(next);
  }

  function flip(column) {
    const next = new Set(shown);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setShown(next);
  }

  function save(list) {
    setError("");
    startTransition(async () => {
      const result = await saveTicketColumns(list);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="desk-pop-wrap">
      <button type="button" className="desk-tool" aria-expanded={open} onClick={() => setOpen(!open)}>Columns</button>
      {open ? (
        <div className="desk-pop desk-columns" role="dialog" aria-label="Choose columns">
          <ol>
            {order.map((column, index) => (
              <li key={column}>
                <label className="desk-tick">
                  <input
                    type="checkbox"
                    checked={shown.has(column)}
                    disabled={column === "subject"}
                    onChange={() => flip(column)}
                  />
                  {COLUMN_LABELS[column]}
                </label>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${COLUMN_LABELS[column]} up`}>↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label={`Move ${COLUMN_LABELS[column]} down`}>↓</button>
              </li>
            ))}
          </ol>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="desk-pop-actions">
            <button type="button" onClick={() => save(order.filter((column) => shown.has(column)))} disabled={busy}>Save columns</button>
            <button type="button" className="desk-bulk-clear" onClick={() => save(null)} disabled={busy}>Reset</button>
          </div>
        </div>
      ) : null}
    </div>
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
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
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
