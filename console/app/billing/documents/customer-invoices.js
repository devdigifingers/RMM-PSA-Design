import Link from "next/link";
import { rand } from "../format";
import { DocTable } from "./doc-list";

export function CustomerInvoices({ docs, customerId, canManage }) {
  const list = docs.documents || [];
  const open = list.filter((doc) => doc.kind === "invoice" && ["issued", "partially_paid"].includes(doc.status));
  const outstanding = open.reduce((sum, doc) => sum + doc.balanceCents, 0);
  const overdue = open.filter((doc) => doc.overdue).reduce((sum, doc) => sum + doc.balanceCents, 0);
  return (
    <>
      <div className="bx-cards bx-cards-small">
        <section className="bx-card"><h2>Outstanding</h2><strong>{rand(outstanding)}</strong></section>
        <section className="bx-card"><h2>Overdue</h2><strong className={overdue ? "bx-overdue" : undefined}>{rand(overdue)}</strong></section>
      </div>
      {canManage ? (
        <p className="bx-actions-row">
          <Link className="rx-button" href={`/billing/quotes/new?customer=${customerId}`}>New quote</Link>
          {open.length ? <Link className="rx-button" href={`/billing/payments/new?customer=${customerId}`}>Record payment</Link> : null}
        </p>
      ) : null}
      <DocTable docs={list} kind="invoice" showKind empty="No quotes, invoices or credit notes for this customer yet." />
    </>
  );
}
