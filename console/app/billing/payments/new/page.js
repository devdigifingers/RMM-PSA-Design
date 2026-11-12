import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { recordPayment } from "../../actions";
import { METHOD_LABELS, Notice, billingData, billingFetch, rand, randInput, shortDate } from "../../billing-data";

export const metadata = { title: "Record payment · Invoicing" };

export default async function NewPaymentPage({ searchParams }) {
  const query = await searchParams;
  const customerId = /^\d+$/.test(query?.customer || "") ? query.customer : "";
  const invoiceId = /^\d+$/.test(query?.invoice || "") ? query.invoice : "";
  const { flags, data: [list, status] } = await billingData("/v1/billing/customers", "/v1/billing/status");
  if (!status.canManage) redirect("/billing/payments");
  const open = customerId ? (await billingFetch(`/v1/billing/documents?kind=invoice&status=unpaid&customer=${customerId}`)).documents.slice().reverse() : [];
  const chosen = open.find((doc) => String(doc.id) === invoiceId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <p className="bx-crumb"><Link href="/billing/payments">Payments</Link> / Record payment</p>
        <div className="dx-head"><h1><AppTitle app="billing">Record payment</AppTitle></h1></div>
        <Notice params={query} saved={{}} />
        <form className="mfa-card bx-grid" action="/billing/payments/new">
          <label className="bx-span">
            Customer
            <select name="customer" defaultValue={customerId}>
              <option value="">Choose a customer</option>
              {list.customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.outstandingCents ? ` · ${rand(c.outstandingCents)} outstanding` : ""}</option>)}
            </select>
          </label>
          <div className="bx-span"><button type="submit" className="rx-button">Show unpaid invoices</button></div>
        </form>
        {customerId ? (
          <form action={recordPayment} className="mfa-card bx-grid">
            <input type="hidden" name="customerId" value={customerId} />
            {chosen ? <input type="hidden" name="back" value={chosen.id} /> : null}
            <label>Amount received (R)<input name="amount" inputMode="decimal" required defaultValue={chosen ? randInput(chosen.balanceCents) : ""} placeholder="0,00" /></label>
            <label>Date received<input name="date" type="date" defaultValue={today} max={today} required /></label>
            <label>
              Method
              <select name="method" defaultValue="eft">
                {Object.entries(METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>Reference<input name="reference" maxLength={120} placeholder="As it appears on the statement" /></label>
            <label className="bx-span">Notes<input name="notes" maxLength={1000} /></label>
            <fieldset className="bx-span bx-alloc">
              <legend>Pay these invoices</legend>
              {open.length === 0 ? <p className="field-hint">This customer has no unpaid invoices. The whole amount is kept as credit.</p> : (
                <>
                  <p className="field-hint">Leave the amounts empty to pay the oldest invoices first. Anything left over is kept as credit for the customer.</p>
                  <table>
                    <thead><tr><th>Invoice</th><th>Due</th><th className="bx-num">Balance</th><th className="bx-num">Pay</th></tr></thead>
                    <tbody>
                      {open.map((doc) => (
                        <tr key={doc.id}>
                          <td>{doc.number}</td>
                          <td className={doc.overdue ? "bx-overdue" : undefined}>{shortDate(doc.dueDate)}</td>
                          <td className="bx-num">{rand(doc.balanceCents)}</td>
                          <td className="bx-num"><input name={`alloc_${doc.id}`} inputMode="decimal" aria-label={`Amount for ${doc.number}`} defaultValue={chosen && chosen.id === doc.id ? randInput(doc.balanceCents) : ""} placeholder="0,00" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </fieldset>
            <div className="form-actions bx-span"><button type="submit">Record payment</button></div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
