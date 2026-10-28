"use client";

import { useActionState } from "react";
import { publishNotice } from "../actions";

export function NoticeForm({ tenants }) {
  const [state, action, pending] = useActionState(publishNotice, null);
  return (
    <form action={action} className="license-grid">
      <label className="admin-span">
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
        Audience
        <select name="orgId" defaultValue="all">
          <option value="all">All tenants</option>
          {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
      </label>
      <label>
        Starts
        <input name="startsAt" type="datetime-local" />
      </label>
      <label>
        Ends
        <input name="endsAt" type="datetime-local" />
      </label>
      <p className="org-name admin-span">Times are South African time. Leave Starts empty to show it now, and Ends empty to show it until you unpublish it.</p>
      {state?.error ? <p className="error admin-span">{state.error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>{pending ? "Publishing…" : "Publish"}</button>
      </div>
    </form>
  );
}
