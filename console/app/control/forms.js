"use client";

import { useState } from "react";
import { createTenant, publishRibbon, removeRibbon, resetTenantPassword } from "../actions";

const MODULES = [
  ["core", "Device enrollment"],
  ["remote_desktop", "Remote sessions"],
  ["ticketing", "Ticketing"],
  ["monitoring", "Monitoring"],
  ["patch", "Patching"],
  ["reporting", "Reporting"],
];

export function PasswordReset({ userId }) {
  return (
    <details className="reset-password">
      <summary>Set password</summary>
      <form action={resetTenantPassword} className="password-form">
        <input type="hidden" name="userId" value={userId} />
        <PasswordField label="New password" name="password" />
        <PasswordField label="Confirm password" name="confirmPassword" />
        <button type="submit">Save password</button>
      </form>
    </details>
  );
}

export function RibbonForm({ tenants, ribbons }) {
  return (
    <>
      <form action={publishRibbon} className="license-grid">
        <label>
          Message
          <input name="body" required maxLength={180} placeholder="Introducing the all new Quick Support App" />
        </label>
        <label>
          Link label
          <input name="linkLabel" maxLength={40} placeholder="Know more" />
        </label>
        <label>
          Link
          <input name="linkUrl" type="url" maxLength={300} placeholder="https://" />
        </label>
        <label>
          Who sees it
          <select name="orgId" defaultValue="all">
            <option value="all">All tenants</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </label>
        <div className="form-actions">
          <button type="submit">Publish notice</button>
        </div>
      </form>
      {(ribbons || []).length === 0 ? <p className="org-name">No ribbon is showing.</p> : (ribbons || []).map((ribbon) => (
        <div className="ribbon-live" key={ribbon.id}>
          <p><strong>{ribbon.orgName}.</strong> {ribbon.body}{ribbon.linkUrl ? ` ${ribbon.linkLabel}` : ""}</p>
          <form action={removeRibbon}>
            <input type="hidden" name="noticeId" value={ribbon.id} />
            <button type="submit">Remove</button>
          </form>
        </div>
      ))}
    </>
  );
}

export function TenantForm() {
  return (
    <form action={createTenant} className="license-grid">
      <label>
        Company
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Company code
        <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" title="Lowercase letters, numbers, and hyphens" />
      </label>
      <label>
        License type
        <input name="plan" defaultValue="Standard" required maxLength={40} />
      </label>
      <label>
        Seats
        <input name="seats" type="number" min="1" step="1" defaultValue="5" required />
      </label>
      <label>
        Systems that can be monitored
        <input name="deviceCap" type="number" min="0" step="1" defaultValue="25" required />
      </label>
      <label>
        Expires
        <input name="expiresAt" type="date" />
      </label>
      <div className="checks">
        {MODULES.map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" name={`module.${key}`} defaultChecked={key === "core" || key === "remote_desktop"} />
            {label}
          </label>
        ))}
      </div>
      <label>
        Admin name
        <input name="adminName" required maxLength={120} />
      </label>
      <label>
        Admin email
        <input name="adminEmail" type="email" autoComplete="off" required />
      </label>
      <PasswordField label="Admin password" name="adminPassword" />
      <PasswordField label="Confirm password" name="adminConfirm" />
      <div className="form-actions">
        <button type="submit">Create tenant</button>
      </div>
    </form>
  );
}

function PasswordField({ label, name }) {
  const [shown, setShown] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input name={name} type={shown ? "text" : "password"} autoComplete="new-password" minLength={8} required />
        <button
          type="button"
          className="password-eye"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </span>
    </label>
  );
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-4.1 4.9M6.1 6.1C3.6 7.9 2 12 2 12a18.8 18.8 0 0 0 6.2 5.8" />
    </svg>
  );
}
