import Link from "next/link";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { METHOD_LABELS, Notice, billingData, rand, shortDate } from "../billing-data";

export const metadata = { title: "Payments · Invoicing" };

const SAVED = {
  payment: "Payment recorded.",
  paymentCredit: "Payment recorded. The amount over the open invoices is kept as credit for the customer.",
};

export default async function PaymentsPage({ searchParams }) {
  const query = await searchParams;
  const { flags, data: [body] } = await billingData("/v1/billing/payments");
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <div className="dx-head">
          <div>
            <h1><AppTitle app="billing">Payments</AppTitle></h1>
            <p className="rx-lead">Money received, and which invoices it paid.</p>
          </div>
          {body.canManage ? <Link className="rx-button bx-primary" href="/billing/payments/new">Record payment</Link> : null}
        </div>
        <Notice params={query} saved={SAVED} />
        <div className="systems desk-table bx-table">
          <table>
            <thead>
              <tr><th>Date</th><th>Customer</th><th>Method</th><th>Reference</th><th>Paid invoices</th><th className="bx-num">Amount</th></tr>
            </thead>
            <tbody>
              {body.payments.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No payments recorded yet.</td></tr>
              ) : body.payments.map((p) => {
                const allocated = p.allocations.reduce((sum, a) => sum + a.amountCents, 0);
                return (
                  <tr key={p.id}>
                    <td>{shortDate(p.date)}</td>
                    <td><Link href={`/billing/customers/${p.customerId}`}>{p.customerName}</Link></td>
                    <td>{METHOD_LABELS[p.method] || p.method}</td>
                    <td>{p.reference || "—"}</td>
                    <td>
                      {p.allocations.map((a, index) => (
                        <span key={a.documentId}>{index ? ", " : ""}<Link href={`/billing/documents/${a.documentId}`}>{a.number}</Link></span>
                      ))}
                      {p.amountCents > allocated ? <span className="field-hint">{p.allocations.length ? " · " : ""}{rand(p.amountCents - allocated)} kept as credit</span> : null}
                    </td>
                    <td className="bx-num">{rand(p.amountCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
