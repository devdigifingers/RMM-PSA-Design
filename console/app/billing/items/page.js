import Link from "next/link";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";
import { ITEM_TYPE_LABELS, Notice, UNIT_LABELS, billingData, rand } from "../billing-data";

export const metadata = { title: "Items · Invoicing" };

const SAVED = { itemCreated: "Item added.", itemUpdated: "Item saved." };

export default async function ItemsPage({ searchParams }) {
  const params = await searchParams;
  const { flags, data: [list] } = await billingData("/v1/billing/items?all=1");
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main dx-page bx-page">
        <div className="dx-head">
          <h1><AppTitle app="billing">Items</AppTitle></h1>
          {list.canManage ? <Link className="rx-button bx-primary" href="/billing/items/new">New item</Link> : null}
        </div>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">Products and services you sell. Picking one on a document fills in the description, price and tax; you can still edit the line.</p>
        <div className="tech-table">
          <table>
            <thead><tr><th>Item</th><th>Type</th><th>Unit</th><th>Tax</th><th className="r">Price (excl.)</th><th>Status</th></tr></thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id} className={item.active ? undefined : "tech-muted"}>
                  <td className="tech-name">
                    {list.canManage ? <Link href={`/billing/items/${item.id}`}>{item.name}</Link> : item.name}
                    {item.sku ? <span className="token-by">{item.sku}</span> : null}
                  </td>
                  <td>{ITEM_TYPE_LABELS[item.type] || item.type}</td>
                  <td>{UNIT_LABELS[item.unit] || item.unit}</td>
                  <td>{list.taxLabels[item.taxType]}</td>
                  <td className="r tech-nowrap">{item.unitPriceCents ? rand(item.unitPriceCents) : "Set on the line"}</td>
                  <td>{item.active ? "Active" : "Archived"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
