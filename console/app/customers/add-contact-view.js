import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { apiGet, CustomerSide, customersBase } from "./shared";

export async function AddContactPicker({ app, searchParams }) {
  const params = await searchParams;
  const base = customersBase(app);
  const response = await apiGet(`/v1/accounts?view=${app}`);
  const body = await response.json();
  if (body.readOnly) redirect(`${base}/contacts`);
  const accounts = (body.accounts || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const chosen = accounts.find((account) => String(account.id) === String(params?.customer || ""));
  if (chosen) redirect(`${base}/${chosen.id}?tab=contacts#add-contact`);

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide app={app} active="contacts" accounts={accounts.length} contacts={body.contactTotal} />
        <section className="desk-list cust-page">
          <p className="desk-back"><a href={`${base}/contacts`}>← All Contacts</a></p>
          <h1>Add contact</h1>
          {accounts.length === 0 ? (
            <p className="org-name">
              Every contact belongs to a customer, and there are no customers yet. <a href={`${base}/new`}>Create a customer</a> first.
            </p>
          ) : (
            <form className="cust-form" method="get">
              <section className="job">
                <h2>Which customer is this contact for?</h2>
                <p className="org-name">Every contact belongs to one customer. The contact form opens on that customer next.</p>
                <label className="cust-pick">
                  Customer
                  <select name="customer" required defaultValue={accounts.length === 1 ? String(accounts[0].id) : ""}>
                    <option value="" disabled>Choose a customer</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </label>
              </section>
              <div className="cust-actions">
                <button type="submit">Continue</button>
                <a href={`${base}/contacts`}>Cancel</a>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
