import { notFound } from "next/navigation";
import { formatWhen } from "../../account-data";
import { addContact, assignAsset, deleteContact, deleteCustomer, linkAsset, saveAccount, saveContact, unlinkAsset } from "../../actions";
import { ConsoleBar } from "../../bar";
import { AccountFields, apiGet, ContactFields, CustomerSide, initials, kindLabel, ReadOnlyNote, SubLine } from "../shared";

const SAVED = {
  created: "Customer created.",
  account: "Customer saved.",
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
  ["notes", "Notes"],
];

export default async function AccountPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const response = await apiGet(`/v1/accounts/${Number(id) || 0}`);
  if (response.status === 404) notFound();
  const body = await response.json();
  const { account, contacts = [], tickets = [], devices = [], linkable = [], report } = body;
  const apps = body.apps || {};
  const readOnly = body.readOnly === true;
  const manage = body.canOperate && !readOnly;
  const tabs = [
    ["overview", "Overview", null],
    ["contacts", "Contacts", contacts.length],
    apps.remote ? ["devices", "Devices", devices.length] : null,
    apps.servicedesk ? ["tickets", "Tickets", tickets.length] : null,
    apps.reporting ? ["reports", "Reports", null] : null,
  ].filter(Boolean);
  const tab = tabs.some(([key]) => key === query?.tab) ? query.tab : "overview";
  const primary = contacts.find((contact) => contact.primary);
  const devicesOf = (contact) => devices.filter((device) => device.contactId === contact.id);
  const online = devices.filter((device) => device.presence === "online").length;

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide active="accounts" />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href="/customers">← All customers</a></p>
          <header className="cust-head">
            <span className="cust-avatar is-large" aria-hidden="true">{initials(account.name)}</span>
            <div>
              <h1>{account.name} <span className="chip">{kindLabel(account.kind)}</span></h1>
              <SubLine items={[account.website, account.email, account.phone, primary ? `Primary contact: ${primary.name}` : null]} />
            </div>
            {apps.servicedesk ? (
              <a className="desk-new" href={`/tickets/new?customer=${account.id}`}>
                <span aria-hidden="true">+</span> New Ticket
              </a>
            ) : null}
          </header>
          <ReadOnlyNote show={readOnly} />
          <nav className="cust-tabs" aria-label="Customer sections">
            {tabs.map(([key, label, count]) => (
              <a key={key} href={`/customers/${account.id}?tab=${key}`} className={tab === key ? "is-active" : undefined} aria-current={tab === key ? "page" : undefined}>
                {label}
                {count != null ? <span className="desk-count">{count}</span> : null}
              </a>
            ))}
          </nav>
          {query?.error ? <p className="error">{String(query.error)}</p> : null}
          {SAVED[query?.saved] ? <p className="org-name cust-saved">{SAVED[query.saved]}</p> : null}

          {tab === "overview" && readOnly ? (
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
          ) : null}

          {tab === "overview" && !readOnly ? (
            <>
              <form className="cust-form" action={saveAccount}>
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
                  <input type="hidden" name="accountId" value={account.id} />
                  <p>
                    <strong>Delete this customer</strong>
                    <span className="org-name">Only possible once it has no tickets or devices. Its contacts are deleted with it.</span>
                  </p>
                  <label className="cust-check">
                    <input type="checkbox" name="confirm" required />
                    Delete {account.name}
                  </label>
                  <button type="submit" className="danger-link">Delete customer</button>
                </form>
              ) : null}
            </>
          ) : null}

          {tab === "contacts" ? (
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
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="contactId" value={contact.id} />
                        <button type="submit" className="danger-link">Remove contact</button>
                      </form>
                    </div>
                  </details>
                ))}
              </div>
              {readOnly ? null : (
                <form className="cust-form" action={addContact}>
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
          ) : null}

          {tab === "devices" ? (
            <>
              <p className="org-name">Devices from Remote Desk that belong to this customer. Assign a device to the contact who uses it; leave servers and shared machines unassigned. When a contact logs a call, their own devices are offered first.</p>
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
                      {manage ? <th aria-label="Actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {devices.length === 0 ? (
                      <tr><td className="empty" colSpan={7}>No devices linked yet.</td></tr>
                    ) : devices.map((device) => (
                      <tr key={device.id}>
                        <td><a href={`/devices?q=${encodeURIComponent(device.hostname)}`}>{device.displayName}</a></td>
                        <td>
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
                        </td>
                        <td><span className={`chip presence-${device.presence}`}>{PRESENCE[device.presence] || "Offline"}</span></td>
                        <td className="desk-clip" title={device.users.join(", ") || undefined}>{device.users.join(", ") || "—"}</td>
                        <td>{device.osName || "—"}</td>
                        <td>{device.ipv4 || "—"}</td>
                        {manage ? (
                          <td>
                            <form action={unlinkAsset}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <input type="hidden" name="deviceId" value={device.id} />
                              <button type="submit" className="danger-link">Unlink</button>
                            </form>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {manage ? (
                <div className="cust-asset-tools">
                  <form className="cust-link" action={linkAsset}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <label>
                      Link an existing device
                      <select name="deviceId" required defaultValue="">
                        <option value="" disabled>Choose a device…</option>
                        {linkable.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.accountName ? `${device.name} · moves from ${device.accountName}` : `${device.name} · not linked`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" disabled={!linkable.length}>Link Device</button>
                  </form>
                  <div className="cust-link">
                    <p>
                      <strong>Add a new computer to this customer</strong>
                      <span className="org-name">The installer enrols the computer straight onto {account.name}.</span>
                    </p>
                    <a className="deploy-download" href={`/agent/windows?customer=${account.id}`}>Download for Windows</a>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "tickets" ? (
            <div className="systems desk-table cust-tickets">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Subject</th>
                    <th>Contact</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length === 0 ? (
                    <tr><td className="empty" colSpan={7}>No tickets for this customer yet.</td></tr>
                  ) : tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="desk-id">#{ticket.id}</td>
                      <td className="desk-subject"><a href={`/tickets/${ticket.id}`} title={ticket.subject}>{ticket.subject}</a></td>
                      <td>{ticket.contactName || "—"}</td>
                      <td>{ticket.deviceHostname || "No device"}</td>
                      <td><span className={`chip status-${ticket.status}`}>{ticket.status}</span></td>
                      <td><span className={`chip priority-${ticket.priority}`}>{ticket.priority}</span></td>
                      <td>{ticket.assigneeName || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "reports" ? (
            <>
              <dl className="cust-stats">
                <div><dt>Contacts</dt><dd>{contacts.length}</dd></div>
                {apps.remote ? <div><dt>Devices</dt><dd>{devices.length}</dd></div> : null}
                {apps.remote ? <div><dt>Devices online now</dt><dd>{online}</dd></div> : null}
                {report?.ticketsOpen != null ? <div><dt>Open tickets</dt><dd>{report.ticketsOpen}</dd></div> : null}
                {report?.ticketsOpened30 != null ? <div><dt>Tickets logged, last 30 days</dt><dd>{report.ticketsOpened30}</dd></div> : null}
                {report?.ticketsResolved30 != null ? <div><dt>Tickets resolved, last 30 days</dt><dd>{report.ticketsResolved30}</dd></div> : null}
                {report?.ticketsTotal != null ? <div><dt>Tickets all time</dt><dd>{report.ticketsTotal}</dd></div> : null}
              </dl>
              {body.canReport ? <p className="org-name">Scheduled reports for the whole tenant are on the <a href="/dashboard">Dashboard</a>.</p> : null}
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
