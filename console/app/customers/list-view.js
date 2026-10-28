import { formatWhen } from "../account-data";
import { ConsoleBar } from "../bar";
import { apiGet, CustomerSide, customersBase, initials, kindLabel, ReadOnlyNote, SearchBox } from "./shared";

export async function CustomerList({ app, searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const base = customersBase(app);
  const response = await apiGet(`/v1/accounts?view=${app}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const body = await response.json();
  const accounts = body.accounts || [];
  const columns = app === "remote" ? 5 : 6;

  return (
    <div className="console">
      <ConsoleBar showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <CustomerSide app={app} active="accounts" accounts={q ? null : accounts.length} contacts={body.contactTotal} />
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              All customers <span className="desk-total">({accounts.length})</span>
            </h1>
            <SearchBox q={q} placeholder="Search customers" />
            {body.readOnly ? null : (
              <a className="desk-new" href={`${base}/new`}>
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
                  {app === "remote" ? (
                    <>
                      <th>Devices</th>
                      <th>Last session</th>
                    </>
                  ) : (
                    <>
                      <th>Open tickets</th>
                      <th>Overdue</th>
                      <th>SLA plan</th>
                    </>
                  )}
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={columns}>
                      {q
                        ? "No customers match that search."
                        : app === "remote"
                          ? "No customers yet. Add your first customer to start linking contacts and devices."
                          : "No customers yet. Add your first customer to start logging tickets for them."}
                    </td>
                  </tr>
                ) : accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <a className="cust-name" href={`${base}/${account.id}`}>
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
                    {app === "remote" ? (
                      <>
                        <td>
                          {account.deviceCount ? (
                            <span title={`${account.onlineCount} online of ${account.deviceCount}`}>
                              <span className={account.onlineCount ? "cust-online" : undefined}>{account.onlineCount}</span>/{account.deviceCount}
                            </span>
                          ) : "0"}
                        </td>
                        <td>{account.lastSessionAt ? formatWhen(account.lastSessionAt) : "—"}</td>
                      </>
                    ) : (
                      <>
                        <td>{account.openTicketCount}</td>
                        <td className={account.overdueCount ? "desk-overdue" : undefined}>{account.overdueCount}</td>
                        <td>{account.slaPlan || "—"}</td>
                      </>
                    )}
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
