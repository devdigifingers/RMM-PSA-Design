"use client";

import { useMemo, useState, useTransition } from "react";
import { migrationDryRun, migrationOptions, saveMigration } from "../../actions";
import { SCOPE_LABEL, countLines, fromSastInput, nextAfterHours, sastInput } from "../../../migration-labels";

const RESOLUTION_LABEL = { merge: "Merge into the existing one", rename: "Bring it in renamed", skip: "Skip it" };
const SCOPE_HINT = {
  customers: "Customer records, their sites and contacts.",
  tickets: "Every ticket of the chosen customers, with replies, notes, attachments and time.",
  devices: "Agents start reporting to the target. Move only.",
  settings: "SLA plans, categories, tags, canned replies and holidays the target does not have yet.",
  users: "Shown for reference. Users are never moved: one email belongs to one tenant.",
};

export function MigrationWizard({ tenants, initialCustomers, initial }) {
  const editing = Boolean(initial.id);
  const [sourceId, setSourceId] = useState(initial.sourceId ? String(initial.sourceId) : "");
  const [targetId, setTargetId] = useState(initial.targetId ? String(initial.targetId) : "");
  const [customers, setCustomers] = useState(initialCustomers || []);
  const [scope, setScope] = useState(() => ({
    customers: initial.scope?.customers ?? true,
    tickets: initial.scope?.tickets ?? true,
    devices: initial.scope?.devices ?? false,
    settings: initial.scope?.settings ?? false,
    users: initial.scope?.users ?? false,
  }));
  const [pickCustomers, setPickCustomers] = useState(Boolean(initial.scope?.customerIds?.length));
  const [chosen, setChosen] = useState(() => new Set((initial.scope?.customerIds || []).map(Number)));
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState(initial.mode || "move");
  const [resolutions, setResolutions] = useState(initial.resolutions || {});
  const [acknowledged, setAcknowledged] = useState(() => new Set(initial.acknowledged || []));
  const [when, setWhen] = useState(initial.id && !initial.scheduleAt ? "now" : "later");
  const [scheduleInput, setScheduleInput] = useState(sastInput(initial.scheduleAt || nextAfterHours()));
  const [plan, setPlan] = useState(null);
  const [planFor, setPlanFor] = useState("");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const [saving, setSaving] = useState(false);

  const input = useMemo(() => ({
    sourceId: Number(sourceId) || null,
    targetId: Number(targetId) || null,
    mode,
    scope: { ...scope, devices: mode === "move" && scope.devices, customerIds: scope.customers && pickCustomers ? [...chosen] : null },
    resolutions,
    acknowledged: [...acknowledged],
    scheduleAt: when === "later" ? fromSastInput(scheduleInput) : null,
  }), [sourceId, targetId, mode, scope, pickCustomers, chosen, resolutions, acknowledged, when, scheduleInput]);
  const key = JSON.stringify({ ...input, scheduleAt: null });
  const fresh = plan && planFor === key;

  function changeSource(value) {
    setSourceId(value);
    setChosen(new Set());
    setResolutions({});
    setPlan(null);
    if (value === targetId) setTargetId("");
    startBusy(async () => setCustomers((await migrationOptions(value)).customers || []));
  }

  function toggleScope(name, on) {
    setScope((current) => {
      const next = { ...current, [name]: on };
      if ((name === "tickets" || name === "devices") && on) next.customers = true;
      if (name === "customers" && !on) {
        next.tickets = false;
        next.devices = false;
      }
      return next;
    });
  }

  function check(next = input) {
    setError("");
    startBusy(async () => {
      const result = await migrationDryRun(next);
      if (result.error) {
        setError(result.error);
        setPlan(null);
        return;
      }
      setPlan(result.plan);
      setPlanFor(JSON.stringify({ ...next, scheduleAt: null }));
    });
  }

  function resolve(conflictKey, value) {
    const next = { ...resolutions, [conflictKey]: value };
    setResolutions(next);
    check({ ...input, resolutions: next });
  }

  function acknowledge(blockKey, on) {
    const next = new Set(acknowledged);
    if (on) next.add(blockKey);
    else next.delete(blockKey);
    setAcknowledged(next);
    check({ ...input, acknowledged: [...next] });
  }

  function submit() {
    if (when === "later" && !input.scheduleAt) {
      setError("Choose a date and time, or run it as soon as it is approved.");
      return;
    }
    setError("");
    setSaving(true);
    startBusy(async () => {
      const result = await saveMigration(input, initial.id || null);
      setSaving(false);
      if (result?.error) {
        setError(result.error);
        if (result.plan) setPlan(result.plan);
      }
    });
  }

  const shownCustomers = customers.filter((row) => !filter || row.name.toLowerCase().includes(filter.toLowerCase()));
  const source = tenants.find((row) => String(row.id) === sourceId);
  const target = tenants.find((row) => String(row.id) === targetId);
  const lines = plan ? countLines(plan.counts) : [];

  return (
    <div className="mig-wizard">
      <section className="admin-card admin-wide">
        <h2>1. Tenants</h2>
        <div className="license-grid">
          <label>
            Move data from
            <select value={sourceId} onChange={(event) => changeSource(event.target.value)} disabled={editing} required>
              <option value="">Choose the source tenant</option>
              {tenants.map((row) => <option key={row.id} value={row.id}>{row.name}{row.active ? "" : " (not active)"}</option>)}
            </select>
          </label>
          <label>
            Into
            <select value={targetId} onChange={(event) => { setTargetId(event.target.value); setResolutions({}); setPlan(null); }} disabled={editing} required>
              <option value="">Choose the target tenant</option>
              {tenants.filter((row) => String(row.id) !== sourceId).map((row) => (
                <option key={row.id} value={row.id}>{row.name}{row.active ? "" : " (not active)"}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="admin-card admin-wide">
        <h2>2. What moves</h2>
        <div className="mig-scope">
          {Object.entries(SCOPE_LABEL).map(([name, label]) => {
            const disabled = name === "devices" && mode === "copy";
            return (
              <label key={name} className={`admin-check mig-scope-item${disabled ? " is-disabled" : ""}`}>
                <input type="checkbox" checked={scope[name] && !disabled} disabled={disabled} onChange={(event) => toggleScope(name, event.target.checked)} />
                <span>
                  <strong>{label}</strong>
                  <small>{disabled ? "Devices can only be moved, not copied." : SCOPE_HINT[name]}</small>
                </span>
              </label>
            );
          })}
        </div>
        {scope.customers ? (
          <fieldset className="mig-customers">
            <legend>Which customers</legend>
            <label className="admin-check">
              <input type="radio" name="pick" checked={!pickCustomers} onChange={() => setPickCustomers(false)} />
              All {customers.length} customers{source ? ` of ${source.name}` : ""}
            </label>
            <label className="admin-check">
              <input type="radio" name="pick" checked={pickCustomers} onChange={() => setPickCustomers(true)} />
              Only the ones I choose{pickCustomers ? ` (${chosen.size} chosen)` : ""}
            </label>
            {pickCustomers ? (
              <div className="mig-pick">
                <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a customer" aria-label="Find a customer" />
                <div className="mig-pick-list">
                  {shownCustomers.length === 0 ? <p className="org-name">{customers.length ? "No customer matches." : "Choose the source tenant first."}</p> : shownCustomers.map((row) => (
                    <label key={row.id} className="admin-check">
                      <input
                        type="checkbox"
                        checked={chosen.has(row.id)}
                        onChange={(event) => {
                          const next = new Set(chosen);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          setChosen(next);
                        }}
                      />
                      {row.name}
                    </label>
                  ))}
                </div>
                <p className="org-name">Unassigned devices only move when all customers are chosen.</p>
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </section>

      <section className="admin-card admin-wide">
        <h2>3. Copy or move</h2>
        <div className="mig-mode">
          <label className={`mig-mode-option${mode === "move" ? " is-on" : ""}`}>
            <input type="radio" name="mode" checked={mode === "move"} onChange={() => setMode("move")} />
            <strong>Move</strong>
            <small>The data goes to the target. The source keeps a read-only copy for 30 days so it can be rolled back, then it is removed.</small>
          </label>
          <label className={`mig-mode-option${mode === "copy" ? " is-on" : ""}`}>
            <input type="radio" name="mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
            <strong>Copy</strong>
            <small>The target gets its own copy and the source carries on as before. Devices cannot be copied.</small>
          </label>
        </div>
      </section>

      <section className="admin-card admin-wide">
        <h2>4. Dry run</h2>
        <p className="org-name">Checks what would happen without changing anything. Run it again after you change a choice above.</p>
        <div className="form-actions admin-actions mig-left">
          <button type="button" onClick={() => check()} disabled={busy || !input.sourceId || !input.targetId}>
            {busy && !saving ? "Checking…" : plan ? "Run the dry run again" : "Run the dry run"}
          </button>
          {plan && !fresh ? <span className="mig-stale">Your choices changed since this dry run.</span> : null}
        </div>
        {plan ? (
          <div className="mig-plan">
            {plan.errors.length ? (
              <ul className="mig-errors">{plan.errors.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : null}
            <h3>What {mode === "move" ? "moves" : "is copied"} into {target?.name || "the target"}</h3>
            {lines.length ? <ul className="mig-counts">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="org-name">Nothing to migrate with these choices.</p>}
            {plan.ticketNumbers?.count ? <p className="org-name">{plan.ticketNumbers.note}</p> : null}
            {plan.conflicts.length ? (
              <>
                <h3>Already in {target?.name || "the target"} ({plan.conflicts.length})</h3>
                <div className="usage-table admin-table">
                  <table>
                    <thead><tr><th>Record</th><th>What to do</th></tr></thead>
                    <tbody>
                      {plan.conflicts.map((item) => (
                        <tr key={item.key}>
                          <td>{item.label}</td>
                          <td>
                            <select value={item.resolution} onChange={(event) => resolve(item.key, event.target.value)} aria-label={`What to do with ${item.label}`} disabled={busy}>
                              {item.options.map((option) => <option key={option} value={option}>{RESOLUTION_LABEL[option]}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="org-name">Skipping a customer also leaves its contacts, tickets and devices behind.</p>
              </>
            ) : null}
            {plan.blocked.length ? (
              <>
                <h3>Needs your OK</h3>
                {plan.blocked.map((item) => (
                  <label key={item.key} className="admin-check mig-blocked">
                    <input type="checkbox" checked={item.acknowledged} onChange={(event) => acknowledge(item.key, event.target.checked)} disabled={busy} />
                    {item.label}
                  </label>
                ))}
              </>
            ) : null}
            {plan.users.length ? (
              <>
                <h3>Users ({plan.users.length})</h3>
                <p className="org-name">{plan.users[0].reason}</p>
                <ul className="mig-users">{plan.users.map((item) => <li key={item.email}>{item.name} · {item.email}</li>)}</ul>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="admin-card admin-wide">
        <h2>5. When</h2>
        <label className="admin-check">
          <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} />
          As soon as everyone approves
        </label>
        <label className="admin-check">
          <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} />
          At a set time (South Africa time)
        </label>
        {when === "later" ? (
          <input className="mig-when" type="datetime-local" value={scheduleInput} onChange={(event) => setScheduleInput(event.target.value)} aria-label="Run at" />
        ) : null}
        <p className="org-name">After hours is best: tickets and devices in scope are read-only while it runs, and it waits for live remote sessions to end.</p>
      </section>

      {error ? <p className="error admin-note">{error}</p> : null}
      <div className="form-actions admin-actions">
        <button type="button" onClick={submit} disabled={busy || !fresh || !plan?.ready}>
          {saving ? "Saving…" : editing ? "Save changes" : "Send for approval"}
        </button>
      </div>
      {!editing ? (
        <p className="org-name mig-right">Sending emails the owners of both tenants and the other platform admins. The request expires after 7 days without all approvals.</p>
      ) : null}
    </div>
  );
}
