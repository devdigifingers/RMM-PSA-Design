import { ConsoleBar } from "../bar";
import { apiGet, CustomerSide, customersBase, initials, SearchBox, SubLine } from "./shared";

export async function ContactList({ app, searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const base = customersBase(app);
  const response = await apiGet(`/v1/contacts?view=${app}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const body = await response.json();
  const contacts = body.contacts || [];

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide app={app} active="contacts" accounts={body.accountTotal} contacts={q ? null : contacts.length} />
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              All Contacts <span className="desk-total">({contacts.length})</span>
            </h1>
            <SearchBox q={q} placeholder="Search contacts" />
          </header>
          <p className="org-name">Contacts are added on their customer, so every contact belongs to one customer.</p>
          <div className="cust-list">
            {contacts.length === 0 ? (
              <p className="org-name cust-empty">{q ? "No contacts match that search." : "No contacts yet. Open a customer and add contacts on its Contacts tab."}</p>
            ) : contacts.map((contact) => (
              <a className="cust-row" key={contact.id} href={`${base}/${contact.accountId}?tab=contacts`}>
                <span className="cust-avatar is-person" aria-hidden="true">{initials(contact.name)}</span>
                <span className="cust-main">
                  <strong>
                    {contact.name}
                    {contact.primary ? <span className="cust-primary">Primary</span> : null}
                  </strong>
                  <SubLine items={[contact.accountName, contact.jobTitle, contact.email, contact.phone]} />
                </span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
