import Link from "next/link";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { VAT_STATUS_LABELS, billingData, rand, shortDate } from "../billing-data";

export const metadata = { title: "Customers · Invoicing" };

export default async function BillingCustomersPage() {
  const { flags, data: [list] } = await billingData("/v1/billing/customers");
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <div className="dx-head">
          <div>
            <h1><AppTitle app="billing">Customers</AppTitle></h1>
            <p className="rx-lead">Who you bill. Set each customer&rsquo;s VAT status and billing email before invoicing them.</p>
          </div>
          {list.canManage ? <Link className="rx-button bx-primary" href="/billing/customers/new">New customer</Link> : null}
        </div>
        <div className="systems desk-table bx-table">
          <table>
            <thead><tr><th>Customer</th><th>VAT status</th><th>Billing email</th><th className="bx-num">Outstanding</th><th className="bx-num">Overdue</th><th>Last invoice</th></tr></thead>
            <tbody>
              {list.customers.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No customers yet. Add your first customer to start invoicing.</td></tr>
              ) : list.customers.map((customer) => (
                <tr key={customer.id}>
                  <td><Link className="bx-doc-link" href={`/billing/customers/${customer.id}`}>{customer.name}</Link></td>
                  <td>{VAT_STATUS_LABELS[customer.vatStatus]}{customer.vatStatus === "registered" && customer.vatNumber ? <span className="field-hint"> · {customer.vatNumber}</span> : null}</td>
                  <td>{customer.billingEmail || customer.email || <span className="field-hint">Not set</span>}</td>
                  <td className="bx-num">{rand(customer.outstandingCents)}</td>
                  <td className={`bx-num${customer.overdueCents ? " bx-overdue" : ""}`}>{rand(customer.overdueCents)}</td>
                  <td>{shortDate(customer.lastInvoice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
