import { DocList } from "../documents/doc-list";

export const metadata = { title: "Quotes · Invoicing" };

export default function QuotesPage({ searchParams }) {
  return <DocList kind="quote" searchParams={searchParams} />;
}
