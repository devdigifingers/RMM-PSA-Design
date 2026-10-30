"use client";

import { useActionState } from "react";
import { acceptInvite } from "../actions";

export function InviteForm({ token, name }) {
  const [state, action, pending] = useActionState(acceptInvite, null);
  return (
    <form action={action} className="invite-form">
      <input type="hidden" name="token" value={token} />
      <label>
        Full name
        <input name="name" defaultValue={name} required maxLength={120} autoComplete="name" />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
      </label>
      {state?.error ? <p className="join-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Set password"}</button>
    </form>
  );
}
