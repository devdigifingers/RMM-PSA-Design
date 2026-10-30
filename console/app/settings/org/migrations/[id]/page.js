import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { ConsoleBar } from "../../../../bar";
import { accountFromSession, formatWhen, navFlags } from "../../../../account-data";
import { decideMigration } from "../../../../actions";
import { apiGet } from "../../../../customers/shared";
import { MIGRATION_STATUS, MODE_LABEL, countLines, scopeLine, statusLevel } from "../../../../migration-labels";

export const metadata = { title: "Data migration · Digital Fingers RMM" };

const SAVED = { approve: "Thank you. Your approval is recorded.", decline: "The request was declined. Nothing will change." };

export default async function TenantMigrationPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  const roles = account.user?.roles || [];
  if (account.user?.isPlatformAdmin || !(roles.includes("owner") || roles.includes("admin"))) forbidden();
  const response = await apiGet(`/v1/migrations/${Number(id)}`);
  if (!response.ok) notFound();
  const m = await response.json();
  const outgoing = m.side === "source";
  const other = outgoing ? m.target.name : m.source.name;
  const canDecide = m.myRoles.length > 0;
  const lines = countLines(m.dryRun.counts);

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page mig-tenant">
        <p className="desk-back"><Link href="/settings/org/migrations">← Data migrations</Link></p>
        <h1>MIG-{m.id} <span className={`usage-state${statusLevel(m.status)}`}>{MIGRATION_STATUS[m.status] || m.status}</span></h1>
        <p className="org-name">Requested by {m.requestedBy.name} on {formatWhen(m.submittedAt)}.</p>
        {SAVED[query?.saved] ? <p className="saved">{SAVED[query.saved]}</p> : null}
        {query?.message ? <p className="error">{String(query.message)}</p> : null}

        <section className="mig-tenant-card">
          <h2>{outgoing ? `${MODE_LABEL[m.mode]} data to ${other}` : `${MODE_LABEL[m.mode]} data from ${other}`}</h2>
          <p>
            {outgoing
              ? m.mode === "move"
                ? `These records go to ${other}. You keep a read-only copy for 30 days, then it is removed.`
                : `${other} gets its own copy of these records. Yours stay as they are.`
              : `These records are added to your organisation.`}
          </p>
          <dl className="admin-dl">
            <dt>What</dt><dd>{scopeLine(m.scope)}</dd>
            <dt>When</dt><dd>{m.scheduleAt ? formatWhen(m.scheduleAt) : "As soon as everyone approves"}</dd>
            {m.expiresAt ? <><dt>Decide by</dt><dd>{formatWhen(m.expiresAt)}</dd></> : null}
          </dl>
          {lines.length ? <ul className="mig-counts">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          {m.dryRun.conflicts ? <p className="org-name">{m.dryRun.conflicts} record{m.dryRun.conflicts === 1 ? "" : "s"} matched existing ones and {m.dryRun.conflicts === 1 ? "is" : "are"} merged, renamed or skipped as the platform team chose.</p> : null}
          {m.dryRun.ticketNumbers.count ? <p className="org-name">{m.dryRun.ticketNumbers.note}</p> : null}
          {m.dryRun.blocked.length ? <ul className="mig-errors">{m.dryRun.blocked.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        </section>

        <section className="mig-tenant-card">
          <h2>Approvals</h2>
          <ul className="mig-approvals">
            {m.approvals.map((item) => (
              <li key={item.role}>
                <strong>{item.role === "platform_admin" ? "Digital Fingers platform team" : item.role === (outgoing ? "source_owner" : "target_owner") ? "Your organisation" : other}</strong>
                {item.decision ? (
                  <span className={`usage-state${item.decision === "declined" ? " is-full" : ""}`}>{item.decision === "approved" ? "Approved" : "Declined"}</span>
                ) : <span className="usage-state is-near">Waiting</span>}
                {item.decidedAt ? <small>{formatWhen(item.decidedAt)}</small> : null}
              </li>
            ))}
          </ul>
        </section>

        {canDecide ? (
          <section className="mig-tenant-card mig-decide">
            <h2>Your decision</h2>
            {outgoing ? <p className="mig-consent"><strong>{m.consent}</strong></p> : null}
            <div className="mig-decide-row">
              <form action={decideMigration}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="decision" value="approve" />
                <button type="submit">Approve</button>
              </form>
              <details className="mig-decline">
                <summary className="admin-secondary">Decline…</summary>
                <form action={decideMigration}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <label>
                    Why are you declining?
                    <textarea name="reason" required maxLength={1000} rows={3} />
                  </label>
                  <button type="submit" className="danger">Decline request</button>
                </form>
              </details>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
