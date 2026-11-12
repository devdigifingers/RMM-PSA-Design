import { HostedPage } from "../hosted";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function PayPage({ params }) {
  return <HostedPage pathKind="pay" params={params} />;
}
