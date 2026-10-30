import { notFound } from "next/navigation";
import { formatWhen } from "../account-data";
import {
  addContact,
  assignAsset,
  deleteContact,
  deleteCustomer,
  linkAsset,
  saveAccount,
  saveContact,
  saveCustomerNotes,
  saveCustomerSla,
  unlinkAsset,
} from "../actions";
import { ConsoleBar } from "../bar";
import { RemoteActions } from "../devices/remote-actions";
import { workTime } from "../tickets/format";
import {
  AccountFields,
  apiGet,
  ContactFields,
  CustomerSide,
  customersBase,
  initials,
  kindLabel,
  minutesLabel,
  ReadOnlyNote,
  SubLine,
} from "./shared";

const SAVED = {
  created: "Customer created.",
  account: "Customer saved.",
  notes: "Notes saved.",
  sla: "SLA and contract saved.",
  contact: "Contact saved.",
  removed: "Contact removed.",
  linked: "Device linked to this customer.",
  unlinked: "Device unlinked from this customer.",
  assigned: "Device assignment saved.",
};

const PRESENCE = { online: "Online", rebooting: "Rebooting", offline: "Offline" };

const OVERVIEW_FIELDS = [
  ["website", "Website"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["altPhone", "Alternative contact number"],
  ["registrationNumber", "Registration number"],
  ["vatNumber", "VAT number"],
  ["address", "Physical address"],
];

export async function CustomerRecord({ app, params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const base = customersBase(app);
  const response = await apiGet(`/v1/accounts/${Number(id) || 0}?view=${app}`);
  if (response.status === 404) notFound();
  const body = await response.json();
  const { account, contacts = [], tickets = [], devices = [], linkable = [], sessions = [], report, sla, crossLink } = body;
  const time = body.time || { totalMinutes: 0, billableMinutes: 0, entries: [] };
  const readOnly = body.readOnly === true || account.movedAway === true;
  const manage = body.canOperate && !readOnly;
  const remote = app === "remote";
  const insights = body.insights || null;
  const tabs = remote
    ? [
      ["overview", "Overview", null],
      ["devices", "Devices", devices.length],
      ["sessions", "Sessions", sessions.length],
      ["contacts", "Contacts", contacts.length],
      ["notes", "Notes", null],
    ]
    : [
      ["overview", "Overview", null],
      ["history", "History", null],
      ["tickets", "Tickets", tickets.length],
      ["time", "Time Entry", time.entries.length],
      ["contacts", "Contacts", contacts.length],
      ...(insights?.deskDevices ? [["devices", "Devices", insights.deskDevices.length]] : []),
      ["sla", "SLA / contract", null],
      ["attachments", "Attachments", insights ? insights.attachments.length : null],
      ["notes", "Notes", null],
    ];
  const tab = tabs.some(([key]) => key === query?.tab) ? query.tab : "overview";
  const primary = contacts.find((contact) => contact.primary);
  const online = devices.filter((device) => device.presence === "online").length;
  const connectable = devices.filter((device) => device.hasRemote);
  const href = (key) => `${base}/${account.id}?tab=${key}`;

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide app={app} active="accounts" />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href={base}>← All customers</a></p>
          <header className="cust-head">
            <span className="cust-avatar is-large" aria-hidden="true">{initials(account.name)}</span>
            <div>
              <h1>
                {account.name} <span className="chip">{kindLabel(account.kind)}</span>
                {crossLink && remote ? (
                  <a className="cust-cross" href={`/desk/customers/${account.id}?tab=tickets`} title="Open in Service Desk">
                    Open tickets: {crossLink.openTickets}
                  </a>
                ) : null}
                {crossLink && !remote ? (
                  <a className="cust-cross" href={`/remote/customers/${account.id}?tab=devices`} title="Open in Remote Desk">
                    Devices: {crossLink.devices}
                  </a>
                ) : null}
              </h1>
              <SubLine items={[account.website, account.email, account.phone, primary ? `Primary contact: ${primary.name}` : null]} />
            </div>
            <div className="cust-head-actions">
              {remote ? (
                <>
                  {readOnly ? null : <a className="cust-action" href={`${href("contacts")}#add-contact`}>Add contact</a>}
                  {body.canRemote && connectable.length === 1 ? (
                    <RemoteActions
                      deviceId={connectable[0].id}
                      hostname={connectable[0].hostname}
                      label={connectable[0].displayName}
                      users={connectable[0].users || []}
                      connectOnly
                    />
                  ) : null}
                  {body.canRemote && connectable.length > 1 ? (
                    <a className="desk-new" href={`${href("devices")}#devices`}>Start session</a>
                  ) : null}
                  {manage ? <a className="cust-action" href={`${href("devices")}#assign`}>Assign device</a> : null}
                  {readOnly ? null : <a className="cust-action" href={`/agent/windows?customer=${account.id}`}>Download agent installer</a>}
                </>
              ) : (
                <>
                  {readOnly ? null : <a className="cust-action" href={`${href("contacts")}#add-contact`}>Add contact</a>}
                  {readOnly ? null : (
                    <a className="desk-new" href={`/tickets/new?customer=${account.id}`}>
                      <span aria-hidden="true">+</span> New Ticket
                    </a>
                  )}
                </>
              )}
            </div>
          </header>
          {account.movedAway ? (
            <p className="cust-readonly" role="status">This customer was moved to another organisation and is read-only here. It is removed 30 days after the move.</p>
          ) : <ReadOnlyNote show={readOnly} />}
          <nav className="cust-tabs" aria-label="Customer sections">
            {tabs.map(([key, label, count]) => (
              <a key={key} href={href(key)} className={tab === key ? "is-active" : undefined} aria-current={tab === key ? "page" : undefined}>
                {label}
                {count != null ? <span className="desk-count">{count}</span> : null}
              </a>
            ))}
          </nav>
          {query?.error ? <p className="error">{String(query.error)}</p> : null}
          {SAVED[query?.saved] ? <p className="org-name cust-saved">{SAVED[query.saved]}</p> : null}

          {tab === "overview" ? (
            <>
              <dl className="cust-stats">
                <div><dt>Primary contact</dt><dd className="cust-stat-text">{primary ? primary.name : "—"}</dd></div>
                <div><dt>Contacts</dt><dd>{contacts.length}</dd></div>
                {remote ? (
                  <>
                    <div><dt>Devices</dt><dd>{devices.length}</dd></div>
                    <div><dt>Online now</dt><dd>{online}</dd></div>
                    <div><dt>Last session</dt><dd className="cust-stat-text">{sessions[0] ? formatWhen(sessions[0].at) : "—"}</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>All tickets</dt><dd>{insights?.overview.total ?? tickets.length}</dd></div>
                    <div><dt>Open</dt><dd>{insights?.overview.open ?? report?.ticketsOpen ?? 0}</dd></div>
                    <div><dt>Overdue</dt><dd className={report?.ticketsOverdue ? "desk-overdue" : undefined}>{report?.ticketsOverdue ?? 0}</dd></div>
                    <div>
                      <dt>Happiness</dt>
                      <dd className={insights?.overview.happiness.total ? undefined : "cust-stat-text"}>
                        {insights?.overview.happiness.total ? `${insights.overview.happiness.score}%` : "No ratings"}
                      </dd>
                    </div>
                    <div><dt>SLA plan</dt><dd className="cust-stat-text">{sla?.planName || "None set"}</dd></div>
                  </>
                )}
              </dl>
              {!remote && insights ? (
                <DeskOverview insights={insights} tickets={tickets} panel={query?.panel} href={href("overview")} />
              ) : null}
              {readOnly ? (
                <dl className="cust-overview">
                  {OVERVIEW_FIELDS.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{account[key] || "—"}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Created</dt>
                    <dd>{formatWhen(account.createdAt)}</dd>
                  </div>
                </dl>
              ) : (
                <>
                  <form className="cust-form" action={saveAccount}>
                    <input type="hidden" name="app" value={app} />
                    <input type="hidden" name="accountId" value={account.id} />
                    <section className="job">
                      <AccountFields account={account} />
                    </section>
                    <div className="cust-actions">
                      <button type="submit">Save Customer</button>
                    </div>
                  </form>
                  {body.canDelete ? (
                    <form className="cust-danger" action={deleteCustomer}>
                      <input type="hidden" name="app" value={app} />
                      <input type="hidden" name="accountId" value={account.id} />
                      <p>
                        <strong>Delete this customer</strong>
                        <span className="org-name">Only possible once it has no {crossLink ? "tickets or devices" : remote ? "devices" : "tickets"}. Its contacts are deleted with it.</span>
                      </p>
                      <label className="cust-check">
                        <input type="checkbox" name="confirm" required />
                        Delete {account.name}
                      </label>
                      <button type="submit" className="danger-link">Delete customer</button>
                    </form>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {tab === "contacts" ? (
            <ContactsTab app={app} account={account} contacts={contacts} devices={devices} readOnly={readOnly} />
          ) : null}

          {tab === "notes" ? (
            readOnly ? (
              <div className="job cust-notes">{account.notes ? <p>{account.notes}</p> : <p className="org-name">No notes on this customer.</p>}</div>
            ) : (
              <form className="cust-form" action={saveCustomerNotes}>
                <input type="hidden" name="app" value={app} />
                <input type="hidden" name="accountId" value={account.id} />
                <section className="job">
                  <label className="cust-wide">
                    Notes
                    <textarea name="notes" rows={10} maxLength={4000} defaultValue={account.notes || ""} placeholder="Anything the team should know about this customer." />
                  </label>
                  {crossLink ? <p className="org-name">Shared by Remote Desk and Service Desk.</p> : null}
                </section>
                <div className="cust-actions">
                  <button type="submit">Save Notes</button>
                </div>
              </form>
            )
          ) : null}

          {tab === "devices" && remote ? (
            <>
              <p className="org-name" id="devices">Devices that belong to this customer. Assign a device to the contact who uses it; leave servers and shared machines unassigned. When a contact logs a call, their own devices are offered first.</p>
              <div className="systems cust-assets">
                <table>
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Assigned to</th>
                      <th>Status</th>
                      <th>Logged on</th>
                      <th>Operating system</th>
                      <th>IP address</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {devices.length === 0 ? (
                      <tr><td className="empty" colSpan={7}>No devices linked yet.</td></tr>
                    ) : devices.map((device) => (
                      <tr key={device.id}>
                        <td><a href={`/devices?q=${encodeURIComponent(device.hostname)}`}>{device.displayName}</a></td>
                        <td>
                          {readOnly ? (
                            contacts.find((contact) => contact.id === device.contactId)?.name || "Shared"
                          ) : (
                            <>
                              <form className="cust-assign" action={assignAsset}>
                                <input type="hidden" name="accountId" value={account.id} />
                                <input type="hidden" name="deviceId" value={device.id} />
                                <select name="contactId" defaultValue={device.contactId || ""} aria-label={`Assign ${device.displayName}`}>
                                  <option value="">Shared (not assigned)</option>
                                  {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                                </select>
                                <button type="submit" className="cust-mini">Save</button>
                              </form>
                              {device.suggestedContact ? (
                                <form className="cust-suggest" action={assignAsset}>
                                  <input type="hidden" name="accountId" value={account.id} />
                                  <input type="hidden" name="deviceId" value={device.id} />
                                  <input type="hidden" name="contactId" value={device.suggestedContact.id} />
                                  <span>Suggested: {device.suggestedContact.name}</span>
                                  <button type="submit" className="cust-mini">Assign</button>
                                </form>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td><span className={`chip presence-${device.presence}`}>{PRESENCE[device.presence] || "Offline"}</span></td>
                        <td className="desk-clip" title={device.users.join(", ") || undefined}>{device.users.join(", ") || "—"}</td>
                        <td>{device.osName || "—"}</td>
                        <td>{device.ipv4 || "—"}</td>
                        <td className="cust-device-actions">
                          {body.canRemote && device.hasRemote ? (
                            <RemoteActions deviceId={device.id} hostname={device.hostname} label={device.displayName} users={device.users || []} connectOnly />
                          ) : null}
                          {manage ? (
                            <form action={unlinkAsset}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <input type="hidden" name="deviceId" value={device.id} />
                              <button type="submit" className="danger-link">Unlink</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {manage ? (
                <div className="cust-asset-tools" id="assign">
                  <form className="cust-link" action={linkAsset}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <label>
                      Assign an existing device
                      <select name="deviceId" required defaultValue="">
                        <option value="" disabled>Choose a device…</option>
                        {linkable.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.accountName ? `${device.name} · moves from ${device.accountName}` : `${device.name} · not linked`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" disabled={!linkable.length}>Assign Device</button>
                  </form>
                  <div className="cust-link">
                    <p>
                      <strong>Enrol a new computer for this customer</strong>
                      <span className="org-name">The installer is tagged to {account.name}, so the computer lands straight on this customer.</span>
                    </p>
                    <a className="deploy-download" href={`/agent/windows?customer=${account.id}`}>Download for Windows</a>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "sessions" && remote ? (
            <div className="systems desk-table cust-tickets">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Device</th>
                    <th>Technician</th>
                    <th>Signed-in user</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr><td className="empty" colSpan={5}>No remote sessions on this customer&apos;s devices yet.</td></tr>
                  ) : sessions.map((session, index) => (
                    <tr key={`${session.at}-${index}`}>
                      <td>{formatWhen(session.at)}</td>
                      <td>{session.kind === "support" ? "Support code" : "Remote desktop"}</td>
                      <td>{session.deviceName || "—"}</td>
                      <td>{session.technician || "—"}</td>
                      <td>{session.user || (session.kind === "support" && session.status ? session.status : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "tickets" && !remote ? (
            <div className="systems desk-table cust-tickets">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Subject</th>
                    <th>Contact</th>
                    {crossLink ? <th>Device</th> : null}
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length === 0 ? (
                    <tr><td className="empty" colSpan={crossLink ? 8 : 7}>No tickets for this customer yet.</td></tr>
                  ) : tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="desk-id">#{ticket.id}</td>
                      <td className="desk-subject"><a href={`/tickets/${ticket.id}`} title={ticket.subject}>{ticket.subject}</a></td>
                      <td>{ticket.contactName || "—"}</td>
                      {crossLink ? <td>{ticket.deviceHostname || "No device"}</td> : null}
                      <td><span className={`chip status-${ticket.status}`}>{ticket.status}</span></td>
                      <td><span className={`chip priority-${ticket.priority}`}>{ticket.priority}</span></td>
                      <td className={ticket.overdue ? "desk-overdue" : undefined}>{ticket.dueAt ? formatWhen(ticket.dueAt) : "—"}</td>
                      <td>{ticket.assigneeName || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "time" && !remote ? <TimeTab time={time} /> : null}

          {tab === "history" && !remote ? <HistoryTab items={insights?.history || []} /> : null}

          {tab === "attachments" && !remote ? <AttachmentsTab files={insights?.attachments || []} /> : null}

          {tab === "devices" && !remote && insights?.deskDevices ? (
            <DeskDevicesTab account={account} devices={insights.deskDevices} />
          ) : null}

          {tab === "sla" && !remote && sla ? (
            <SlaTab account={account} sla={sla} report={report} readOnly={readOnly} />
          ) : null}
        </section>
      </main>
    </div>
  );
}

function TimeTab({ time }) {
  return (
    <>
      <p className="ticket-tags">
        <span className="dash-chip">{`Total ${workTime(time.totalMinutes)}`}</span>
        <span className="dash-chip">{`Billable ${workTime(time.billableMinutes)}`}</span>
        <span className="dash-chip">{`Not billable ${workTime(time.totalMinutes - time.billableMinutes)}`}</span>
      </p>
      <div className="systems desk-table cust-tickets">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticket</th>
              <th>Logged by</th>
              <th>Time</th>
              <th>Billable</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {time.entries.length === 0 ? (
              <tr><td className="empty" colSpan={6}>No time logged for this customer yet. Log time from a ticket.</td></tr>
            ) : time.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatWhen(entry.createdAt)}</td>
                <td className="desk-subject"><a href={`/tickets/${entry.ticketId}`} title={entry.ticketSubject}>#{entry.ticketId} {entry.ticketSubject}</a></td>
                <td>{entry.userName}</td>
                <td>{workTime(entry.minutes)}</td>
                <td>{entry.billable ? "Yes" : "No"}</td>
                <td>{entry.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ContactsTab({ app, account, contacts, devices, readOnly }) {
  const devicesOf = (contact) => devices.filter((device) => device.contactId === contact.id);
  return (
    <>
      <div className="cust-list is-boxed">
        {contacts.length === 0 ? <p className="org-name cust-empty">No contacts on this customer yet.</p> : null}
        {readOnly ? contacts.map((contact) => (
          <div className="cust-row" key={contact.id}>
            <span className="cust-avatar is-person" aria-hidden="true">{initials(contact.name)}</span>
            <span className="cust-main">
              <strong>
                {contact.name}
                {contact.primary ? <span className="cust-primary">Primary</span> : null}
              </strong>
              <SubLine items={[contact.jobTitle, contact.email, contact.phone, contact.altPhone ? `Alt: ${contact.altPhone}` : null]} />
            </span>
          </div>
        )) : contacts.map((contact) => (
          <details className="cust-contact" key={contact.id}>
            <summary className="cust-row">
              <span className="cust-avatar is-person" aria-hidden="true">{initials(contact.name)}</span>
              <span className="cust-main">
                <strong>
                  {contact.name}
                  {contact.primary ? <span className="cust-primary">Primary</span> : null}
                </strong>
                <SubLine items={[contact.jobTitle, contact.email, contact.phone, contact.altPhone ? `Alt: ${contact.altPhone}` : null]} />
                {devicesOf(contact).length ? (
                  <span className="cust-devices">Devices: {devicesOf(contact).map((device) => device.displayName).join(", ")}</span>
                ) : null}
              </span>
              <span className="cust-edit">Edit</span>
            </summary>
            <div className="cust-contact-body">
              <form action={saveContact}>
                <input type="hidden" name="app" value={app} />
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="contactId" value={contact.id} />
                <ContactFields contact={contact} />
                <label className="cust-check">
                  <input type="checkbox" name="primary" defaultChecked={contact.primary} disabled={contact.primary} />
                  Primary contact for this customer
                </label>
                {contact.primary ? <input type="hidden" name="primary" value="on" /> : null}
                <div className="cust-actions">
                  <button type="submit">Save Contact</button>
                </div>
              </form>
              <form action={deleteContact} className="cust-remove">
                <input type="hidden" name="app" value={app} />
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="contactId" value={contact.id} />
                <button type="submit" className="danger-link">Remove contact</button>
              </form>
            </div>
          </details>
        ))}
      </div>
      {readOnly ? null : (
        <form className="cust-form" action={addContact} id="add-contact">
          <input type="hidden" name="app" value={app} />
          <input type="hidden" name="accountId" value={account.id} />
          <section className="job">
            <h2>Add a contact</h2>
            <ContactFields />
            <label className="cust-check">
              <input type="checkbox" name="primary" defaultChecked={contacts.length === 0} />
              Primary contact for this customer
            </label>
          </section>
          <div className="cust-actions">
            <button type="submit">Add Contact</button>
          </div>
        </form>
      )}
    </>
  );
}

function SlaTab({ account, sla, report, readOnly }) {
  const today = new Date().toISOString().slice(0, 10);
  const contractState = !sla.contractEnd
    ? null
    : sla.contractEnd < today
      ? "Expired"
      : sla.contractStart && sla.contractStart > today
        ? "Not started"
        : "Active";
  return (
    <>
      <dl className="cust-stats">
        <div><dt>Plan</dt><dd className="cust-stat-text">{sla.planName || "None set"}</dd></div>
        <div><dt>Response target</dt><dd className="cust-stat-text">{minutesLabel(sla.responseMinutes)}</dd></div>
        <div><dt>Resolve target</dt><dd className="cust-stat-text">{minutesLabel(sla.resolveMinutes)}</dd></div>
        <div><dt>Open now</dt><dd>{report?.ticketsOpen ?? 0}</dd></div>
        <div><dt>Overdue now</dt><dd className={report?.ticketsOverdue ? "desk-overdue" : undefined}>{report?.ticketsOverdue ?? 0}</dd></div>
        {contractState ? <div><dt>Contract</dt><dd className="cust-stat-text">{contractState}</dd></div> : null}
      </dl>
      {readOnly ? (
        <dl className="cust-overview">
          <div><dt>Contract start</dt><dd>{sla.contractStart || "—"}</dd></div>
          <div><dt>Contract end</dt><dd>{sla.contractEnd || "—"}</dd></div>
          <div><dt>Contract notes</dt><dd>{sla.contractNotes || "—"}</dd></div>
        </dl>
      ) : (
        <form className="cust-form" action={saveCustomerSla}>
          <input type="hidden" name="accountId" value={account.id} />
          <section className="job">
            <h2>SLA plan</h2>
            <p className="org-name">
              Due dates and overdue flags on {account.name}&apos;s tickets use this plan. Plans are managed under <a href="/desk/settings/service-levels">SLA Targets</a>.
            </p>
            <div className="cust-fields">
              <label className="cust-wide">
                Plan
                <select name="planId" defaultValue={sla.planId || ""}>
                  <option value="">
                    {sla.defaultTargets
                      ? `Default (respond ${minutesLabel(sla.defaultTargets.responseMinutes)}, resolve ${minutesLabel(sla.defaultTargets.resolveMinutes)})`
                      : "Default (no tenant target set)"}
                  </option>
                  {sla.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} (respond {minutesLabel(plan.responseMinutes)}, resolve {minutesLabel(plan.resolveMinutes)})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="job">
            <h2>Contract</h2>
            <div className="cust-fields">
              <label>
                Start date
                <input type="date" name="contractStart" defaultValue={sla.contractStart || ""} />
              </label>
              <label>
                End date
                <input type="date" name="contractEnd" defaultValue={sla.contractEnd || ""} />
              </label>
              <label className="cust-wide">
                Contract notes
                <textarea name="contractNotes" rows={4} maxLength={4000} defaultValue={sla.contractNotes || ""} placeholder="Hours covered, what's included, rates…" />
              </label>
            </div>
          </section>
          <div className="cust-actions">
            <button type="submit">Save SLA</button>
          </div>
        </form>
      )}
    </>
  );
}

const RATING_LABELS = { good: "Good", ok: "OK", bad: "Bad" };
const PANELS = [["all", "All"], ["open", "Open"], ["hold", "On hold"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function spanLabel(minutes) {
  if (minutes == null) return "—";
  if (minutes < 1) return "Under 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return workTime(minutes);
  const days = Math.floor(minutes / 1440);
  const hours = Math.round((minutes % 1440) / 60);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

function DeskOverview({ insights, tickets, panel, href }) {
  const { overview, ratings } = insights;
  const peak = Math.max(1, ...overview.volume.flatMap((row) => [row.created, row.resolved]));
  const active = PANELS.some(([key]) => key === panel) ? panel : "all";
  const shown = tickets.filter((ticket) => (active === "open" ? ticket.status === "open" : active === "hold" ? ticket.status === "pending" : true));
  return (
    <div className="cust-insights">
      <section className="job cust-volume">
        <h2>Tickets, last 6 months</h2>
        <div className="cust-chart" role="img" aria-label={overview.volume.map((row) => `${row.month}: ${row.created} created, ${row.resolved} resolved`).join("; ")}>
          {overview.volume.map((row) => (
            <div key={row.month} className="cust-chart-month">
              <div className="cust-chart-bars">
                <span className="is-created" style={{ height: `${(row.created / peak) * 100}%` }} title={`${row.created} created`} />
                <span className="is-resolved" style={{ height: `${(row.resolved / peak) * 100}%` }} title={`${row.resolved} resolved`} />
              </div>
              <span className="cust-chart-label">{MONTHS[Number(row.month.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
        <p className="cust-chart-key"><span className="is-created" /> Created <span className="is-resolved" /> Resolved</p>
      </section>
      <section className="job cust-averages">
        <h2>Averages, last 6 months</h2>
        <dl>
          <div><dt>First response</dt><dd>{spanLabel(overview.averages.firstResponseMinutes)}</dd></div>
          <div><dt>Response</dt><dd>{spanLabel(overview.averages.responseMinutes)}</dd></div>
          <div><dt>Resolution</dt><dd>{spanLabel(overview.averages.resolutionMinutes)}</dd></div>
        </dl>
        {overview.happiness.total ? (
          <p className="org-name">
            Ratings: {overview.happiness.good} good, {overview.happiness.ok} OK, {overview.happiness.bad} bad.
          </p>
        ) : null}
        {ratings.length ? (
          <ul className="cust-ratings">
            {ratings.slice(0, 5).map((row) => (
              <li key={row.ticketId}>
                <span className={`chip rating-${row.rating}`}>{RATING_LABELS[row.rating]}</span>{" "}
                <a href={`/tickets/${row.ticketId}`}>#{row.ticketId}</a> {row.comment ? <q>{row.comment}</q> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="job cust-panel">
        <nav className="cust-subtabs" aria-label="Ticket filter">
          {PANELS.map(([key, label]) => (
            <a key={key} href={`${href}&panel=${key}`} className={active === key ? "is-active" : undefined} aria-current={active === key ? "page" : undefined}>
              {label}
              <span className="desk-count">{key === "all" ? overview.total : key === "open" ? overview.open : overview.onHold}</span>
            </a>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="org-name">No tickets here.</p>
        ) : (
          <ul className="cust-ticket-list">
            {shown.slice(0, 10).map((ticket) => (
              <li key={ticket.id}>
                <a href={`/tickets/${ticket.id}`}>#{ticket.id} {ticket.subject}</a>
                <span className={`chip status-${ticket.status}`}>{ticket.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function historyLine(item) {
  if (item.source === "ticket") {
    switch (item.action) {
      case "created": return "logged the ticket";
      case "status": return `changed the status from ${item.from || "—"} to ${item.to || "—"}`;
      case "merged": return "merged the ticket";
      case "parent": return item.to ? "linked the ticket to a parent" : "removed the parent link";
      case "csat": return `rated the support ${RATING_LABELS[item.rating] || item.rating}`;
      default: return item.action;
    }
  }
  const [target, verb] = String(item.action).split(".");
  const what = target === "device" ? "a device" : target === "contact" ? `contact ${item.name || ""}`.trim() : "the customer";
  const verbs = { create: "added", update: "updated", delete: "removed", link: "linked", unlink: "unlinked", assign: "assigned", notes: "updated the notes on", sla: "updated the SLA for" };
  return `${verbs[verb] || verb || "changed"} ${what}`;
}

function HistoryTab({ items }) {
  if (!items.length) return <p className="org-name">Nothing recorded for this customer yet.</p>;
  return (
    <ol className="cust-history">
      {items.map((item, index) => (
        <li key={`${item.at}-${index}`}>
          <time dateTime={item.at}>{formatWhen(item.at)}</time>
          <span>
            <strong>{item.actor}</strong> {historyLine(item)}
            {item.ticketId ? <> on <a href={`/tickets/${item.ticketId}`}>#{item.ticketId} {item.subject}</a></> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function sizeLabel(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentsTab({ files }) {
  return (
    <div className="systems desk-table cust-tickets">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Ticket</th>
            <th>Added by</th>
            <th>Size</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {files.length === 0 ? (
            <tr><td className="empty" colSpan={5}>No attachments on this customer&apos;s tickets yet.</td></tr>
          ) : files.map((file) => (
            <tr key={file.id}>
              <td className="desk-subject"><a href={`/tickets/attachments/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name}</a></td>
              <td className="desk-subject"><a href={`/tickets/${file.ticketId}`} title={file.ticketSubject}>#{file.ticketId} {file.ticketSubject}</a></td>
              <td>{file.uploader}</td>
              <td>{sizeLabel(file.size)}</td>
              <td>{formatWhen(file.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeskDevicesTab({ account, devices }) {
  return (
    <>
      <p className="org-name">
        Devices linked to this customer in Remote Desk. <a href={`/remote/customers/${account.id}?tab=devices`}>Manage them in Remote Desk</a>.
      </p>
      <div className="systems desk-table cust-tickets">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Assigned to</th>
              <th>Operating system</th>
              <th>Last seen</th>
              <th>Open tickets</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr><td className="empty" colSpan={5}>No devices linked to this customer.</td></tr>
            ) : devices.map((device) => (
              <tr key={device.id}>
                <td>{device.displayName}</td>
                <td>{device.contactName || "Shared"}</td>
                <td>{device.osName || "—"}</td>
                <td>{device.lastSeenAt ? formatWhen(device.lastSeenAt) : "—"}</td>
                <td>{device.openTickets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
