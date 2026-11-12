import { HostedPage } from "../../pay/hosted";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function QuotePage({ params }) {
  return <HostedPage pathKind="q" params={params} />;
}
