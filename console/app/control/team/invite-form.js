"use client";

import { useActionState } from "react";
import { invitePlatformMember } from "../actions";

export function PlatformInviteForm() {
  const [state, action, pending] = useActionState(invitePlatformMember, null);
  return (
    <form action={action} className="license-grid">
      <label>
        Full name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <label>
        Level
        <select name="role" defaultValue="admin">
          <option value="super">Super admin</option>
          <option value="admin">Platform admin</option>
          <option value="support">Support (read-only)</option>
        </select>
      </label>
      {state?.error ? <p className="error admin-span">{state.error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</button>
      </div>
    </form>
  );
}
