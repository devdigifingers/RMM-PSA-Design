import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { saveCustomerBilling } from "../../actions";
import { Notice, TEMPLATE_LABELS, VAT_STATUS_LABELS, billingData } from "../../billing-data";
import { CustomerInvoices } from "../../documents/customer-invoices";

export const metadata = { title: "Customer · Invoicing" };

export default async function BillingCustomerPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const tab = query?.tab === "details" ? "details" : "invoices";
  const { flags, data: [view, docs] } = await billingData(`/v1/billing/customers/${id}`, `/v1/billing/documents?customer=${id}`);
  const c = view.customer;
  const edit = view.canManage;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <p className="bx-crumb"><Link href="/billing/customers">Customers</Link> / {c.name}</p>
        <div className="dx-head">
          <h1><AppTitle app="billing">{c.name}</AppTitle></h1>
          {edit ? <Link className="rx-button bx-primary" href={`/billing/invoices/new?customer=${c.id}`}>New invoice</Link> : null}
        </div>
        <nav className="bx-tabs" aria-label="Customer">
          <Link href={`/billing/customers/${c.id}`} aria-current={tab === "invoices" ? "page" : undefined}>Invoices</Link>
          <Link href={`/billing/customers/${c.id}?tab=details`} aria-current={tab === "details" ? "page" : undefined}>Billing details</Link>
        </nav>
        <Notice params={query} saved={{ customer: "Billing details saved.", created: "Customer added." }} />
        {tab === "invoices" ? (
          <CustomerInvoices docs={docs} customerId={c.id} canManage={edit} />
        ) : (
          <form action={saveCustomerBilling} className="mfa-card bx-grid bx-settings">
            <input type="hidden" name="id" value={c.id} />
            <label>
              VAT status
              <select name="vatStatus" defaultValue={c.vatStatus} disabled={!edit}>
                {view.vatStatuses.map((key) => <option key={key} value={key}>{VAT_STATUS_LABELS[key]}</option>)}
              </select>
              <small className="field-hint">Their VAT number prints on your invoices when they are registered.</small>
            </label>
            <label>VAT number<input name="vatNumber" defaultValue={c.vatNumber} inputMode="numeric" maxLength={14} disabled={!edit} placeholder="4xxxxxxxxx" /></label>
            <label className="bx-span">Registered name<input name="registeredName" defaultValue={c.registeredName} maxLength={160} disabled={!edit} placeholder={c.name} /></label>
            <label>Billing contact<input name="billingContact" defaultValue={c.billingContact} maxLength={120} disabled={!edit} /></label>
            <label>Billing email<input name="billingEmail" type="email" defaultValue={c.billingEmail} maxLength={200} disabled={!edit} placeholder={c.email || ""} /></label>
            <label className="bx-span">CC (comma separated)<input name="billingCc" defaultValue={c.billingCc} maxLength={400} disabled={!edit} /></label>
            <label className="bx-span">Billing address<textarea name="billingAddress" rows={3} defaultValue={c.billingAddress} maxLength={400} disabled={!edit} placeholder={c.address || ""} /></label>
            <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="365" defaultValue={c.paymentTermsDays ?? ""} disabled={!edit} placeholder="Company default" /></label>
            <label>
              Template
              <select name="billingTemplate" defaultValue={c.billingTemplate || ""} disabled={!edit}>
                <option value="">Company default</option>
                {view.templates.map((key) => <option key={key} value={key}>{TEMPLATE_LABELS[key]}</option>)}
              </select>
            </label>
            <label className="admin-check bx-span"><input type="checkbox" name="billingReminders" defaultChecked={c.billingReminders} disabled={!edit} /> Send payment reminders</label>
            {edit ? <div className="form-actions bx-span"><button type="submit">Save billing details</button></div> : null}
          </form>
        )}
      </main>
    </div>
  );
}
