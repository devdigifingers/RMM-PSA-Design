import { ConsoleBar } from "../bar";
import { apiGet, CustomerSide, initials, kindLabel, SearchBox, SubLine } from "./shared";

export default async function AccountsPage({ searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const response = await apiGet(`/v1/accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const body = await response.json();
  const accounts = body.accounts || [];

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide active="accounts" accounts={q ? null : accounts.length} contacts={body.contactTotal} />
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              All Accounts <span className="desk-total">({accounts.length})</span>
            </h1>
            <SearchBox q={q} placeholder="Search accounts" />
            <a className="desk-new" href="/customers/new">
              <span aria-hidden="true">+</span> New Account
            </a>
          </header>
          <div className="cust-list">
            {accounts.length === 0 ? (
              <p className="org-name cust-empty">{q ? "No accounts match that search." : "No accounts yet. Add your first account to start linking contacts, tickets and devices."}</p>
            ) : accounts.map((account) => (
              <a className="cust-row" key={account.id} href={`/customers/${account.id}`}>
                <span className="cust-avatar" aria-hidden="true">{initials(account.name)}</span>
                <span className="cust-main">
                  <strong>{account.name}</strong>
                  <SubLine items={[account.website, account.email || account.primaryContact?.email, account.phone || account.primaryContact?.phone]} />
                </span>
                <span className="cust-meta">
                  <span className="chip">{kindLabel(account.kind)}</span>
                  <span title="Contacts">{account.contactCount} {account.contactCount === 1 ? "contact" : "contacts"}</span>
                  {body.canAssets ? <span title="Linked devices">{account.deviceCount} {account.deviceCount === 1 ? "device" : "devices"}</span> : null}
                  <span title="Open tickets">{account.openTicketCount} open</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}