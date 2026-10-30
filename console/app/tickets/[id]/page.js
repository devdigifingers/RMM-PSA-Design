import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addTime, removeTime, runJob, saveTicketParent, saveTicketWatchers, toggleTicketWatch, updateTicket } from "../../actions";
import { ConsoleBar } from "../../bar";
import { RemoteActions } from "../../devices/remote-actions";
import { AppTitle } from "../../mark";
import { DeviceOptions, deviceGroups } from "../device-options";
import { fileExtension, fileSize, formatWhen, workTime } from "../format";
import { CHANNEL_CHOICES, dueInputValue, dueLabel, PRIORITY_KEYS, StatusOptions, statusValue } from "../ticket-fields";
import { Composer } from "./composer";
import { TicketShortcuts } from "./shortcuts";
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
  watch: "You are watching this ticket.",
  unwatch: "You stopped watching this ticket.",
  watchers: "Watchers saved.",
  parent: "Parent ticket linked.",
  parentRemoved: "Parent ticket removed.",
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
  const error = query?.message ? String(query.message) : query?.error ? ERRORS[query.error] || String(query.error) : "";
  const priorityLabels = body.priorityLabels || {};
  const contactNames = new Map((body.contacts || []).map((item) => [item.id, item.name]));
  const latestEvent = timeline.length ? timeline[timeline.length - 1].id : 0;

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href="/tickets">← All Tickets</a></p>
        <h1><AppTitle app="service-desk"><span className="desk-id">#{ticket.id}</span> {ticket.subject}</AppTitle></h1>
        <p className="ticket-tags">
          <span className={`chip status-${ticket.status}`}>{ticket.statusLabel || ticket.status}</span>
          <span className={`chip priority-${ticket.priority}`}>{priorityLabels[ticket.priority] || ticket.priority}</span>
          {ticket.channel && ticket.channel !== "console" ? <span className="dash-chip">{CHANNEL_LABELS[ticket.channel] || ticket.channel}</span> : null}
          {time.totalMinutes ? <span className="dash-chip">{`Time ${workTime(time.totalMinutes)}`}</span> : null}
          {ticket.category ? <span className="dash-chip">{ticket.category}</span> : null}
          {(ticket.tags || []).map((tag) => <span key={tag} className="desk-tag">{tag}</span>)}
          {ticket.rating ? (
            <span className={`chip rating-${ticket.rating.rating}`} title={ticket.rating.comment || undefined}>
              Customer rated {RATING_LABELS[ticket.rating.rating]}
            </span>
          ) : null}
        </p>
        {ticket.rating?.comment ? <p className="ticket-rating-note">&ldquo;{ticket.rating.comment}&rdquo;</p> : null}
        {ticket.mergedIntoId ? (
          <p className="ticket-merged" role="note">
            This ticket was merged into <a href={`/tickets/${ticket.mergedIntoId}`}>#{ticket.mergedIntoId}</a>. Carry on the conversation there.
          </p>
        ) : null}
        {ticket.movedTo ? (
          <p className="ticket-merged" role="note">
            This ticket was moved to {ticket.movedTo} and is read-only here. It is removed 30 days after the move.
          </p>
        ) : null}
        <TicketShortcuts ticketId={ticket.id} me={body.me} assigned={ticket.assignee?.id === body.me} />
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
                {ticket.status !== "resolved" && body.clock.resolveDueAt ? (
                  <span className="dash-chip">
                    {body.clock.paused ? "SLA paused (pending)" : `Due ${dueLabel(body.clock.resolveDueAt)}${body.clock.dueOverridden ? " (set by hand)" : ""}`}
                  </span>
                ) : null}
              </p>
            ) : null}
            {!body.clock && ticket.dueAt && ticket.status !== "resolved" ? (
              <p className="ticket-tags"><span className="dash-chip">Due {dueLabel(ticket.dueAt)}</span></p>
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

            <Composer
              key={`compose-${latestEvent}`}
              ticketId={ticket.id}
              initialKind={query?.compose}
              canned={body.canned || []}
              variables={{
                "contact.name": ticket.customer.contactName || "",
                "ticket.id": String(ticket.id),
                "agent.name": users.find((user) => user.id === body.me)?.name || "",
              }}
            />
            {(ticket.cc || []).length ? (
              <p className="org-name">CC: {ticket.cc.map((id) => contactNames.get(id) || "a removed contact").join(", ")}</p>
            ) : null}

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
              <form key={`details-${latestEvent}`} className="stack ticket-details" action={updateTicket}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <input type="hidden" name="currentDeviceId" value={ticket.device?.id || ""} />
                <label>
                  Status
                  <select name="status" defaultValue={statusValue(ticket)}>
                    <StatusOptions statuses={body.statuses || []} />
                  </select>
                </label>
                <label>
                  Priority
                  <select name="priority" defaultValue={ticket.priority}>
                    {PRIORITY_KEYS.map((key) => (
                      <option key={key} value={key}>{priorityLabels[key] || PRIORITY[key]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Due date override
                  <input type="datetime-local" name="dueAt" defaultValue={dueInputValue(ticket.dueAt)} />
                  <small className="field-hint">Leave empty to use the SLA due time.</small>
                </label>
                <label>
                  Channel
                  <select name="channel" defaultValue={CHANNEL_CHOICES.some(([value]) => value === ticket.channel) ? ticket.channel : ""}>
                    {CHANNEL_CHOICES.some(([value]) => value === ticket.channel) ? null : (
                      <option value="">{CHANNEL_LABELS[ticket.channel] || "Console"}</option>
                    )}
                    {CHANNEL_CHOICES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
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
                {(body.contacts || []).length > 1 || (ticket.cc || []).length ? (
                  <fieldset className="ticket-cc">
                    <legend>CC contacts</legend>
                    <input type="hidden" name="ccField" value="1" />
                    {(body.contacts || []).map((item) => (
                      <label key={item.id} className="check">
                        <input type="checkbox" name="cc" value={item.id} defaultChecked={(ticket.cc || []).includes(item.id)} />
                        {item.name}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <label>
                  Affected device
                  <select name="deviceId" defaultValue={ticket.device?.id || ""}>
                    <DeviceOptions groups={withCurrentDevice(deviceGroups(body.devices || [], ticket.customer.id, (body.contacts || []).find((item) => item.id === ticket.customer.contactId) || null), ticket.device)} />
                  </select>
                </label>
                <label>
                  Category
                  <input name="category" list="ticket-categories" defaultValue={ticket.category || ""} maxLength={60} placeholder="e.g. Network" />
                  <datalist id="ticket-categories">
                    {(body.categories || []).map((item) => <option key={item} value={item} />)}
                  </datalist>
                </label>
                <label>
                  Tags
                  <input name="tags" list="ticket-tags" defaultValue={(ticket.tags || []).join(", ")} placeholder="Comma separated" />
                  <datalist id="ticket-tags">
                    {(body.tagChoices || []).map((item) => <option key={item} value={item} />)}
                  </datalist>
                </label>
                <button type="submit">Save</button>
              </form>
            </section>

            <LinksCard ticket={ticket} users={users} me={body.me} />

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

function LinksCard({ ticket, users, me }) {
  const watchers = ticket.watchers || [];
  const children = ticket.children || [];
  return (
    <section className="job ticket-links">
      <h2>Links and watchers</h2>
      <form action={toggleTicketWatch} className="ticket-watch">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <input type="hidden" name="watching" value={String(Boolean(ticket.watching))} />
        <button type="submit" className={ticket.watching ? "secondary" : undefined}>{ticket.watching ? "Stop Watching" : "Watch"}</button>
        <span className="org-name">
          {watchers.length ? `${watchers.length} watching` : "Nobody is watching"}
        </span>
      </form>
      {ticket.parent ? (
        <p className="ticket-link-row">
          Part of <a href={`/tickets/${ticket.parent.id}`}>#{ticket.parent.id} {ticket.parent.subject}</a>
          <span className={`chip status-${ticket.parent.status}`}>{STATUS[ticket.parent.status] || ticket.parent.status}</span>
        </p>
      ) : null}
      {children.length ? (
        <ul className="ticket-children" aria-label="Child tickets">
          {children.map((child) => (
            <li key={child.id}>
              <a href={`/tickets/${child.id}`}>#{child.id} {child.subject}</a>
              <span className={`chip status-${child.status}`}>{STATUS[child.status] || child.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={saveTicketParent} className="stack ticket-details desk-one">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <label>
          Parent ticket
          <input name="parentId" inputMode="numeric" defaultValue={ticket.parent ? ticket.parent.id : ""} placeholder="Ticket number, e.g. 42" />
          <small className="field-hint">Link this ticket under a bigger one. Leave empty to unlink.</small>
        </label>
        <button type="submit">Save Parent</button>
      </form>
      <details className="time-add">
        <summary>Choose watchers</summary>
        <form action={saveTicketWatchers} className="stack ticket-details desk-one">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <fieldset className="ticket-cc">
            <legend>Watchers get an in-app notice for replies, notes and status changes</legend>
            {users.map((user) => (
              <label key={user.id} className="check">
                <input type="checkbox" name="watcher" value={user.id} defaultChecked={watchers.includes(user.id)} />
                {user.id === me ? `${user.name} (you)` : user.name}
              </label>
            ))}
          </fieldset>
          <button type="submit">Save Watchers</button>
        </form>
      </details>
    </section>
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
        {item.mergedFrom ? <a className="desk-merged" href={`/tickets/${item.mergedFrom}`}>from #{item.mergedFrom}</a> : null}
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
const EMAIL_TEMPLATES = {
  breach: "sent the SLA breach email to the team",
  sla_breach: "sent the SLA breach email to the team",
  sla_warning: "sent the SLA warning email to the team",
  new_ticket: "sent the new ticket email to the team",
  assigned: "sent the assignment email",
  customer_reply: "sent the customer reply email to the team",
  agent_reply: "emailed the reply to the customer",
  acknowledgement: "emailed the customer that the ticket was received",
  resolved: "emailed the customer that the ticket was resolved",
  resolved_csat: "emailed the customer that the ticket was resolved, with a rating link",
};
const RATING_LABELS = { good: "Good", ok: "OK", bad: "Bad" };
const CHANNEL_LABELS = {
  phone: "Phone",
  email: "Email",
  walk_in: "Walk-in",
  portal: "Portal",
  remote: "Remote session",
  console: "Console",
  alert: "Alert",
  automatic: "Automatic",
  support: "Support session",
};
function eventLine(item) {
  switch (item.kind) {
    case "created":
      return "created the ticket";
    case "reply":
      return item.email ? "replied by email" : "replied";
    case "csat":
      return `rated the support ${RATING_LABELS[item.rating] || item.rating}`;
    case "migrated":
      return item.rollback ? `brought this ticket back from DF-#${item.from} (migration rollback)` : `migrated this ticket from DF-#${item.from}${item.sourceTenant ? ` in ${item.sourceTenant}` : ""}`;
    case "automation":
      return `ran the "${item.rule}" automation`;
    case "parent":
      if (!item.to) return `unlinked the parent ticket #${item.from}`;
      return `linked this ticket under #${item.to}`;
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
    case "sla_warning":
      return item.target === "response" ? "warned that the response SLA is due soon" : "warned that the resolve SLA is due soon";
    case "due":
      return item.to ? `set the due date to ${dueLabel(item.to)}` : "cleared the due date override";
    case "channel":
      return `set the channel to ${CHANNEL_LABELS[item.to] || item.to}`;
    case "cc":
      return item.to?.length ? `set CC to ${item.to.join(", ")}` : "removed everyone from CC";
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
      return EMAIL_TEMPLATES[item.template] || "sent a notification email";
    case "category":
      return item.to ? `set the category to ${item.to}` : "cleared the category";
    case "tags":
      return tagChange(item.from || [], item.to || []);
    case "merged":
      return `merged this ticket into #${item.into}`;
    case "merged_from":
      return `merged ${(item.tickets || []).map((id) => `#${id}`).join(", ")} into this ticket`;
    default:
      return item.kind;
  }
}

function tagChange(from, to) {
  const added = to.filter((tag) => !from.includes(tag));
  const removed = from.filter((tag) => !to.includes(tag));
  const parts = [];
  if (added.length) parts.push(`added the tag${added.length > 1 ? "s" : ""} ${added.join(", ")}`);
  if (removed.length) parts.push(`removed the tag${removed.length > 1 ? "s" : ""} ${removed.join(", ")}`);
  return parts.join(" and ") || "updated the tags";
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
