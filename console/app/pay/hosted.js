import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { rand, shortDate } from "../billing/format";
import { CopyButton, HostedDoc, PrintButton, QuoteDecision } from "./hosted-client";
import "./hosted.css";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
export const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

export async function hostedFetch(pathKind, token, { count = true } = {}) {
  const incoming = await headers();
  const response = await fetch(`${apiUrl}/v1/public/billing/${pathKind}/${token}${count ? "" : "?count=0"}`, {
    headers: { "x-forwarded-for": incoming.get("x-forwarded-for") || "", "user-agent": incoming.get("user-agent") || "" },
    cache: "no-store",
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const days = (from, to) => Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);

function chip(doc) {
  const now = today();
  if (doc.kind === "invoice") {
    if (doc.status === "paid") return ["Paid", "is-paid"];
    if (doc.status === "void") return ["Void", "is-grey"];
    if (doc.status === "credited") return ["Credited", "is-grey"];
    if (doc.overdue) return [`Overdue · was due ${shortDate(doc.dueDate)}`, "is-overdue"];
    const left = days(now, doc.dueDate);
    const due = left === 0 ? "due today" : `due in ${left} day${left === 1 ? "" : "s"}`;
    return [`${doc.status === "partially_paid" ? "Partly paid" : "Awaiting payment"} · ${due}`, ""];
  }
  if (doc.kind === "quote") {
    if (doc.status === "accepted" || doc.status === "converted") return ["Accepted", "is-paid"];
    if (doc.status === "declined") return ["Declined", "is-grey"];
    if (doc.validUntil < now) return ["Expired", "is-grey"];
    return [`Valid until ${shortDate(doc.validUntil)}`, ""];
  }
  return [doc.statusLabel, "is-grey"];
}

const Icon = ({ d }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const PHONE = "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z";
const MAIL = "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 2-10 7L2 6";
const BANK = "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3";
const CLOCK = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v4l3 2";
const HISTORY = "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2";
const DOWNLOAD = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";

export async function HostedPage({ pathKind, params }) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();
  const staff = Boolean((await cookies()).get("df_session")?.value);
  const { status, body: doc } = await hostedFetch(pathKind, token, { count: !staff });
  if (status === 410) redirect(`/link-expired?${new URLSearchParams({ k: pathKind, t: token })}`);
  if (status !== 200) notFound();
  const s = doc.supplier;
  const t = s.tokens;
  const word = doc.kind === "invoice" ? "Invoice" : doc.kind === "quote" ? "Quote" : "Credit note";
  const [chipText, chipTone] = chip(doc);
  const pdf = `/${pathKind}/${token}/pdf`;
  const bank = doc.bank && doc.kind === "invoice" && doc.balanceCents > 0 && !["void", "credited"].includes(doc.status) ? doc.bank : null;
  const bankRows = bank ? [["Bank", bank.bankName], ["Account name", bank.accountName], ["Account number", bank.accountNumber], ["Branch code", bank.branchCode], ["Account type", bank.accountType], ["BIC / SWIFT", bank.swift]].filter(([, v]) => v) : [];

  return (
    <div className="hp-page" style={{ "--primary": t.primary, "--secondary": t.secondary, "--on-primary": t.onPrimary, "--primary-text": t.primaryText }}>
      <header className="hp-top">
        {s.logo ? <img src={s.logo} alt={s.name} /> : <span className="name">{s.name}</span>}
        <div className="contact">
          {s.phone ? <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}><Icon d={PHONE} />{s.phone}</a> : null}
          {s.email ? <a href={`mailto:${s.email}`}><Icon d={MAIL} />{s.email}</a> : null}
        </div>
      </header>

      <div className="hp-bar">
        <div>
          <h1>{word} {doc.number}</h1>
          <p className="sub"><span className={`chip ${chipTone}`}>{chipText}</span><span>Issued {shortDate(doc.issueDate)} to {doc.recipient.name}</span></p>
        </div>
        <div className="acts">
          <a className="btn" href={pdf}><Icon d={DOWNLOAD} />Download PDF</a>
          <PrintButton href={`${pdf}?inline=1`} />
        </div>
      </div>

      <div className="hp-main">
        <HostedDoc html={doc.html} title={`${word} ${doc.number}`} />
        <aside className="hp-side">
          <section className="hp-panel">
            {doc.kind === "invoice" ? (
              <>
                <p className="lbl">{doc.balanceCents > 0 ? "Amount due" : "Balance"}</p>
                <p className="amt">{rand(doc.balanceCents)}</p>
                {doc.balanceCents > 0 && doc.dueDate ? <p className="when"><Icon d={CLOCK} />Due {shortDate(doc.dueDate)}</p> : null}
                {doc.status === "paid" ? <p className="done">Paid in full. Thank you.</p> : null}
              </>
            ) : doc.kind === "quote" ? (
              <>
                <p className="lbl">Quote total</p>
                <p className="amt">{rand(doc.totalCents)}</p>
                <p className="when"><Icon d={CLOCK} />Valid until {shortDate(doc.validUntil)}</p>
                {doc.status === "accepted" || doc.status === "converted" ? <p className="done">Accepted. {s.name} will be in touch.</p> : null}
                {doc.status === "declined" ? <p className="muted" style={{ marginTop: 12 }}>This quote was declined.</p> : null}
              </>
            ) : (
              <>
                <p className="lbl">Credit amount</p>
                <p className="amt">{rand(doc.totalCents)}</p>
              </>
            )}
          </section>

          {doc.canDecide ? (
            <section className="hp-panel">
              <h3>Happy with this quote?</h3>
              <QuoteDecision token={token} />
            </section>
          ) : null}

          {bank ? (
            <section className="hp-panel">
              <h3><Icon d={BANK} />Pay by EFT</h3>
              {bankRows.map(([k, v]) => (
                <div key={k} className="hp-copy">
                  <div><div className="k">{k}</div><div className="v">{v}</div></div>
                  {k === "Account number" || k === "Branch code" || k === "BIC / SWIFT" ? <CopyButton value={String(v).replace(/\s/g, "")} /> : null}
                </div>
              ))}
              <div className="hp-ref">
                <div><div className="k">Use reference</div><div className="v">{doc.number}</div></div>
                <CopyButton value={doc.number} />
              </div>
            </section>
          ) : null}

          {doc.kind === "invoice" ? (
            <section className="hp-panel">
              <h3><Icon d={HISTORY} />Payments</h3>
              {doc.payments?.length ? (
                <ul className="hp-pays">
                  {doc.payments.map((p, index) => <li key={index}><span>{shortDate(p.date)}</span><strong>{rand(p.amountCents)}</strong></li>)}
                </ul>
              ) : <p className="muted">No payments yet. Payments will appear here once {s.name} has recorded them.</p>}
            </section>
          ) : null}
        </aside>
      </div>

      <footer className="hp-foot">
        <span>{[s.legalName, s.address ? s.address.replace(/\s*\n\s*/g, ", ") : null, s.ids].filter(Boolean).join(" · ")}</span>
        <span className="pw">{doc.free ? <><img src="/icon.svg" alt="" />Digital Fingers Invoicing · </> : null}Private link. Please do not share it.</span>
      </footer>
    </div>
  );
}
