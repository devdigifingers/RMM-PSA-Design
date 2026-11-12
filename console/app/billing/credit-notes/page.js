import { DocList } from "../documents/doc-list";

export const metadata = { title: "Credit notes · Invoicing" };

export default function CreditNotesPage({ searchParams }) {
  return <DocList kind="credit_note" searchParams={searchParams} />;
}
