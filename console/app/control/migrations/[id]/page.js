import Link from "next/link";
import { platformGet } from "../../api";
import { migrationAction } from "../../actions";
import { formatDate } from "../../catalog";
import { MIGRATION_STATUS, MODE_LABEL, countLines, eventLabel, scopeLine, statusLevel } from "../../../migration-labels";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Migration · Digital Fingers RMM" };

const SAVED = {
  submitted: "Request sent. The owners of both tenants and the other platform admins were emailed.",
  edited: "Request changed. Earlier approvals were cleared and everyone was asked again.",
  unchanged: "Nothing changed, so nothing was saved.",
  approve: "Approval recorded.",
  decline: "Request declined.",
  cancel: "Request cancelled. Nothing was changed.",
  rollback: "Rollback requested. A different platform admin has to approve it.",
  "rollback-approve": "Rollback approved. It runs within a minute.",
  "rollback-cancel": "Rollback request withdrawn.",
};

const DECISION_LABEL = { approved: "Approved", declined: "Declined" };
const PHASE_LABEL = { settings: "Settings", customers: "Customers", contacts: "Contacts", devices: "Devices", tickets: "Tickets", done: "Finished" };

function Hidden({ id, action }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

export default async function MigrationPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const m = await platformGet(`/v1/platform/migrations/${Number(id)}`);
  const canDecide = m.myRoles.includes("platform_admin");
  const plan = m.dryRun || {};
  const running = m.status === "running" || (m.rollback?.approvedAt && !m.rolledBackAt && m.status === "completed");
  const changes = m.targetChanges;

  return (
    <section className="admin-page">
      {running ? <AutoRefresh seconds={4} /> : null}
      <p className="desk-back"><Link href="/control/migrations">← All migrations</Link></p>
      <header className="admin-head">
        <div>
          <h1>MIG-{m.id} <span className={`usage-state${statusLevel(m.status)}`}>{MIGRATION_STATUS[m.status] || m.status}</span></h1>
          <p className="org-name">
            {MODE_LABEL[m.mode]} from <Link href={`/control/tenants/${m.source.id}`}>{m.source.name}</Link> to{" "}
            <Link href={`/control/tenants/${m.target.id}`}>{m.target.name}</Link> · requested by {m.requestedBy.name} on {formatDate(m.submittedAt, true)}
          </p>
        </div>
        {m.canEdit ? (
          <div className="admin-head-actions">
            <Link className="admin-secondary mig-link-btn" href={`/control/migrations/new?edit=${m.id}`}>Change</Link>
            <form action={migrationAction}>
              <Hidden id={m.id} action="cancel" />
              <button type="submit" className="admin-secondary">Cancel request</button>
            </form>
          </div>
        ) : null}
      </header>
      {SAVED[query?.saved] ? <p className="saved admin-note">{SAVED[query.saved]}</p> : null}
      {query?.error ? <p className="error admin-note">{String(query.error)}</p> : null}

      {canDecide ? (
        <section className="admin-card admin-wide mig-decide">
          <h2>Your approval as the second platform admin</h2>
          <p className="org-name">Check what moves below. It runs once both tenants and you have approved{m.scheduleAt ? `, at ${formatDate(m.scheduleAt, true)}` : ""}.</p>
          <div className="mig-decide-row">
            <form action={migrationAction}>
              <Hidden id={m.id} action="approve" />
              <button type="submit">Approve</button>
            </form>
            <details className="mig-decline">
              <summary className="admin-secondary">Decline…</summary>
              <form action={migrationAction}>
                <Hidden id={m.id} action="decline" />
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

      {m.status === "pending" && !canDecide ? (
        <p className="org-name admin-note">Waiting for approvals. {m.expiresAt ? `Expires ${formatDate(m.expiresAt, true)}.` : ""}</p>
      ) : null}

      {m.progress?.phase && m.status === "running" ? (
        <section className="admin-card admin-wide">
          <h2>Progress</h2>
          <p>Working on: <strong>{PHASE_LABEL[m.progress.phase] || m.progress.phase}</strong></p>
          <ul className="mig-counts">{countLines(m.progress.done).map((line) => <li key={line}>{line} done</li>)}</ul>
          <p className="org-name">This page refreshes by itself.</p>
        </section>
      ) : null}

      <div className="admin-cards">
        <section className="admin-card">
          <h2>Request</h2>
          <dl className="admin-dl">
            <dt>Mode</dt><dd>{MODE_LABEL[m.mode]}</dd>
            <dt>What</dt><dd>{scopeLine(m.scope)}</dd>
            <dt>When</dt><dd>{m.scheduleAt ? formatDate(m.scheduleAt, true) : "As soon as approved"}</dd>
            {m.expiresAt ? <><dt>Expires</dt><dd>{formatDate(m.expiresAt, true)}</dd></> : null}
            {m.startedAt ? <><dt>Started</dt><dd>{formatDate(m.startedAt, true)}</dd></> : null}
            {m.completedAt ? <><dt>Finished</dt><dd>{formatDate(m.completedAt, true)}</dd></> : null}
            {m.rollbackUntil && m.status === "completed" ? <><dt>Rollback until</dt><dd>{formatDate(m.rollbackUntil, true)}</dd></> : null}
            {m.rolledBackAt ? <><dt>Rolled back</dt><dd>{formatDate(m.rolledBackAt, true)}</dd></> : null}
          </dl>
        </section>
        <section className="admin-card">
          <h2>Approvals</h2>
          <ul className="mig-approvals">
            {m.approvals.map((item) => (
              <li key={item.role}>
                <strong>{item.label}</strong>
                {item.decision ? (
                  <span className={`usage-state${item.decision === "declined" ? " is-full" : ""}`}>{DECISION_LABEL[item.decision]}</span>
                ) : <span className="usage-state is-near">Waiting</span>}
                <small>
                  {item.by ? `${item.by} · ${formatDate(item.decidedAt, true)}` : approverHint(item.role, m)}
                  {item.reason ? ` · “${item.reason}”` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
        <section className="admin-card">
          <h2>Dry run at submission</h2>
          {countLines(plan.counts).length ? <ul className="mig-counts">{countLines(plan.counts).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="org-name">—</p>}
          {plan.conflicts?.length ? <p className="org-name">{plan.conflicts.length} record{plan.conflicts.length === 1 ? "" : "s"} already in the target: {resolutionSummary(plan.conflicts)}.</p> : null}
          {plan.blocked?.length ? <ul className="mig-errors">{plan.blocked.map((item) => <li key={item.key}>{item.label}</li>)}</ul> : null}
          {plan.users?.length ? <p className="org-name">{plan.users.length} user{plan.users.length === 1 ? "" : "s"} listed, not moved.</p> : null}
        </section>
      </div>

      {m.result ? (
        <section className="admin-card admin-wide">
          <h2>{m.status === "failed" ? "What went wrong" : "Result"}</h2>
          {m.result.error ? <p className="error">{m.result.error}</p> : null}
          {m.result.done ? <ul className="mig-counts">{countLines(m.result.done).map((line) => <li key={line}>{line}</li>)}</ul> : null}
          {m.result.warnings?.length ? <ul className="mig-errors">{m.result.warnings.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        </section>
      ) : null}

      {m.canRollback ? (
        <section className="admin-card admin-wide">
          <h2>Roll back</h2>
          <p className="org-name">
            Puts everything back the way it was before the migration. A different platform admin has to approve it.
            {m.mode === "copy" ? " Copies in the target are removed; customers the target has since used are kept." : ""}
          </p>
          {changes?.total ? (
            <>
              <p>Since the migration, {m.target.name} has added:</p>
              <ul className="mig-counts">
                {changes.comments ? <li>{changes.comments} replies or notes</li> : null}
                {changes.timeEntries ? <li>{changes.timeEntries} time entries</li> : null}
                {changes.tickets ? <li>{changes.tickets} ticket updates</li> : null}
                {changes.newTickets ? <li>{changes.newTickets} new tickets for migrated customers</li> : null}
                {changes.newContacts ? <li>{changes.newContacts} new contacts</li> : null}
              </ul>
            </>
          ) : <p>The target has not changed anything in the migrated data since.</p>}
          <form action={migrationAction} className="mig-rollback">
            <Hidden id={m.id} action="rollback" />
            {m.mode === "move" && changes?.total ? (
              <>
                <label className="admin-check"><input type="radio" name="keepChanges" value="keep" defaultChecked /> Copy those changes back to {m.source.name}</label>
                <label className="admin-check"><input type="radio" name="keepChanges" value="discard" /> Discard them</label>
              </>
            ) : null}
            <button type="submit" className="danger">Request rollback</button>
          </form>
        </section>
      ) : null}

      {m.rollback && !m.rolledBackAt ? (
        <section className="admin-card admin-wide">
          <h2>Rollback {m.rollback.approvedAt ? "approved" : "waiting for approval"}</h2>
          <p>
            Requested by {m.rollback.requestedBy.name} on {formatDate(m.rollback.requestedAt, true)}.{" "}
            {m.mode === "move" ? (m.rollback.keepChanges ? "Changes made in the target are copied back." : "Changes made in the target are discarded.") : ""}
          </p>
          {m.rollback.approvedAt ? <p className="org-name">Approved by {m.rollback.approvedBy?.name}. It runs within a minute.</p> : (
            <div className="mig-decide-row">
              {m.canApproveRollback ? (
                <form action={migrationAction}>
                  <Hidden id={m.id} action="rollback-approve" />
                  <button type="submit" className="danger">Approve rollback</button>
                </form>
              ) : <p className="org-name">A different platform admin has to approve it.</p>}
              <form action={migrationAction}>
                <Hidden id={m.id} action="rollback-cancel" />
                <button type="submit" className="admin-secondary">Withdraw</button>
              </form>
            </div>
          )}
        </section>
      ) : null}

      <section className="admin-card admin-wide">
        <h2>History</h2>
        {m.events.length === 0 ? <p className="org-name">Nothing yet.</p> : (
          <ol className="mig-events">
            {m.events.map((item) => (
              <li key={item.id}>
                <span>{formatDate(item.at, true)}</span>
                <strong>{eventLabel(item.kind)}</strong>
                <small>{[item.actor, eventDetail(item)].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function approverHint(role, m) {
  const list = role === "source_owner" ? m.approvers.source : role === "target_owner" ? m.approvers.target : null;
  if (!list) return "Any platform admin except the requester";
  if (!list.length) return "Nobody in this tenant can approve yet: it needs an owner or admin";
  return `Any of: ${list.map((item) => item.name).join(", ")}`;
}

function resolutionSummary(conflicts) {
  const tally = {};
  for (const item of conflicts) tally[item.resolution] = (tally[item.resolution] || 0) + 1;
  const words = { merge: "merged", rename: "renamed", skip: "skipped" };
  return Object.entries(tally).map(([key, n]) => `${n} ${words[key] || key}`).join(", ");
}

function eventDetail(item) {
  const d = item.detail || {};
  if (d.reason) return `“${d.reason}”`;
  if (d.error) return d.error;
  if (d.role) return { source_owner: "for the source tenant", target_owner: "for the target tenant", platform_admin: "as platform admin" }[d.role];
  if (d.approvalsCleared) return `${d.approvalsCleared} approval${d.approvalsCleared === 1 ? "" : "s"} cleared`;
  if (typeof d.keepChanges === "boolean") return d.keepChanges ? "keep target changes" : "discard target changes";
  return "";
}
