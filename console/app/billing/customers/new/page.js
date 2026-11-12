import Link from "next/link";
import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { createCustomer } from "../../actions";
import { Notice, VAT_STATUS_LABELS, billingData } from "../../billing-data";

export const metadata = { title: "New customer · Invoicing" };

export default async function NewBillingCustomerPage({ searchParams }) {
  const query = await searchParams;
  const { flags } = await billingData();
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <p className="bx-crumb"><Link href="/billing/customers">Customers</Link> / New customer</p>
        <div className="dx-head"><h1><AppTitle app="billing">New customer</AppTitle></h1></div>
        <Notice params={query} saved={{}} />
        <form action={createCustomer} className="mfa-card bx-grid">
          <label className="bx-span">Name<input name="name" required maxLength={160} autoFocus /></label>
          <label>Billing contact<input name="billingContact" maxLength={120} /></label>
          <label>Billing email<input name="billingEmail" type="email" maxLength={200} /></label>
          <label className="bx-span">Billing address<textarea name="billingAddress" rows={3} maxLength={400} placeholder={"18 Voortrekker Road\nParow Industria, Cape Town, 7493"} /></label>
          <label>
            VAT status
            <select name="vatStatus" defaultValue="unknown">
              {Object.entries(VAT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>VAT number<input name="vatNumber" inputMode="numeric" maxLength={14} placeholder="4xxxxxxxxx" /></label>
          <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="365" placeholder="Company default" /></label>
          <div className="form-actions bx-span"><button type="submit">Add customer</button></div>
        </form>
      </main>
    </div>
  );
}
