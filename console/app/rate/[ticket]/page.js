import { Wordmark } from "../../mark";
import { RateForm } from "./rate-form";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Rate your support", robots: { index: false } };

export default async function RatePage({ params, searchParams }) {
  const { ticket } = await params;
  const query = await searchParams;
  const ticketId = /^\d{1,12}$/.test(String(ticket || "")) ? Number(ticket) : 0;
  const signature = /^[A-Za-z0-9_-]{20,64}$/.test(String(query?.s || "")) ? String(query.s) : "";
  const preset = ["good", "ok", "bad"].includes(query?.r) ? query.r : null;
  let info = null;
  if (ticketId && signature) {
    const response = await fetch(`${apiUrl}/v1/public/csat/${ticketId}?s=${encodeURIComponent(signature)}`, { cache: "no-store" });
    if (response.ok) info = await response.json();
  }

  return (
    <main className="join">
      <div className="join-card">
        <div className="join-brand"><Wordmark surface="auto" /></div>
        {!info ? (
          <>
            <h1>Link not valid</h1>
            <p className="join-org">This rating link is not valid. Check that you opened the whole link from the email.</p>
          </>
        ) : (
          <>
            <h1>How did {info.orgName} do?</h1>
            <p className="join-org">Ticket #{ticketId}: {info.subject}</p>
            <RateForm ticketId={ticketId} signature={signature} initial={info.rating} preset={preset} comment={info.comment} />
          </>
        )}
      </div>
    </main>
  );
}
