import Link from "next/link";
import { notFound } from "next/navigation";
import { formatWhen } from "../../../account-data";
import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { KINDS, METHOD_LABELS, Notice, StatusPill, billingData, rand, shortDate } from "../../billing-data";
import { PreviewFrame } from "../preview-frame";
import { DocActions, LinkBox } from "../doc-actions";

export const metadata = { title: "Document · Invoicing" };

const SAVED = {
  draft: "Draft saved.",
  issued: "Issued. The number is final and the document can no longer change.",
  finalised: "Quote finalised.",
  sent: "Sent.",
  accepted: "Marked as accepted.",
  declined: "Marked as declined.",
  converted: "Draft invoice created from the quote.",
  voided: "Invoice voided.",
  payment: "Payment recorded.",
};

const EVENTS = {
  created: "Draft created", issued: "Issued", finalised: "Quote finalised", sent: "Sent", viewed: "Viewed online", accepted: "Accepted", declined: "Declined",
  converted: "Converted to an invoice", voided: "Voided", credited: "Credit note applied", payment_recorded: "Payment recorded", link_regenerated: "New link made",
};

function eventText(event) {
  const label = EVENTS[event.type] || event.type;
  const who = event.actorType === "customer" ? "customer" : event.actorName;
  const p = event.payload || {};
  const extra = event.type === "sent" && p.to ? ` to ${p.to}` : event.type === "payment_recorded" && p.amountCents ? ` · ${rand(p.amountCents)}` : event.type === "credited" && p.creditNote ? ` · ${p.creditNote}` : event.type === "voided" && p.reason ? ` · ${p.reason}` : "";
  return `${label}${extra}${who ? ` · ${who}` : ""}`;
}

export default async function DocumentPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const { flags, data: [detail] } = await billingData(`/v1/billing/documents/${id}`);
  const d = detail.document;
  const info = KINDS[d.kind];
  const title = d.kind === "invoice" ? (d.vatRegistered ? "Tax invoice" : "Invoice") : info.word;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page bx-wide">
        <p className="bx-crumb"><Link href={`/billing/${info.path}`}>{info.plural}</Link> / {d.number || "Draft"}</p>
        <div className="dx-head">
          <div>
            <h1><AppTitle app="billing">{title} {d.number || "(draft)"}</AppTitle></h1>
            <p className="rx-lead"><StatusPill label={d.statusLabel} /> <Link href={`/billing/customers/${d.customerId}`}>{d.customerName}</Link></p>
          </div>
        </div>
        <Notice params={query} saved={SAVED} />
        {detail.canManage ? <DocActions doc={d} actions={detail.actions} recipientEmail={d.recipient?.email || ""} attachPdf={detail.defaults.attachPdf} /> : null}
        <div className="bx-doc">
          <PreviewFrame src={`/billing/api/documents/${d.id}/preview`} />
          <aside className="bx-side">
            <section className="bx-panel">
              <h2>Summary</h2>
              <dl className="bx-facts">
                <dt>Date</dt><dd>{shortDate(d.issueDate)}</dd>
                {d.kind === "invoice" ? <><dt>Due</dt><dd className={d.overdue ? "bx-overdue" : undefined}>{shortDate(d.dueDate)}</dd></> : null}
                {d.kind === "quote" ? <><dt>Valid until</dt><dd>{shortDate(d.validUntil)}</dd></> : null}
                <dt>Total</dt><dd>{rand(d.totalCents)}</dd>
                {d.kind === "invoice" && d.status !== "draft" ? (
                  <>
                    <dt>Paid</dt><dd>{rand(d.paidCents)}</dd>
                    {d.creditedCents ? <><dt>Credited</dt><dd>{rand(d.creditedCents)}</dd></> : null}
                    <dt>Balance</dt><dd><strong>{rand(d.balanceCents)}</strong></dd>
                  </>
                ) : null}
                {d.kind === "credit_note" && d.status !== "draft" ? <><dt>Applied</dt><dd>{rand(d.creditedCents)}</dd><dt>Left as credit</dt><dd>{rand(d.balanceCents)}</dd></> : null}
                {d.status !== "draft" ? <><dt>Views</dt><dd>{d.viewCount ? `${d.viewCount} · last ${formatWhen(d.lastViewedAt)}` : "Not opened yet"}</dd></> : null}
                {d.voidReason ? <><dt>Void reason</dt><dd>{d.voidReason}</dd></> : null}
              </dl>
            </section>
            {detail.link ? (
              <section className="bx-panel">
                <h2>Online link</h2>
                <LinkBox docId={d.id} url={detail.link} canManage={detail.canManage} />
              </section>
            ) : null}
            {detail.payments.length ? (
              <section className="bx-panel">
                <h2>Payments</h2>
                <ul className="bx-list">
                  {detail.payments.map((p, index) => <li key={index}><span>{shortDate(p.date)} · {METHOD_LABELS[p.method] || p.method}</span><strong>{rand(p.amountCents)}</strong></li>)}
                </ul>
              </section>
            ) : null}
            {detail.related.length ? (
              <section className="bx-panel">
                <h2>Related</h2>
                <ul className="bx-list">
                  {detail.related.map((r) => <li key={r.id}><Link href={`/billing/documents/${r.id}`}>{KINDS[r.kind].word} {r.number || "(draft)"}</Link><strong>{rand(r.totalCents)}</strong></li>)}
                </ul>
              </section>
            ) : null}
            <section className="bx-panel">
              <h2>History</h2>
              <ol className="bx-timeline">
                {detail.events.map((event, index) => <li key={index}><span>{eventText(event)}</span><time>{formatWhen(event.at)}</time></li>)}
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
