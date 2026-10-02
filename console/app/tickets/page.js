import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCustomer, createTicket, saveContact, saveSla } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function TicketsPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/tickets`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=ticket");
  const body = await response.json();
  const customers = body.customers || [];
  const devices = body.devices || [];
  const users = body.users || [];
  const tickets = body.tickets || [];

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main">
        <h1>Tickets</h1>
        {params?.error === "sla" ? <p className="error">Those SLA targets could not be saved.</p> : null}
        {params?.error === "contact" ? <p className="error">That contact could not be saved.</p> : null}
        {params?.error && params.error !== "sla" && params.error !== "contact" ? <p className="error">That ticket could not be saved.</p> : null}
        <section className="job">
          <h2>SLA</h2>
          <form action={saveSla}>
            <label>
              Response minutes
              <input name="responseMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.responseMinutes || ""} />
            </label>
            <label>
              Resolve minutes
              <input name="resolveMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.resolveMinutes || ""} />
            </label>
            <button type="submit">Save SLA</button>
          </form>
        </section>
        <section className="job">
          <h2>Customer</h2>
          <form action={createCustomer}>
            <label>
              Name
              <input name="name" required />
            </label>
            <button type="submit">Add customer</button>
          </form>
          {customers.map((customer) => (
            <p className="org-name" key={customer.id}>
              {customer.contactName
                ? `${customer.name}: ${customer.contactName} · ${customer.contactEmail}`
                : `${customer.name}: no contact yet`}
            </p>
          ))}
          {customers.length > 0 ? (
            <form action={saveContact}>
              <label>
                Customer
                <select name="customerId" required defaultValue={customers[0].id}>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Contact name
                <input name="contactName" required defaultValue={customers[0].contactName || ""} />
              </label>
              <label>
                Contact email
                <input name="contactEmail" type="email" required defaultValue={customers[0].contactEmail || ""} />
              </label>
              <button type="submit">Save contact</button>
            </form>
          ) : null}
        </section>
        {customers.length > 0 && devices.length > 0 ? (
          <section className="job">
            <h2>New ticket</h2>
            <form className="stack" action={createTicket}>
              <label>
                Subject
                <input name="subject" required />
              </label>
              <label>
                Customer
                <select name="customerId" required defaultValue={customers[0].id}>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Device
                <select name="deviceId" required defaultValue={devices[0].id}>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>{device.customerName ? `${device.hostname} · ${device.customerName}` : device.hostname}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue="open">
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="high">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label>
                Assignee
                <select name="assigneeUserId" required defaultValue={users[0]?.id || ""}>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Comment
                <textarea name="comment" />
              </label>
              <button type="submit">Create ticket</button>
            </form>
          </section>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Customer</th>
              <th>Device</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td className="empty" colSpan={6}>No tickets yet.</td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td><a href={`/tickets/${ticket.id}`}>{ticket.subject}</a></td>
                  <td>{ticket.customer.name}</td>
                  <td>{ticket.device.hostname}</td>
                  <td>{ticket.status}</td>
                  <td>{ticket.priority}</td>
                  <td>{ticket.assignee?.name || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
