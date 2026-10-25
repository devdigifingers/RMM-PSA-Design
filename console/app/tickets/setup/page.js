import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCustomer, saveContact, saveSla } from "../../actions";
import { ConsoleBar } from "../../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const ERRORS = {
  sla: "Those SLA targets could not be saved.",
  contact: "That contact could not be saved.",
  customer: "That customer could not be saved.",
};

const SAVED = {
  sla: "SLA targets saved.",
  contact: "Contact saved.",
  customer: "Customer added.",
};

export default async function DeskSetupPage({ searchParams }) {
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

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href="/tickets">← All Tickets</a></p>
        <h1>SLA, Customers &amp; Contacts</h1>
        {ERRORS[params?.error] ? <p className="error">{ERRORS[params.error]}</p> : null}
        {SAVED[params?.saved] ? <p className="org-name">{SAVED[params.saved]}</p> : null}
        <div className="ticket-forms">
          <section className="job">
            <h2>SLA targets</h2>
            <p className="org-name">Due dates on the ticket list are the creation time plus the resolve target.</p>
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
            <h2>Customers</h2>
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
          </section>
          {customers.length > 0 ? (
            <section className="job">
              <h2>Contact</h2>
              <form className="stack" action={saveContact}>
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
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
