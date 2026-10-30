"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { checkSlug, createTenant } from "../../actions";
import { FEATURE_LABEL, LICENSE_TYPES } from "../../catalog";
import { LicenseFields, effectiveOf, licenseValue } from "../../license-fields";
import { PasswordField } from "../[id]/user-forms";

const STEPS = ["Company", "Package", "First admin", "Review"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugFrom(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function TenantWizard({ packages }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState(null);
  const [license, setLicense] = useState(() => ({ ...licenseValue(null), packageId: packages[0] ? String(packages[0].id) : "" }));
  const [admin, setAdmin] = useState({ name: "", email: "" });
  const [access, setAccess] = useState("invite");
  const [state, action, pending] = useActionState(createTenant, null);
  const sections = useRef([]);

  useEffect(() => {
    if (!slug) return setSlugState(null);
    if (!SLUG.test(slug)) return setSlugState({ valid: false, available: false });
    let live = true;
    const timer = setTimeout(async () => {
      const result = await checkSlug(slug);
      if (live) setSlugState(result);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug]);

  function next() {
    const fields = sections.current[step]?.querySelectorAll("input, select") || [];
    for (const field of fields) {
      if (!field.reportValidity()) return;
    }
    if (step === 0 && !(slugState?.valid && slugState?.available)) return;
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  }

  const pkg = packages.find((item) => String(item.id) === license.packageId);
  const effective = effectiveOf(pkg, license);
  const slugNote = !slug ? null : !slugState ? "Checking…" : !slugState.valid ? "Use lowercase letters, numbers, and hyphens." : slugState.available ? "Available." : "Already in use.";

  return (
    <form action={action} className="admin-card admin-wide admin-wizard">
      <ol className="admin-steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "is-current" : index < step ? "is-done" : undefined} aria-current={index === step ? "step" : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>

      <fieldset ref={(node) => { sections.current[0] = node; }} hidden={step !== 0}>
        <legend>Company</legend>
        <div className="license-grid">
          <label>
            Company name
            <input name="name" value={name} required maxLength={120} onChange={(event) => {
              setName(event.target.value);
              if (!slugTouched) setSlug(slugFrom(event.target.value));
            }} />
          </label>
          <label>
            Company code
            <input name="slug" value={slug} required maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value.trim());
            }} />
            {slugNote ? <span className={slugState?.valid && slugState?.available ? "admin-hint is-ok" : "admin-hint"} role="status">{slugNote}</span> : null}
          </label>
        </div>
      </fieldset>

      <fieldset ref={(node) => { sections.current[1] = node; }} hidden={step !== 1}>
        <legend>Package</legend>
        <LicenseFields value={license} onChange={setLicense} packages={packages} showStatus={false} />
      </fieldset>

      <fieldset ref={(node) => { sections.current[2] = node; }} hidden={step !== 2}>
        <legend>First admin</legend>
        <div className="license-grid">
          <label>
            Full name
            <input name="adminName" value={admin.name} required maxLength={120} onChange={(event) => setAdmin({ ...admin, name: event.target.value })} />
          </label>
          <label>
            Email
            <input name="adminEmail" type="email" value={admin.email} autoComplete="off" required onChange={(event) => setAdmin({ ...admin, email: event.target.value })} />
          </label>
          <label>
            Access
            <select name="adminAccess" value={access} onChange={(event) => setAccess(event.target.value)}>
              <option value="invite">Email an invite link</option>
              <option value="password">Set a password now</option>
            </select>
          </label>
          {access === "password" ? (
            <>
              <PasswordField label="Password" name="adminPassword" />
              <PasswordField label="Confirm password" name="adminConfirm" />
            </>
          ) : null}
        </div>
        <p className="org-name">
          {access === "invite"
            ? "The admin gets an email with a link to set their own password. The link works for 7 days."
            : "Share the password with the admin yourself."}
        </p>
      </fieldset>

      <fieldset hidden={step !== 3}>
        <legend>Review</legend>
        <dl className="admin-dl">
          <dt>Company</dt><dd>{name || "—"} ({slug || "—"})</dd>
          <dt>Package</dt><dd>{pkg?.name || "—"}</dd>
          <dt>License type</dt><dd>{Object.fromEntries(LICENSE_TYPES)[license.licenseType]}</dd>
          <dt>Limits</dt><dd>{effective.seats} seats · {effective.devices} devices · {effective.sessions} support sessions</dd>
          <dt>Features</dt><dd>{effective.features.map((key) => FEATURE_LABEL[key]).join(", ") || "None"}</dd>
          <dt>Expires</dt><dd>{license.noExpiry ? "No expiry" : license.expiresAt || "—"}</dd>
          <dt>First admin</dt><dd>{admin.name || "—"} · {admin.email || "—"} · {access === "invite" ? "Invite by email" : "Password set now"}</dd>
        </dl>
      </fieldset>

      {state?.error ? <p className="error">{state.error}</p> : null}
      <div className="form-actions admin-actions">
        {step > 0 ? <button type="button" className="admin-secondary" onClick={() => setStep(step - 1)}>Back</button> : null}
        {step < STEPS.length - 1 ? <button type="button" onClick={next}>Next</button> : <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create tenant"}</button>}
      </div>
    </form>
  );
}
