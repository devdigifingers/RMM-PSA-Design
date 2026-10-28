import { notFound } from "next/navigation";
import { addContact, assignAsset, deleteContact, linkAsset, saveAccount, saveContact, unlinkAsset } from "../../actions";
import { ConsoleBar } from "../../bar";
import { AccountFields, apiGet, ContactFields, CustomerSide, initials, kindLabel, SubLine } from "../shared";

const SAVED = {
  created: "Account created.",
  account: "Account saved.",
  contact: "Contact saved.",
  removed: "Contact removed.",
  linked: "Device linked to this account.",
  unlinked: "Device unlinked from this account.",
  assigned: "Device assignment saved.",
};

const PRESENCE = { online: "Online", rebooting: "Rebooting", offline: "Offline" };

export default async function AccountPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const response = await apiGet(`/v1/accounts/${Number(id) || 0}`);
  if (response.status === 404) notFound();
  const body = await response.json();
  const { account, contacts = [], tickets = [], devices = [], linkable = [] } = body;
  const tabs = [
    ["details", "Details", null],
    ["contacts", "Contacts", contacts.length],
    body.canAssets ? ["assets", "Assets", devices.length] : null,
    ["tickets", "Tickets", tickets.length],
  ].filter(Boolean);
  const tab = tabs.some(([key]) => key === query?.tab) ? query.tab : "details";
  const primary = contacts.find((contact) => contact.primary);
  const devicesOf = (contact) => devices.filter((device) => device.contactId === contact.id);

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide active="accounts" />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href="/customers">← All Accounts</a></p>
          <header className="cust-head">
            <span className="cust-avatar is-large" aria-hidden="true">{initials(account.name)}</span>
            <div>
              <h1>{account.name} <span className="chip">{kindLabel(account.kind)}</span></h1>
              <SubLine items={[account.website, account.email, account.phone, primary ? `Primary contact: ${primary.name}` : null]} />
            </div>
            <a className="desk-new" href={`/tickets/new?customer=${account.id}`}>
              <span aria-hidden="true">+</span> New Ticket
            </a>
          </header>
          <nav className="cust-tabs" aria-label="Account sections">
            {tabs.map(([key, label, count]) => (
              <a key={key} href={`/customers/${account.id}?tab=${key}`} className={tab === key ? "is-active" : undefined} aria-current={tab === key ? "page" : undefined}>
                {label}
                {count != null ? <span className="desk-count">{count}</span> : null}
              </a>
            ))}
          </nav>
          {query?.error ? <p className="error">{String(query.error)}</p> : null}
          {SAVED[query?.saved] ? <p className="org-name cust-saved">{SAVED[query.saved]}</p> : null}

          {tab === "details" ? (
            <form className="cust-form" action={saveAccount}>
              <input type="hidden" name="accountId" value={account.id} />
              <section className="job">
                <AccountFields account={account} />
              </section>
              <div className="cust-actions">
                <button type="submit">Save Account</button>
              </div>
            </form>
          ) : null}

          {tab === "contacts" ? (
            <>
              <div className="cust-list is-boxed">
                {contacts.length === 0 ? <p className="org-name cust-empty">No contacts on this account yet.</p> : null}
                {contacts.map((contact) => (
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
                          Primary contact for this account
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
              <form className="cust-form" action={addContact}>
                <input type="hidden" name="accountId" value={account.id} />
                <section className="job">
                  <h2>Add a contact</h2>
                  <ContactFields />
                  <label className="cust-check">
                    <input type="checkbox" name="primary" defaultChecked={contacts.length === 0} />
                    Primary contact for this account
                  </label>
                </section>
                <div className="cust-actions">
                  <button type="submit">Add Contact</button>
                </div>
              </form>
            </>
          ) : null}

          {tab === "assets" ? (
            <>
              <p className="org-name">Devices from Remote Desk that belong to this account. Assign a device to the contact who uses it; leave servers and shared machines unassigned. When a contact logs a call, their own devices are offered first.</p>
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
                      {body.canOperate ? <th aria-label="Actions" /> : null}
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
                        {body.canOperate ? (
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
              {body.canOperate ? (
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
                      <strong>Add a new computer to this account</strong>
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
                    <tr><td className="empty" colSpan={7}>No tickets for this account yet.</td></tr>
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
        </section>
      </main>
    </div>
  );
}
