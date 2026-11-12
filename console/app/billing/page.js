import Link from "next/link";
import { ConsoleBar } from "../bar";
import { AppTitle } from "../mark";
import { billingData, rand } from "./billing-data";
import { DocTable } from "./documents/doc-list";

export const metadata = { title: "Invoicing" };

function Usage({ label, used, limit }) {
  if (limit == null) return null;
  const share = limit ? used / limit : 1;
  const tone = share >= 1 ? "is-full" : share >= 0.8 ? "is-near" : "";
  return (
    <div className={`bx-usage ${tone}`}>
      <div className="bx-usage-head"><span>{label}</span><strong>{used} of {limit}</strong></div>
      <div className="bx-usage-bar"><span style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} /></div>
      {share >= 1 ? <p>Limit reached for this month. Drafts and payments still work; upgrade to Invoicing Pro for no limit.</p> : share >= 0.8 ? <p>Nearly at this month&apos;s limit.</p> : null}
    </div>
  );
}

export default async function BillingHome() {
  const { flags, data: [overview, company] } = await billingData("/v1/billing/overview", "/v1/billing/settings/company");
  const manage = overview.canManage;
  const setUp = Boolean(company.settings.legalName);
  const cards = [
    ["Outstanding", rand(overview.outstandingCents), "Issued and not yet paid", "/billing/invoices?status=unpaid"],
    ["Overdue", rand(overview.overdueCents), overview.overdueCount ? `${overview.overdueCount} invoice${overview.overdueCount === 1 ? "" : "s"} past the due date` : "Nothing past the due date", "/billing/invoices?status=overdue"],
    ["Paid this month", rand(overview.paidThisMonthCents), "Payments received since the 1st", "/billing/payments"],
    ["Open quotes", String(overview.openQuotes), `${overview.drafts} draft${overview.drafts === 1 ? "" : "s"} waiting`, "/billing/quotes?status=sent"],
  ];
  const { invoices, emails } = overview.usage;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <div className="dx-head">
          <div>
            <h1><AppTitle app="billing">Invoicing</AppTitle></h1>
            <p className="rx-lead">Quotes, invoices and getting paid.</p>
          </div>
          {manage && setUp ? (
            <div className="bx-actions-row">
              <Link className="rx-button" href="/billing/quotes/new">New quote</Link>
              <Link className="rx-button bx-primary" href="/billing/invoices/new">New invoice</Link>
            </div>
          ) : null}
        </div>
        <div className="bx-cards">
          {cards.map(([title, value, detail, href]) => (
            <Link key={title} className="bx-card" href={href}>
              <h2>{title}</h2>
              <strong>{value}</strong>
              <p>{detail}</p>
            </Link>
          ))}
        </div>
        {invoices.limit != null || emails.limit != null ? (
          <section className="bx-usage-row" aria-label="This month's usage">
            <Usage label="Invoices this month" used={invoices.used} limit={invoices.limit} />
            <Usage label="Emails this month" used={emails.used} limit={emails.limit} />
          </section>
        ) : null}
        {!setUp ? (
          <section className="bx-setup">
            <h2>Getting started</h2>
            <p>Add your company details, VAT status and bank details first. They print on every quote and invoice.</p>
            {manage ? <Link className="rx-button bx-primary" href="/billing/settings/company">Company and tax</Link> : null}
          </section>
        ) : null}
        <h2 className="bx-sub">Recent</h2>
        <DocTable docs={overview.recent} kind="invoice" showKind empty="No quotes or invoices yet." />
      </main>
    </div>
  );
}
