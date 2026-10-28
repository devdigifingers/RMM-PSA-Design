"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AppIcon } from "../../mark";
import { savePackage } from "../actions";
import { FEATURE_GROUPS } from "../catalog";

export function PackageForm({ pkg }) {
  const [state, action, pending] = useActionState(savePackage, null);
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef(null);
  const form = useRef(null);
  const confirm = useRef(null);
  const affected = pkg?.tenantCount || 0;

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  useEffect(() => {
    if (state?.error) setConfirming(false);
  }, [state]);

  function save(event) {
    event.preventDefault();
    if (!form.current.reportValidity()) return;
    if (!form.current.querySelector('input[name="features"]:checked')) {
      form.current.querySelector('input[name="features"]').setCustomValidity("Choose at least one feature.");
      form.current.reportValidity();
      return;
    }
    if (affected > 0) {
      setConfirming(true);
      return;
    }
    form.current.requestSubmit();
  }

  return (
    <form ref={form} action={action} className="admin-card admin-wide" onSubmit={(event) => { if (affected > 0 && confirm.current?.value !== "1") save(event); }}>
      {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}
      <input ref={confirm} type="hidden" name="confirm" value={confirming ? "1" : "0"} />
      {affected > 0 ? <p className="admin-affects">Affects {affected} tenant{affected === 1 ? "" : "s"}. Changes apply to them as soon as you save.</p> : null}
      <div className="license-grid">
        <label>
          Name
          <input name="name" defaultValue={pkg?.name || ""} required maxLength={80} />
        </label>
        <label>
          Code
          <input name="code" defaultValue={pkg?.code || ""} required maxLength={40} pattern="[A-Z0-9]+(?:-[A-Z0-9]+)*" title="Capital letters, numbers, and hyphens" readOnly={Boolean(pkg)} />
        </label>
        <label className="admin-span">
          Description
          <input name="description" defaultValue={pkg?.description || ""} maxLength={300} />
        </label>
      </div>
      <div className="admin-features">
        {FEATURE_GROUPS.map((group) => (
          <fieldset key={group.app} className="feature-group">
            <legend><AppIcon app={group.appId} size={20} /> {group.title}</legend>
            {group.features.map(([key, label]) => (
              <label key={key} className="admin-check">
                <input
                  type="checkbox"
                  name="features"
                  value={key}
                  defaultChecked={pkg?.features.includes(key)}
                  onChange={(event) => {
                    for (const box of event.currentTarget.form.querySelectorAll('input[name="features"]')) box.setCustomValidity("");
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="license-grid">
        <label>
          Default seats
          <input name="defaultSeats" type="number" min="1" step="1" defaultValue={pkg?.defaultSeats ?? 5} required />
        </label>
        <label>
          Default devices
          <input name="defaultDevices" type="number" min="0" step="1" defaultValue={pkg?.defaultDevices ?? 50} required />
        </label>
        <label>
          Default support sessions
          <input name="defaultSessions" type="number" min="0" max="100" step="1" defaultValue={pkg?.defaultSessions ?? 1} required />
        </label>
        <label>
          Price per month (ZAR)
          <input name="priceMonthly" type="number" min="0" step="0.01" defaultValue={pkg?.priceMonthly ?? ""} placeholder="Not set" />
        </label>
        <label className="admin-check">
          <input type="checkbox" name="active" defaultChecked={pkg ? pkg.active : true} />
          Active (can be given to tenants)
        </label>
      </div>
      {pkg && affected > 0 ? <p className="org-name">A package that tenants use can be made inactive, but not deleted.</p> : null}
      {state?.error ? <p className="error">{state.error}</p> : null}
      <div className="form-actions admin-actions">
        <button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : pkg ? "Save package" : "Create package"}</button>
      </div>
      <dialog ref={dialog} className="admin-dialog" onClose={() => setConfirming(false)}>
        <h2>Change a package in use?</h2>
        <p>This package is used by {affected} tenant{affected === 1 ? "" : "s"}. Their features and default limits change as soon as you save.</p>
        <div className="form-actions admin-actions">
          <button type="button" className="admin-secondary" onClick={() => setConfirming(false)}>Back</button>
          <button type="submit" disabled={pending}>Confirm and save</button>
        </div>
      </dialog>
    </form>
  );
}
