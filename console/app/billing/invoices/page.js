import { DocList } from "../documents/doc-list";

export const metadata = { title: "Invoices · Invoicing" };

export default function InvoicesPage({ searchParams }) {
  return <DocList kind="invoice" searchParams={searchParams} />;
}
