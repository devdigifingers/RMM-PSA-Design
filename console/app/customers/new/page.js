import { redirect } from "next/navigation";
import { createAccount } from "../../actions";
import { ConsoleBar } from "../../bar";
import { AccountFields, apiGet, ContactFields, CustomerSide } from "../shared";

export default async function NewAccountPage({ searchParams }) {
  const params = await searchParams;
  const response = await apiGet("/v1/accounts");
  const body = await response.json();
  if (body.readOnly) redirect("/customers");

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide active="accounts" accounts={(body.accounts || []).length} contacts={body.contactTotal} />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href="/customers">← All customers</a></p>
          <h1>New Customer</h1>
          {params?.error ? <p className="error">{String(params.error)}</p> : null}
          <form className="cust-form" action={createAccount}>
            <section className="job">
              <h2>Customer details</h2>
              <p className="org-name">A company, sole proprietor or other entity you support.</p>
              <AccountFields />
            </section>
            <section className="job">
              <h2>Primary contact</h2>
              <p className="org-name">Optional. You can add more contacts on the customer afterwards.</p>
              <ContactFields prefix="contact_" requireName={false} />
            </section>
            <div className="cust-actions">
              <button type="submit">Create Customer</button>
              <a href="/customers">Cancel</a>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
