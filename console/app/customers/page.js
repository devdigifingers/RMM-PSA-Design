import { formatWhen } from "../account-data";
import { ConsoleBar } from "../bar";
import { apiGet, CustomerSide, initials, kindLabel, ReadOnlyNote, SearchBox } from "./shared";

export default async function AccountsPage({ searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const response = await apiGet(`/v1/accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const body = await response.json();
  const accounts = body.accounts || [];
  const apps = body.apps || {};
  const columns = 3 + (apps.remote ? 1 : 0) + (apps.servicedesk ? 1 : 0);

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide active="accounts" accounts={q ? null : accounts.length} contacts={body.contactTotal} />
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              All customers <span className="desk-total">({accounts.length})</span>
            </h1>
            <SearchBox q={q} placeholder="Search customers" />
            {body.readOnly ? null : (
              <a className="desk-new" href="/customers/new">
                <span aria-hidden="true">+</span> New Customer
              </a>
            )}
          </header>
          <ReadOnlyNote show={body.readOnly} />
          {params?.saved === "deleted" ? <p className="org-name cust-saved">Customer deleted.</p> : null}
          <div className="systems desk-table cust-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Primary contact</th>
                  {apps.remote ? <th>Devices</th> : null}
                  {apps.servicedesk ? <th>Open tickets</th> : null}
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={columns}>
                      {q ? "No customers match that search." : "No customers yet. Add your first customer to start linking contacts, tickets and devices."}
                    </td>
                  </tr>
                ) : accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <a className="cust-name" href={`/customers/${account.id}`}>
                        <span className="cust-avatar is-small" aria-hidden="true">{initials(account.name)}</span>
                        <span>
                          <strong>{account.name}</strong>
                          <span className="cust-kind">{kindLabel(account.kind)}</span>
                        </span>
                      </a>
                    </td>
                    <td>
                      {account.primaryContact ? (
                        <>
                          {account.primaryContact.name}
                          {account.primaryContact.email ? <span className="cust-kind">{account.primaryContact.email}</span> : null}
                        </>
                      ) : "—"}
                    </td>
                    {apps.remote ? <td>{account.deviceCount}</td> : null}
                    {apps.servicedesk ? <td>{account.openTicketCount}</td> : null}
                    <td>{formatWhen(account.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
