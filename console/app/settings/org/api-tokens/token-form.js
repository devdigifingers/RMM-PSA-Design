"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createApiToken } from "../../../actions";

export function TokenForm({ devices, yourAddress }) {
  const [state, action, pending] = useActionState(createApiToken, null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  if (state?.token) {
    return (
      <div className="token-new" role="status">
        <p><strong>{state.name}</strong> was created. Copy the token now: it is shown only once and cannot be recovered.</p>
        <div className="token-copy">
          <code>{state.token}</code>
          <button
            type="button"
            className="secondary"
            onClick={() => navigator.clipboard.writeText(state.token).then(() => setCopied(true), () => setCopied(false))}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button type="button" onClick={() => router.refresh()}>I have saved it</button>
      </div>
    );
  }

  return (
    <form action={action} className="token-form">
      <label>
        Name
        <input name="name" required maxLength={80} placeholder="Nightly backup check" />
      </label>
      <fieldset className="token-devices">
        <legend>Devices it may run commands on</legend>
        {devices.length === 0 ? <p className="org-name">This organisation has no devices yet.</p> : null}
        {devices.map((device) => (
          <label key={device.id} className="token-device">
            <input type="checkbox" name="deviceId" value={device.id} />
            <span>{device.name}</span>
            {device.osName ? <small>{device.osName}</small> : null}
          </label>
        ))}
      </fieldset>
      <label>
        Expires after
        <select name="expiresInDays" defaultValue="90">
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </select>
      </label>
      <label>
        Only allow these IP addresses (optional, one per line)
        <textarea name="allowedIps" rows={3} placeholder={yourAddress && yourAddress !== "unknown" ? yourAddress : "41.13.8.20"} spellCheck={false} />
      </label>
      <p className="org-name">Recommended: the address of the server that will use the token. Leave empty to allow any address.</p>
      {state?.error ? <p className="error">{state.error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create token"}</button>
      </div>
    </form>
  );
}
