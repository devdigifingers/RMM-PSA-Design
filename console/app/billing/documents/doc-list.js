import Link from "next/link";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { KINDS, Notice, StatusPill, billingData, rand, shortDate } from "../billing-data";

const FILTERS = {
  invoice: [["", "All"], ["draft", "Drafts"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"]],
  quote: [["", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"], ["converted", "Invoiced"]],
  credit_note: [["", "All"], ["draft", "Drafts"], ["issued", "Open"], ["applied", "Applied"]],
};

const SAVED = { deleted: "Draft deleted.", voided: "Invoice voided." };

export async function DocList({ kind, searchParams }) {
  const query = await searchParams;
  const info = KINDS[kind];
  const status = FILTERS[kind].some(([key]) => key && key === query?.status) ? query.status : "";
  const q = String(query?.q || "").trim().slice(0, 80);
  const params = new URLSearchParams({ kind });
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const { flags, data: [body] } = await billingData(`/v1/billing/documents?${params}`);
  const docs = body.documents;
  const filterHref = (key) => {
    const next = new URLSearchParams();
    if (key) next.set("status", key);
    if (q) next.set("q", q);
    return `/billing/${info.path}${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <div className="dx-head">
          <div>
            <h1><AppTitle app="billing">{info.plural}</AppTitle></h1>
          </div>
          {body.canManage ? <Link className="rx-button bx-primary" href={`/billing/${info.path}/new`}>{info.new}</Link> : null}
        </div>
        <Notice params={query} saved={SAVED} />
        <div className="bx-toolbar">
          <nav className="bx-tabs" aria-label="Filter">
            {FILTERS[kind].map(([key, label]) => (
              <Link key={key || "all"} href={filterHref(key)} aria-current={status === key ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
          <form className="bx-search" action={`/billing/${info.path}`}>
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <input type="search" name="q" defaultValue={q} placeholder="Number, customer or reference" aria-label="Search" />
          </form>
        </div>
        <DocTable docs={docs} kind={kind} empty={q || status ? `No ${info.plural.toLowerCase()} match.` : `No ${info.plural.toLowerCase()} yet.`} />
      </main>
    </div>
  );
}

export function DocTable({ docs, kind, empty, showKind = false }) {
  return (
    <div className="systems desk-table bx-table">
      <table>
        <thead>
          <tr>
            <th>Number</th>
            {showKind ? <th>Type</th> : null}
            <th>Customer</th>
            <th>Date</th>
            <th>{kind === "quote" ? "Valid until" : kind === "invoice" ? "Due" : ""}</th>
            <th className="bx-num">Total</th>
            {kind === "invoice" || showKind ? <th className="bx-num">Balance</th> : null}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 ? (
            <tr><td className="empty" colSpan={showKind ? 8 : kind === "invoice" ? 7 : 6}>{empty}</td></tr>
          ) : docs.map((doc) => (
            <tr key={doc.id}>
              <td><Link className="bx-doc-link" href={`/billing/documents/${doc.id}`}>{doc.number || "Draft"}</Link></td>
              {showKind ? <td>{KINDS[doc.kind].word}</td> : null}
              <td>{doc.customerName}</td>
              <td>{shortDate(doc.issueDate)}</td>
              <td className={doc.overdue ? "bx-overdue" : undefined}>{doc.kind === "quote" ? shortDate(doc.validUntil) : doc.kind === "invoice" ? shortDate(doc.dueDate) : ""}</td>
              <td className="bx-num">{rand(doc.totalCents)}</td>
              {kind === "invoice" || showKind ? <td className="bx-num">{doc.kind === "invoice" ? rand(doc.balanceCents) : ""}</td> : null}
              <td><StatusPill label={doc.statusLabel} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
