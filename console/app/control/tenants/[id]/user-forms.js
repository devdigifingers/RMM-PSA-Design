"use client";

import { useActionState, useState } from "react";
import { addTenantUser, inviteTenantUser, setTenantPassword } from "../../actions";

export function PasswordForm({ tenantId, userId }) {
  const [state, action, pending] = useActionState(setTenantPassword, null);
  return (
    <details className="reset-password">
      <summary>Set password</summary>
      <form action={action} className="password-form">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="userId" value={userId} />
        <PasswordField label="New password" name="password" />
        <PasswordField label="Confirm password" name="confirmPassword" />
        {state?.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" disabled={pending}>Save password</button>
      </form>
    </details>
  );
}

export function AddUserForm({ tenantId }) {
  const [state, action, pending] = useActionState(addTenantUser, null);
  return (
    <form action={action} className="license-grid">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label>
        Full name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <label>
        Role
        <select name="role" defaultValue="tech">
          <option value="admin">Admin</option>
          <option value="tech">Tech</option>
        </select>
      </label>
      <PasswordField label="Temporary password" name="password" />
      {state?.error ? <p className="error admin-span">{state.error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>Add user</button>
      </div>
    </form>
  );
}

export function InviteUserForm({ tenantId }) {
  const [state, action, pending] = useActionState(inviteTenantUser, null);
  return (
    <form action={action} className="license-grid">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label>
        Full name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <label>
        Role
        <select name="role" defaultValue="admin">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="tech">Tech</option>
        </select>
      </label>
      {state?.error ? <p className="error admin-span">{state.error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</button>
      </div>
    </form>
  );
}

export function PasswordField({ label, name }) {
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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            {shown ? <path d="M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : null}
          </svg>
        </button>
      </span>
    </label>
  );
}
