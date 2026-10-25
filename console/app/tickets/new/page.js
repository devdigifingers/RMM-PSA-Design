import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createTicket } from "../../actions";
import { ConsoleBar } from "../../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function NewTicketPage({ searchParams }) {
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

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href="/tickets">← All Tickets</a></p>
        <h1>New Ticket</h1>
        {params?.error ? <p className="error">That ticket could not be saved.</p> : null}
        {customers.length === 0 || devices.length === 0 ? (
          <p className="org-name">
            Add a customer in <a href="/tickets/setup">SLA, Customers &amp; Contacts</a> and enroll a device before logging tickets.
          </p>
        ) : (
          <section className="job desk-form">
            <form className="stack" action={createTicket}>
              <label>
                Subject
                <input name="subject" required maxLength={200} />
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
                <select name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label>
                Ticket owner
                <select name="assigneeUserId" defaultValue={body.me || ""}>
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea name="comment" maxLength={4000} />
              </label>
              <button type="submit">Create Ticket</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
