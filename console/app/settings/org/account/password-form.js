"use client";

import { useState } from "react";
import { changePassword } from "../../../actions";

export function ChangePassword({ notice }) {
  return (
    <form action={changePassword} className="password-form">
      <h2>Password</h2>
      <p className="org-name">Change the password for this login.</p>
      <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" />
      <PasswordField label="New password" name="password" autoComplete="new-password" minLength={8} />
      <PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" minLength={8} />
      {notice ? <p className={notice.kind}>{notice.text}</p> : null}
      <button type="submit">Change password</button>
    </form>
  );
}

function PasswordField({ label, name, autoComplete, minLength }) {
  const [shown, setShown] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
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
