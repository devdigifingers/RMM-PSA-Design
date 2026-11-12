import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { saveItem } from "../../actions";
import { ITEM_TYPE_LABELS, Notice, UNIT_LABELS, billingData, randInput } from "../../billing-data";

export const metadata = { title: "Item · Invoicing" };

export default async function ItemPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const isNew = id === "new";
  if (!isNew && !/^\d+$/.test(id)) notFound();
  const { flags, data: [view] } = await billingData(isNew ? "/v1/billing/items" : `/v1/billing/items/${id}`);
  if (!view.canManage) notFound();
  const item = isNew ? { name: "", description: "", sku: "", type: "service", unit: "each", unitPriceCents: 0, taxType: "standard", accountCode: "", costCents: null, active: true } : view.item;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page bx-settings">
        <p className="bx-crumb"><Link href="/billing/items">Items</Link> / {isNew ? "New item" : item.name}</p>
        <h1><AppTitle app="billing">{isNew ? "New item" : item.name}</AppTitle></h1>
        <Notice params={query} saved={{}} />
        <form action={saveItem} className="mfa-card bx-grid">
          <input type="hidden" name="id" value={isNew ? "" : item.id} />
          <label className="bx-span">Name<input name="name" defaultValue={item.name} required maxLength={160} /></label>
          <label className="bx-span">Description<textarea name="description" rows={2} defaultValue={item.description} maxLength={2000} /></label>
          <label>Code (SKU)<input name="sku" defaultValue={item.sku} maxLength={60} placeholder="Optional" /></label>
          <label>
            Type
            <select name="type" defaultValue={item.type}>
              {view.types.map((key) => <option key={key} value={key}>{ITEM_TYPE_LABELS[key] || key}</option>)}
            </select>
          </label>
          <label>
            Unit
            <select name="unit" defaultValue={item.unit}>
              {view.units.map((key) => <option key={key} value={key}>{UNIT_LABELS[key] || key}</option>)}
            </select>
          </label>
          <label>
            Tax
            <select name="taxType" defaultValue={item.taxType}>
              {view.taxTypes.map((key) => <option key={key} value={key}>{view.taxLabels[key]}</option>)}
            </select>
            <small className="field-hint">Ignored while you are not VAT registered: every line then uses No VAT.</small>
          </label>
          <label>Price excl. VAT (R)<input name="unitPrice" inputMode="decimal" defaultValue={randInput(item.unitPriceCents)} placeholder="0,00" /></label>
          <label>Cost (R)<input name="cost" inputMode="decimal" defaultValue={randInput(item.costCents)} placeholder="Optional, never printed" /></label>
          <label>Account code<input name="accountCode" defaultValue={item.accountCode} maxLength={40} placeholder="Optional, for exports" /></label>
          <label className="admin-check"><input type="checkbox" name="active" defaultChecked={item.active} /> Active (offered on new documents)</label>
          <div className="form-actions bx-span"><button type="submit">{isNew ? "Add item" : "Save item"}</button></div>
        </form>
      </main>
    </div>
  );
}
