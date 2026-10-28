import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addTime, removeTime, runJob, updateTicket } from "../../actions";
import { ConsoleBar } from "../../bar";
import { RemoteActions } from "../../devices/remote-actions";
import { AppTitle } from "../../mark";
import { DeviceOptions, deviceGroups } from "../device-options";
import { fileExtension, fileSize, formatWhen, workTime } from "../format";
import { Composer } from "./composer";
import { TicketTimer } from "./timer";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const FILTERS = [
  ["all", "All"],
  ["replies", "Replies"],
  ["notes", "Notes"],
  ["changes", "Changes"],
  ["remote", "Remote and commands"],
  ["time", "Time"],
  ["sla", "SLA"],
  ["email", "Emails"],
];

const SAVED = {
  time: "Time logged.",
  timeRemoved: "Time entry removed.",
};

const ERRORS = {
  remote: "Remote desktop is not available for this device.",
  update: "That change could not be saved.",
  job: "That command could not be run.",
  comment: "That could not be saved.",
};

export default async function TicketPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/tickets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/tickets");
  const body = await response.json();
  const ticket = body.ticket;
  const users = body.users || [];
  const timeline = body.timeline || [];
  const time = body.time || { entries: [], totalMinutes: 0, billableMinutes: 0, timerStartedAt: null };
  const show = FILTERS.some(([key]) => key === query?.show) ? query.show : "all";
  const counts = Object.fromEntries(FILTERS.map(([key]) => [key, key === "all" ? timeline.length : timeline.filter((item) => item.group === key).length]));
  const shown = (show === "all" ? timeline : timeline.filter((item) => item.group === show)).slice().reverse();
  const error = query?.error ? ERRORS[query.error] || String(query.error) : "";
  const latestEvent = timeline.length ? timeline[timeline.length - 1].id : 0;

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href="/tickets">← All Tickets</a></p>
        <h1><AppTitle app="service-desk"><span className="desk-id">#{ticket.id}</span> {ticket.subject}</AppTitle></h1>
        <p className="ticket-tags">
          <span className={`chip status-${ticket.status}`}>{ticket.status}</span>
          <span className={`chip priority-${ticket.priority}`}>{ticket.priority}</span>
          {time.totalMinutes ? <span className="dash-chip">{`Time ${workTime(time.totalMinutes)}`}</span> : null}
        </p>
        <div className="ticket-layout">
          <div className="ticket-body">
            <p className="org-name">
              {ticket.customer.name} · {ticket.device ? ticket.device.hostname : "No specific device"}
            </p>
            {ticket.customer.contactName ? (
              <p className="org-name">{[ticket.customer.contactName, ticket.customer.contactEmail].filter(Boolean).join(" · ")}</p>
            ) : null}
            {body.clock ? (
              <p className="ticket-tags">
                <Clock label="Response" used={body.clock.responseElapsed} target={body.clock.responseMinutes} />
                <Clock label="Resolve" used={body.clock.resolveElapsed} target={body.clock.resolveMinutes} />
              </p>
            ) : null}
            {body.canRemote && ticket.device?.hasRemote ? (
              <div className="ticket-remote">
                <RemoteActions
                  deviceId={ticket.device.id}
                  hostname={ticket.device.hostname}
                  label={ticket.device.displayName}
                  users={ticket.device.users || []}
                  ticketId={ticket.id}
                  connectOnly
                />
              </div>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
            {SAVED[query?.saved] ? <p className="org-name cust-saved">{SAVED[query.saved]}</p> : null}

            <Composer key={`compose-${latestEvent}`} ticketId={ticket.id} initialKind={query?.compose} />

            <section className="job ticket-timeline" aria-label="Activity">
              <header className="timeline-head">
                <h2>Activity</h2>
                <nav className="timeline-filters" aria-label="Filter activity">
                  {FILTERS.filter(([key]) => key === "all" || counts[key] > 0).map(([key, label]) => (
                    <a key={key} href={key === "all" ? `/tickets/${ticket.id}` : `/tickets/${ticket.id}?show=${key}`} aria-current={show === key ? "page" : undefined}>
                      {label} <span>{counts[key]}</span>
                    </a>
                  ))}
                </nav>
              </header>
              {shown.length === 0 ? <p className="org-name">Nothing here yet.</p> : null}
              <ol className="timeline">
                {shown.map((item) => <TimelineEntry key={item.id} item={item} />)}
              </ol>
            </section>
          </div>

          <div className="ticket-side">
            <section className="job">
              <h2>Details</h2>
              <form className="stack ticket-details" action={updateTicket}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <input type="hidden" name="currentDeviceId" value={ticket.device?.id || ""} />
                <label>
                  Status
                  <select name="status" defaultValue={ticket.status}>
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select name="priority" defaultValue={ticket.priority}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label>
                  Ticket owner
                  <select name="assigneeUserId" defaultValue={ticket.assignee?.id || ""}>
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Contact
                  <select name="contactId" defaultValue={ticket.customer.contactId || ""}>
                    <option value="">No contact</option>
                    {(body.contacts || []).map((item) => (
                      <option key={item.id} value={item.id}>{item.primary ? `${item.name} (primary)` : item.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Affected device
                  <select name="deviceId" defaultValue={ticket.device?.id || ""}>
                    <DeviceOptions groups={withCurrentDevice(deviceGroups(body.devices || [], ticket.customer.id, (body.contacts || []).find((item) => item.id === ticket.customer.contactId) || null), ticket.device)} />
                  </select>
                </label>
                <button type="submit">Save</button>
              </form>
            </section>

            <TimeCard ticketId={ticket.id} time={time} />

            {body.canRunCommands && ticket.device ? (
              <section className="job">
                <h2>Command</h2>
                <form className="stack ticket-details" action={runJob}>
                  <input type="hidden" name="deviceId" value={ticket.device.id} />
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <label>
                    Command
                    <input name="command" defaultValue={defaultCommand(ticket.device.osName)} required />
                  </label>
                  <button type="submit">Run</button>
                </form>
                {ticket.latestJob ? (
                  <pre className="output">{ticket.latestJob.status === "finished" ? ticket.latestJob.output : ticket.latestJob.status}</pre>
                ) : null}
              </section>
            ) : null}

            <CustomerPanel summary={body.customerSummary} fallback={ticket.customer} />
          </div>
        </div>
      </main>
    </div>
  );
}

function TimeCard({ ticketId, time }) {
  return (
    <section className="job time-card">
      <h2>Time</h2>
      <p className="time-total">
        <strong>{workTime(time.totalMinutes)}</strong>
        <span>{time.billableMinutes === time.totalMinutes ? "all billable" : `${workTime(time.billableMinutes)} billable`}</span>
      </p>
      <TicketTimer ticketId={ticketId} startedAt={time.timerStartedAt} />
      <details className="time-add">
        <summary>Log time manually</summary>
        <form className="stack ticket-details" action={addTime}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <label>
            Minutes
            <input name="minutes" type="number" min="1" max="1440" required />
          </label>
          <label>
            Note
            <input name="note" maxLength={500} placeholder="What was done" />
          </label>
          <label className="cust-check">
            <input type="checkbox" name="billable" defaultChecked />
            Billable
          </label>
          <button type="submit">Log Time</button>
        </form>
      </details>
      {time.entries.length ? (
        <ul className="time-entries">
          {time.entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{workTime(entry.minutes)}</strong>
                <span className={entry.billable ? "time-billable" : "time-free"}>{entry.billable ? "Billable" : "Not billable"}</span>
                {entry.source === "timer" ? <span className="time-free">Timer</span> : null}
              </div>
              <p>{entry.userName} · {formatWhen(entry.createdAt)}</p>
              {entry.note ? <p>{entry.note}</p> : null}
              {entry.canDelete ? (
                <form action={removeTime}>
                  <input type="hidden" name="ticketId" value={ticketId} />
                  <input type="hidden" name="entryId" value={entry.id} />
                  <button type="submit" className="danger-link">Remove</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="org-name">No time logged yet.</p>}
    </section>
  );
}

function TimelineEntry({ item }) {
  const note = item.kind === "note";
  return (
    <li className={`timeline-item is-${item.group}${note ? " is-note" : ""}`}>
      <div className="timeline-meta">
        <strong>{item.actor}</strong>
        <span>{eventLine(item)}</span>
        {note ? <span className="note-badge">Internal note</span> : null}
        <time dateTime={item.createdAt}>{formatWhen(item.createdAt)}</time>
      </div>
      {item.body ? <p className="timeline-body">{item.body}</p> : null}
      {item.attachments?.length ? <Attachments files={item.attachments} /> : null}
      {item.kind === "command" ? <code className="timeline-code">{item.command}</code> : null}
      {item.kind === "command_result" && item.output ? (
        <details className="timeline-output">
          <summary>Output</summary>
          <pre className="output">{item.output}</pre>
        </details>
      ) : null}
      {item.kind === "time" && item.note ? <p className="timeline-body">{item.note}</p> : null}
    </li>
  );
}

function Attachments({ files }) {
  return (
    <ul className="attachment-list">
      {files.map((file) => (
        <li key={file.id}>
          <a href={`/tickets/attachments/${file.id}`} target="_blank" rel="noopener noreferrer">
            {file.isImage ? <img src={`/tickets/attachments/${file.id}`} alt={file.name} loading="lazy" /> : <span className="file-icon" aria-hidden="true">{fileExtension(file.name)}</span>}
            <span className="file-name">{file.name}</span>
            <span className="file-meta">{fileSize(file.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const STATUS = { open: "Open", pending: "Pending", resolved: "Resolved" };
const PRIORITY = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

function eventLine(item) {
  switch (item.kind) {
    case "created":
      return "created the ticket";
    case "reply":
      return "replied";
    case "note":
      return "added a note";
    case "status":
      return `changed the status from ${STATUS[item.from] || item.from || "none"} to ${STATUS[item.to] || item.to}`;
    case "priority":
      return `changed the priority from ${PRIORITY[item.from] || item.from || "none"} to ${PRIORITY[item.to] || item.to}`;
    case "assignee":
      if (!item.to) return `unassigned the ticket${item.from ? ` from ${item.from}` : ""}`;
      return item.from ? `reassigned the ticket from ${item.from} to ${item.to}` : `assigned the ticket to ${item.to}`;
    case "contact":
      return item.to ? `set the contact to ${item.to}` : "removed the contact";
    case "device":
      return item.to ? `set the affected device to ${item.to}` : "removed the affected device";
    case "sla_breach":
      return item.target === "response" ? "flagged a response SLA breach" : "flagged a resolve SLA breach";
    case "remote_start":
      return `started a remote session${item.device ? ` on ${item.device}` : ""}${item.user ? ` as ${item.user}` : ""}`;
    case "remote_end":
      return `remote session ended after about ${workTime(item.minutes)}`;
    case "command":
      return "ran a command";
    case "command_result":
      return `finished the command with exit code ${item.exitCode ?? "unknown"}`;
    case "time":
      return `logged ${workTime(item.minutes)}${item.billable === false ? " (not billable)" : " (billable)"}`;
    case "time_removed":
      return `removed ${workTime(item.minutes)} of logged time`;
    case "email":
      return item.template === "breach" ? "sent the SLA breach email to the team" : "sent the new ticket email to the team";
    default:
      return item.kind;
  }
}

function CustomerPanel({ summary, fallback }) {
  const customer = summary || { id: fallback.id, name: fallback.name };
  const contact = summary?.primaryContact;
  return (
    <aside className="job cust-panel" aria-label="Customer">
      <h2>Customer</h2>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{customer.name}</dd>
        </div>
        <div>
          <dt>Primary contact</dt>
          <dd>{contact ? [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ") : "None"}</dd>
        </div>
        {summary?.deviceCount != null ? (
          <div>
            <dt>Devices</dt>
            <dd>{summary.deviceCount}</dd>
          </div>
        ) : null}
        {summary?.openTicketCount != null ? (
          <div>
            <dt>Open tickets</dt>
            <dd>{summary.openTicketCount}</dd>
          </div>
        ) : null}
      </dl>
      <a href={`/desk/customers/${customer.id}?tab=time`}>Customer time entries</a>
      <a href={`/desk/customers/${customer.id}`}>Open customer</a>
    </aside>
  );
}

function withCurrentDevice(groups, device) {
  if (!device || groups.some((group) => group.items.some((item) => item.id === device.id))) return groups;
  return [{ label: "Current device", items: [{ id: device.id, hostname: device.hostname }] }, ...groups];
}

function defaultCommand(osName) {
  return /windows/i.test(osName || "") ? "ver" : "uname -srm";
}

function Clock({ label, used, target }) {
  const over = Number(used) > Number(target);
  return <span className={over ? "dash-chip bad" : "dash-chip"}>{`${label} ${duration(used)} / ${duration(target)}`}</span>;
}

function duration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours}h ${total % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
