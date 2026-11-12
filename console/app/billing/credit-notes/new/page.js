import { NewDocumentPage } from "../../documents/editor-page";

export const metadata = { title: "New credit note · Invoicing" };

export default function NewCreditNotePage({ searchParams }) {
  return <NewDocumentPage kind="credit_note" searchParams={searchParams} />;
}
