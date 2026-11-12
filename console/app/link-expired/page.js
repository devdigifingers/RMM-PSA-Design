import { hostedFetch, TOKEN } from "../pay/hosted";
import "../pay/hosted.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link expired", robots: { index: false, follow: false }, referrer: "no-referrer" };

const WORDS = { invoice: "invoice", quote: "quote", credit_note: "credit note" };

export default async function LinkExpiredPage({ searchParams }) {
  const query = await searchParams;
  const kind = query?.k === "q" ? "q" : "pay";
  let info = null;
  if (TOKEN.test(String(query?.t || ""))) {
    const result = await hostedFetch(kind, query.t, { count: false });
    if (result.status === 410) info = result.body;
  }
  const word = info ? WORDS[info.kind] || "document" : "document";
  const supplier = info?.supplier;
  return (
    <div className="hp-page hp-gone" style={{ "--primary": "#6D28D9", "--primary-text": "#5B21B6", "--on-primary": "#fff" }}>
      <section className="hp-panel">
        <h1>This link has expired</h1>
        <p>
          {info ? `The link to ${word} ${info.number} is no longer active` : "This link is no longer active"}
          {supplier?.name ? `. ${supplier.name} can send you a new one.` : ". Ask the sender for a new one."}
        </p>
        {supplier && (supplier.email || supplier.phone) ? (
          <div className="contact">
            {supplier.email ? <a href={`mailto:${supplier.email}?subject=${encodeURIComponent(`New link for ${info.number}`)}`}>{supplier.email}</a> : null}
            {supplier.phone ? <a href={`tel:${supplier.phone.replace(/[^\d+]/g, "")}`}>{supplier.phone}</a> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
