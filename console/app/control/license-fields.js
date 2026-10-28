"use client";

import { AppIcon } from "../mark";
import { FEATURE_GROUPS, FEATURE_KEYS, LICENSE_TYPES, packageLabel } from "./catalog";

export function licenseValue(license) {
  return {
    packageId: license?.packageId ? String(license.packageId) : "",
    licenseType: license?.licenseType || "standard",
    seatsOverride: license?.seatsOverride ?? "",
    devicesOverride: license?.devicesOverride ?? "",
    sessionsOverride: license?.sessionsOverride ?? "",
    featuresAdded: license?.featuresAdded || [],
    featuresRemoved: license?.featuresRemoved || [],
    noExpiry: license ? license.noExpiry === true || !license.expiresAt : true,
    expiresAt: license?.expiresAtInput || "",
    status: license?.status || "active",
  };
}

export function effectiveOf(pkg, value) {
  const features = new Set(pkg?.features || []);
  for (const key of value.featuresAdded) features.add(key);
  for (const key of value.featuresRemoved) features.delete(key);
  const pick = (override, fallback) => (override === "" || override == null ? fallback : Number(override));
  return {
    features: FEATURE_KEYS.filter((key) => features.has(key)),
    seats: pick(value.seatsOverride, pkg?.defaultSeats),
    devices: pick(value.devicesOverride, pkg?.defaultDevices),
    sessions: pick(value.sessionsOverride, pkg?.defaultSessions),
  };
}

export function LicenseFields({ value, onChange, packages, showStatus = true }) {
  const pkg = packages.find((item) => String(item.id) === value.packageId);
  const inPackage = new Set(pkg?.features || []);
  const set = (patch) => onChange({ ...value, ...patch });

  function choosePackage(id) {
    const next = new Set(packages.find((item) => String(item.id) === id)?.features || []);
    set({
      packageId: id,
      featuresAdded: value.featuresAdded.filter((key) => !next.has(key)),
      featuresRemoved: value.featuresRemoved.filter((key) => next.has(key)),
    });
  }

  function toggle(key) {
    if (inPackage.has(key)) {
      const removed = value.featuresRemoved.includes(key);
      set({ featuresRemoved: removed ? value.featuresRemoved.filter((item) => item !== key) : [...value.featuresRemoved, key] });
    } else {
      const added = value.featuresAdded.includes(key);
      set({ featuresAdded: added ? value.featuresAdded.filter((item) => item !== key) : [...value.featuresAdded, key] });
    }
  }

  const choosable = packages.filter((item) => item.active || String(item.id) === value.packageId);
  return (
    <div className="admin-license">
      <div className="license-grid">
        <label>
          Package
          <select name="packageId" value={value.packageId} onChange={(event) => choosePackage(event.target.value)} required>
            <option value="" disabled>Choose a package</option>
            {choosable.map((item) => (
              <option key={item.id} value={item.id}>{packageLabel(item)}{item.active ? "" : " (inactive)"}</option>
            ))}
          </select>
        </label>
        <label>
          License type
          <select name="licenseType" value={value.licenseType} onChange={(event) => set({ licenseType: event.target.value })}>
            {LICENSE_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {showStatus ? (
          <label>
            Status
            <select name="status" value={value.status} onChange={(event) => set({ status: event.target.value })}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
        ) : null}
      </div>
      <div className="license-grid">
        <label>
          Seats
          <input name="seatsOverride" type="number" min="1" step="1" value={value.seatsOverride} placeholder={pkg ? `${pkg.defaultSeats} (package)` : ""} onChange={(event) => set({ seatsOverride: event.target.value })} />
        </label>
        <label>
          Devices
          <input name="devicesOverride" type="number" min="0" step="1" value={value.devicesOverride} placeholder={pkg ? `${pkg.defaultDevices} (package)` : ""} onChange={(event) => set({ devicesOverride: event.target.value })} />
        </label>
        <label>
          Support sessions at once
          <input name="sessionsOverride" type="number" min="0" max="100" step="1" value={value.sessionsOverride} placeholder={pkg ? `${pkg.defaultSessions} (package)` : ""} onChange={(event) => set({ sessionsOverride: event.target.value })} />
        </label>
      </div>
      <p className="org-name">Leave a limit blank to use the package default.</p>
      <div className="admin-features">
        {FEATURE_GROUPS.map((group) => (
          <fieldset key={group.app} className="feature-group">
            <legend><AppIcon app={group.appId} size={20} /> {group.title}</legend>
            {group.features.map(([key, label]) => {
              const fromPackage = inPackage.has(key);
              const removed = value.featuresRemoved.includes(key);
              const added = value.featuresAdded.includes(key);
              const checked = (fromPackage && !removed) || added;
              const tag = fromPackage ? (removed ? "Removed" : "From package") : added ? "Added" : null;
              return (
                <label key={key} className="admin-check">
                  <input type="checkbox" checked={checked} onChange={() => toggle(key)} disabled={!pkg} />
                  {label}
                  {tag ? <span className={`inherit-tag is-${tag.toLowerCase().replace(" ", "-")}`}>{tag}</span> : null}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <input type="hidden" name="featuresAdded" value={JSON.stringify(value.featuresAdded)} />
      <input type="hidden" name="featuresRemoved" value={JSON.stringify(value.featuresRemoved)} />
      <div className="license-grid">
        <label className="admin-check">
          <input type="checkbox" name="noExpiry" checked={value.noExpiry} onChange={(event) => set({ noExpiry: event.target.checked })} />
          No expiry
        </label>
        <label>
          Expires
          <input name="expiresAt" type="date" value={value.noExpiry ? "" : value.expiresAt} disabled={value.noExpiry} required={!value.noExpiry} onChange={(event) => set({ expiresAt: event.target.value })} />
        </label>
      </div>
    </div>
  );
}
