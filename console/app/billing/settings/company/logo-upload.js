"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_BYTES = 512 * 1024;

export function LogoUpload({ logo, canManage }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(method, body) {
    setBusy(true);
    setError("");
    const response = await fetch("/billing/api/settings/logo", { method, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) return setError(data.error || "The logo was not saved.");
    router.refresh();
  }

  function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError("Use a PNG, JPG, SVG or WebP image.");
    if (file.size > MAX_BYTES) return setError("The logo must be 512 KB or smaller.");
    const reader = new FileReader();
    reader.onload = () => send("PUT", { dataUrl: reader.result });
    reader.readAsDataURL(file);
  }

  return (
    <div className="bx-logo">
      <div className="bx-logo-box">{logo ? <img src={logo} alt="Your logo" /> : <span className="field-hint">No logo. Your trading name prints instead.</span>}</div>
      {canManage ? (
        <div className="bx-actions-row">
          <label className="rx-button bx-file">
            {busy ? "Saving…" : logo ? "Replace logo" : "Upload logo"}
            <input type="file" accept={TYPES.join(",")} onChange={pick} disabled={busy} />
          </label>
          {logo ? <button type="button" className="rx-button is-danger" disabled={busy} onClick={() => send("DELETE")}>Remove</button> : null}
        </div>
      ) : null}
      <p className="field-hint">PNG, JPG, SVG or WebP, up to 512 KB. A wide logo on a transparent background works best.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
