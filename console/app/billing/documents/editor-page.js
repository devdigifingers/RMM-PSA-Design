import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { KINDS, billingData, billingFetch } from "../billing-data";
import { DocumentEditor, linesFromApi } from "./editor";

async function loadCommon() {
  const { flags, data: [customers, items, company] } = await billingData("/v1/billing/customers", "/v1/billing/items", "/v1/billing/settings/company");
  return { flags, customers: customers.customers, items: items.items, company };
}

function Frame({ flags, title, crumb, children }) {
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page bx-wide">
        <p className="bx-crumb">{crumb}</p>
        <div className="dx-head"><h1><AppTitle app="billing">{title}</AppTitle></h1></div>
        {children}
      </main>
    </div>
  );
}

export async function NewDocumentPage({ kind, searchParams }) {
  const query = await searchParams;
  const { flags, customers, items, company } = await loadCommon();
  if (!company.canManage) redirect(`/billing/${KINDS[kind].path}`);
  const s = company.settings;
  const initial = {
    customerId: /^\d+$/.test(query?.customer || "") ? query.customer : "",
    issueDate: company.today,
    termsDays: "",
    poNumber: "",
    reference: "",
    notes: kind === "credit_note" ? "" : s.defaultNotes || "",
    terms: kind === "credit_note" ? "" : s.defaultTermsText || "",
    template: s.defaultTemplate,
    priceMode: s.priceMode,
    lines: [],
  };
  let original = null;
  let vatRegistered = company.vat.registered;
  if (kind === "credit_note") {
    if (!/^\d+$/.test(query?.invoice || "")) {
      return (
        <Frame flags={flags} title="New credit note" crumb={<Link href="/billing/credit-notes">Credit notes</Link>}>
          <p className="bx-note">A credit note always reduces an issued invoice. Open the invoice and choose <strong>Credit note</strong>.</p>
          <p><Link className="rx-button" href="/billing/invoices?status=unpaid">Find the invoice</Link></p>
        </Frame>
      );
    }
    const detail = await billingFetch(`/v1/billing/documents/${query.invoice}`);
    if (detail.document.kind !== "invoice" || !detail.actions.includes("credit")) notFound();
    original = detail.document;
    vatRegistered = original.vatRegistered;
    initial.customerId = String(original.customerId);
    initial.creditsDocumentId = String(original.id);
    initial.template = original.template;
    initial.priceMode = original.priceMode;
    initial.lines = linesFromApi(detail.lines);
  }
  const customer = customers.find((c) => String(c.id) === initial.customerId);
  if (customer?.billingTemplate && kind !== "credit_note") initial.template = customer.billingTemplate;
  const info = KINDS[kind];
  return (
    <Frame flags={flags} title={info.new} crumb={<Link href={`/billing/${info.path}`}>{info.plural}</Link>}>
      <DocumentEditor
        kind={kind}
        initial={initial}
        customers={customers}
        items={items.filter((item) => item.active)}
        vatRegistered={vatRegistered}
        lockedCustomer={Boolean(original)}
        original={original}
      />
    </Frame>
  );
}

export async function EditDocumentPage({ id }) {
  if (!/^\d+$/.test(id)) notFound();
  const { flags, customers, items } = await loadCommon();
  const detail = await billingFetch(`/v1/billing/documents/${id}`);
  const d = detail.document;
  if (!detail.actions.includes("edit")) redirect(`/billing/documents/${id}`);
  const info = KINDS[d.kind];
  const initial = {
    customerId: String(d.customerId),
    issueDate: d.issueDate,
    termsDays: d.termsDays ?? "",
    validUntil: d.validUntil || "",
    poNumber: d.poNumber || "",
    reference: d.reference || "",
    notes: d.notes || "",
    terms: d.terms || "",
    template: d.template,
    priceMode: d.priceMode,
    creditReason: d.creditReason || "",
    creditsDocumentId: d.creditsDocumentId ? String(d.creditsDocumentId) : "",
    lines: linesFromApi(detail.lines),
  };
  const original = d.creditsDocumentId ? detail.related.find((r) => r.id === d.creditsDocumentId) || null : null;
  return (
    <Frame flags={flags} title={`Edit draft ${info.word.toLowerCase()}`} crumb={<><Link href={`/billing/${info.path}`}>{info.plural}</Link> / <Link href={`/billing/documents/${d.id}`}>Draft</Link></>}>
      <DocumentEditor
        kind={d.kind}
        docId={d.id}
        initial={initial}
        customers={customers}
        items={items.filter((item) => item.active)}
        vatRegistered={d.vatRegistered}
        lockedCustomer={Boolean(d.creditsDocumentId)}
        original={original}
      />
    </Frame>
  );
}
