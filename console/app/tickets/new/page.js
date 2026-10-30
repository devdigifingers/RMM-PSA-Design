import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { NewTicketForm } from "./ticket-form";

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
  if (response.status === 403) forbidden();
  const body = await response.json();
  const customers = body.customers || [];
  const devices = body.devices || [];
  const back = params?.customer ? `/desk/customers/${Number(params.customer)}?tab=tickets` : "/tickets";

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href={back}>{params?.customer ? "← Back to customer" : "← All Tickets"}</a></p>
        <h1><AppTitle app="service-desk">New Ticket</AppTitle></h1>
        {params?.error ? <p className="error">{params.error === "ticket" ? "That ticket could not be saved." : String(params.error)}</p> : null}
        {customers.length === 0 ? (
          <p className="org-name">
            Add a customer under <a href="/desk/customers">Customers</a> before logging tickets.
          </p>
        ) : (
          <section className="job desk-form">
            <NewTicketForm
              customers={customers}
              devices={devices}
              users={body.users || []}
              me={body.me}
              initialCustomer={Number(params?.customer) || null}
              statuses={body.statuses || []}
              priorityLabels={body.priorityLabels || {}}
              categories={body.categories || []}
              tags={body.tags || []}
            />
          </section>
        )}
      </main>
    </div>
  );
}
