"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveTenantLicense } from "../../actions";
import { FEATURE_LABEL, LICENSE_TYPES, STATUS_LABEL, dateInput, formatDate, packageLabel } from "../../catalog";
import { LicenseFields, effectiveOf, licenseValue } from "../../license-fields";

const TYPE_LABEL = Object.fromEntries(LICENSE_TYPES);
const features = (list) => list.map((key) => FEATURE_LABEL[key]).join(", ") || "none";
const limit = (override, fallback) => (override === "" || override == null ? `package default (${fallback ?? "—"})` : String(override));

function changesBetween(before, after, packages) {
  const pkgOf = (value) => packages.find((item) => String(item.id) === value.packageId);
  const oldPkg = pkgOf(before);
  const newPkg = pkgOf(after);
  const oldEff = effectiveOf(oldPkg, before);
  const newEff = effectiveOf(newPkg, after);
  const rows = [];
  const add = (label, from, to) => {
    if (String(from) !== String(to)) rows.push([label, from, to]);
  };
  add("Package", oldPkg?.name || "—", newPkg?.name || "—");
  add("License type", TYPE_LABEL[before.licenseType] || before.licenseType, TYPE_LABEL[after.licenseType] || after.licenseType);
  add("Seats", limit(before.seatsOverride, oldPkg?.defaultSeats), limit(after.seatsOverride, newPkg?.defaultSeats));
  add("Devices", limit(before.devicesOverride, oldPkg?.defaultDevices), limit(after.devicesOverride, newPkg?.defaultDevices));
  add("Support sessions", limit(before.sessionsOverride, oldPkg?.defaultSessions), limit(after.sessionsOverride, newPkg?.defaultSessions));
  add("Features", features(oldEff.features), features(newEff.features));
  add("Expiry", before.noExpiry ? "No expiry" : before.expiresAt, after.noExpiry ? "No expiry" : after.expiresAt || "—");
  add("Status", STATUS_LABEL[before.status], STATUS_LABEL[after.status]);
  return { rows, oldEff, newEff };
}

function warningsFor({ oldEff, newEff }, after, usage) {
  const list = [];
  if (newEff.devices < usage.deviceCount) {
    list.push(`Devices limit ${oldEff.devices} → ${newEff.devices}, tenant currently has ${usage.deviceCount} devices: new enrollments will be blocked.`);
  }
  if (newEff.seats < usage.seatsUsed) {
    list.push(`Seats ${oldEff.seats} → ${newEff.seats}, tenant has ${usage.seatsUsed} active users: new users will be blocked.`);
  }
  if (newEff.sessions < usage.sessionsRunning) {
    list.push(`Support sessions ${oldEff.sessions} → ${newEff.sessions}, ${usage.sessionsRunning} running now: new sessions will be blocked.`);
  }
  const lost = oldEff.features.filter((key) => !newEff.features.includes(key));
  if (lost.length) list.push(`Turning off ${features(lost)} removes that access for the tenant straight away.`);
  if (after.status === "suspended") list.push("Suspending turns off every app feature for this tenant until it is reactivated.");
  if (!after.noExpiry && after.expiresAt && new Date(`${after.expiresAt}T23:59:59+02:00`).getTime() < Date.now()) {
    list.push("The expiry date has passed, so the license will be expired as soon as it is saved.");
  }
  return list;
}

export function LicenseEditor({ tenant, license, usage, packages }) {
  const original = licenseValue({ ...license, expiresAtInput: dateInput(license.expiresAt) });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(original);
  const [review, setReview] = useState(null);
  const [state, action, pending] = useActionState(saveTenantLicense, null);
  const dialog = useRef(null);
  const form = useRef(null);

  useEffect(() => {
    if (review) dialog.current?.showModal();
    else dialog.current?.close();
  }, [review]);

  useEffect(() => {
    if (state?.error) setReview(null);
  }, [state]);

  const pkg = packages.find((item) => String(item.id) === original.packageId);
  const effective = license.effective;

  if (!editing) {
    return (
      <section className="admin-card admin-wide">
        <div className="admin-card-head">
          <h2>License &amp; package</h2>
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <dl className="admin-dl">
          <dt>Package</dt><dd>{packageLabel(pkg)}</dd>
          <dt>License type</dt><dd>{TYPE_LABEL[license.licenseType] || license.licenseType}</dd>
          <dt>Seats</dt><dd>{effective.seats} {license.seatsOverride == null ? "(package default)" : "(override)"}</dd>
          <dt>Devices</dt><dd>{effective.devices} {license.devicesOverride == null ? "(package default)" : "(override)"}</dd>
          <dt>Support sessions</dt><dd>{effective.sessions} {license.sessionsOverride == null ? "(package default)" : "(override)"}</dd>
          <dt>Features</dt>
          <dd>
            {features(effective.features)}
            {license.featuresAdded.length ? <span className="org-name"> · added: {features(license.featuresAdded)}</span> : null}
            {license.featuresRemoved.length ? <span className="org-name"> · removed: {features(license.featuresRemoved)}</span> : null}
          </dd>
          <dt>Expires</dt><dd>{license.noExpiry || !license.expiresAt ? "No expiry" : formatDate(license.expiresAt)}</dd>
          <dt>Status</dt><dd>{STATUS_LABEL[effective.status] || effective.status}</dd>
          <dt>Last changed</dt><dd>{formatDate(license.updatedAt, true)}</dd>
        </dl>
      </section>
    );
  }

  const diff = changesBetween(original, value, packages);
  const warnings = warningsFor(diff, value, usage);

  function openReview(event) {
    event.preventDefault();
    if (!form.current.reportValidity()) return;
    setReview(diff.rows.length ? { rows: diff.rows, warnings } : { rows: [], warnings: [] });
  }

  return (
    <form ref={form} action={action} className="admin-card admin-wide" onSubmit={(event) => { if (!review) openReview(event); }}>
      <input type="hidden" name="tenantId" value={tenant.id} />
      <div className="admin-card-head">
        <h2>Edit license &amp; package</h2>
      </div>
      <LicenseFields value={value} onChange={setValue} packages={packages} />
      {state?.error ? <p className="error">{state.error}</p> : null}
      <div className="form-actions admin-actions">
        <button type="button" className="admin-secondary" onClick={() => { setValue(original); setEditing(false); }}>Cancel</button>
        <button type="button" onClick={openReview}>Save</button>
      </div>
      <dialog ref={dialog} className="admin-dialog" onClose={() => setReview(null)}>
        <h2>Save these changes?</h2>
        {review?.rows.length ? (
          <table>
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {review.rows.map(([label, from, to]) => <tr key={label}><td>{label}</td><td>{from}</td><td>{to}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="org-name">Nothing has changed.</p>}
        {review?.warnings.length ? (
          <ul className="admin-warnings">{review.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : null}
        <div className="form-actions admin-actions">
          <button type="button" className="admin-secondary" onClick={() => setReview(null)}>Back</button>
          {review?.rows.length ? <button type="submit" disabled={pending}>{pending ? "Saving…" : "Confirm and save"}</button> : null}
        </div>
      </dialog>
    </form>
  );
}
