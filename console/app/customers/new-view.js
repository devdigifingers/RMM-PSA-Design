import { redirect } from "next/navigation";
import { createAccount } from "../actions";
import { ConsoleBar } from "../bar";
import { AccountFields, apiGet, ContactFields, CustomerSide, customersBase } from "./shared";

export async function NewCustomer({ app, searchParams }) {
  const params = await searchParams;
  const base = customersBase(app);
  const response = await apiGet(`/v1/accounts?view=${app}`);
  const body = await response.json();
  if (body.readOnly) redirect(base);

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide app={app} active="accounts" accounts={(body.accounts || []).length} contacts={body.contactTotal} />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href={base}>← All customers</a></p>
          <h1>New Customer</h1>
          {params?.error ? <p className="error">{String(params.error)}</p> : null}
          <form className="cust-form" action={createAccount}>
            <input type="hidden" name="app" value={app} />
            <section className="job">
              <h2>Customer details</h2>
              <p className="org-name">A company, sole proprietor or other entity you support.</p>
              <AccountFields withNotes />
            </section>
            <section className="job">
              <h2>Primary contact</h2>
              <p className="org-name">Optional. You can add more contacts on the customer afterwards.</p>
              <ContactFields prefix="contact_" requireName={false} />
            </section>
            <div className="cust-actions">
              <button type="submit">Create Customer</button>
              <a href={base}>Cancel</a>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
