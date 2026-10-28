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
  const readOnly = body.readOnly === true;
  const manage = body.canOperate && !readOnly;
  const remote = app === "remote";
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
      ["tickets", "Tickets", tickets.length],
      ["contacts", "Contacts", contacts.length],
      ["sla", "SLA / contract", null],
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
          <ReadOnlyNote show={readOnly} />
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
                    <div><dt>Open tickets</dt><dd>{report?.ticketsOpen ?? 0}</dd></div>
                    <div><dt>Overdue</dt><dd className={report?.ticketsOverdue ? "desk-overdue" : undefined}>{report?.ticketsOverdue ?? 0}</dd></div>
                    <div><dt>Resolved, last 30 days</dt><dd>{report?.ticketsResolved30 ?? 0}</dd></div>
                    <div><dt>SLA plan</dt><dd className="cust-stat-text">{sla?.planName || "None set"}</dd></div>
                  </>
                )}
              </dl>
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

          {tab === "sla" && !remote && sla ? (
            <SlaTab account={account} sla={sla} report={report} readOnly={readOnly} />
          ) : null}
        </section>
      </main>
    </div>
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
              Due dates and overdue flags on {account.name}&apos;s tickets use this plan. Plans are managed under <a href="/tickets/setup">SLA Targets</a>.
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
