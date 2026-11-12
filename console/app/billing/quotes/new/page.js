import { NewDocumentPage } from "../../documents/editor-page";

export const metadata = { title: "New quote · Invoicing" };

export default function NewQuotePage({ searchParams }) {
  return <NewDocumentPage kind="quote" searchParams={searchParams} />;
}
