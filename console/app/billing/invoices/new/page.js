import { NewDocumentPage } from "../../documents/editor-page";

export const metadata = { title: "New invoice · Invoicing" };

export default function NewInvoicePage({ searchParams }) {
  return <NewDocumentPage kind="invoice" searchParams={searchParams} />;
}
