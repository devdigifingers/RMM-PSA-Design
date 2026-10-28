import Link from "next/link";
import { platformGet } from "../../api";
import { APP_TITLE, FEATURE_LABEL, LICENSE_TYPES, expiryLabel, formatDate, meter } from "../../catalog";
import { AppIcons, StatusChip, Tabs, UsageMeter } from "../../ui";
import { updateTenantUser } from "../../actions";
import { LicenseEditor } from "./license-editor";
import { AddUserForm, PasswordForm } from "./user-forms";

export const metadata = { title: "Tenant · Digital Fingers RMM" };

const TABS = [
  ["overview", "Overview"],
  ["license", "License & package"],
  ["users", "Users"],
  ["usage", "Usage"],
  ["billing", "Billing"],
];

const SAVED = {
  created: "Tenant created.",
  license: "License saved.",
  unchanged: "Nothing changed, so nothing was saved.",
  user: "User saved.",
  "user-added": "User added.",
  password: "Password saved.",
};

export default async function TenantPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const tab = TABS.some(([key]) => key === query?.tab) ? query.tab : "overview";
  const body = await platformGet(`/v1/platform/tenants/${Number(id)}`);
  const { tenant, license, usage, users, packages } = body;
  const typeLabel = Object.fromEntries(LICENSE_TYPES)[tenant.licenseType] || tenant.licenseType;

  return (
    <section className="admin-page">
      <p className="desk-back"><Link href="/control/tenants">← All tenants</Link></p>
      <header className="admin-head">
        <div>
          <h1>{tenant.name} <StatusChip status={tenant.status} /></h1>
          <p className="org-name">{tenant.slug} · License {tenant.licenseNumber} · {tenant.package?.name || "No package"}</p>
        </div>
      </header>
      <Tabs base={`/control/tenants/${tenant.id}`} tab={tab} tabs={TABS} />
      {SAVED[query?.saved] ? <p className="saved admin-note">{SAVED[query.saved]}</p> : null}
      {query?.error ? <p className="error admin-note">{String(query.error)}</p> : null}

      {tab === "overview" ? (
        <div className="admin-cards">
          <section className="admin-card">
            <h2>Company</h2>
            <dl className="admin-dl">
              <dt>Name</dt><dd>{tenant.name}</dd>
              <dt>Slug</dt><dd>{tenant.slug}</dd>
              <dt>License no.</dt><dd>{tenant.licenseNumber}</dd>
              <dt>Created</dt><dd>{formatDate(tenant.createdAt)}</dd>
            </dl>
          </section>
          <section className="admin-card">
            <h2>Package</h2>
            <dl className="admin-dl">
              <dt>Package</dt><dd>{tenant.package?.name || "—"}</dd>
              <dt>Apps</dt><dd><AppIcons apps={tenant.apps} /> {tenant.apps.map((app) => APP_TITLE[app]).join(", ") || "None"}</dd>
              <dt>License type</dt><dd>{typeLabel}</dd>
              <dt>Expires</dt><dd>{expiryLabel(tenant)}</dd>
              <dt>Status</dt><dd><StatusChip status={tenant.status} /></dd>
            </dl>
          </section>
          <section className="admin-card">
            <h2>Usage</h2>
            <UsageMeter label="Seats" meter={meter(usage.seatsUsed, tenant.seats)} />
            <UsageMeter label="Devices" meter={meter(usage.deviceCount, tenant.devices)} />
            <UsageMeter label="Support sessions now" meter={meter(usage.sessionsRunning, tenant.sessions)} />
          </section>
        </div>
      ) : null}

      {tab === "license" ? (
        license ? (
          <LicenseEditor tenant={tenant} license={license} usage={usage} packages={packages} />
        ) : <p className="org-name">This tenant has no license.</p>
      ) : null}

      {tab === "users" ? (
        <>
          <div className="usage-table admin-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>No users in this tenant yet.</td></tr>
                ) : users.map((person) => (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{person.email}</td>
                    <td>{person.accountNumber}</td>
                    <td>
                      <form action={updateTenantUser} className="admin-inline">
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="userId" value={person.id} />
                        <select name="role" defaultValue={person.role} aria-label={`Role for ${person.name}`}>
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="tech">Tech</option>
                        </select>
                        <button type="submit">Save</button>
                      </form>
                    </td>
                    <td>
                      <form action={updateTenantUser} className="admin-inline">
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="userId" value={person.id} />
                        <input type="hidden" name="disabled" value={person.disabledAt ? "0" : "1"} />
                        <span className={person.disabledAt ? "usage-state is-full" : "usage-state"}>{person.disabledAt ? "Deactivated" : "Active"}</span>
                        <button type="submit" className="admin-secondary">{person.disabledAt ? "Reactivate" : "Deactivate"}</button>
                      </form>
                    </td>
                    <td><PasswordForm tenantId={tenant.id} userId={person.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="admin-card admin-wide">
            <h2>Add a user</h2>
            <p className="org-name">Uses a seat. {Math.max(0, tenant.seats - usage.seatsUsed)} of {tenant.seats} seats free.</p>
            <AddUserForm tenantId={tenant.id} />
          </section>
        </>
      ) : null}

      {tab === "usage" ? (
        <section className="admin-card admin-wide">
          <h2>Current usage</h2>
          <UsageMeter label="Seats" meter={meter(usage.seatsUsed, tenant.seats)} />
          <UsageMeter label="Devices" meter={meter(usage.deviceCount, tenant.devices)} />
          <UsageMeter label="Support sessions now" meter={meter(usage.sessionsRunning, tenant.sessions)} />
          <p className="org-name">Usage over time is not recorded yet, so only current values are shown.</p>
          <h2>Features</h2>
          <p>{tenant.features.map((key) => FEATURE_LABEL[key]).join(", ") || "None"}</p>
        </section>
      ) : null}

      {tab === "billing" ? (
        <section className="admin-card admin-wide">
          <h2>Billing</h2>
          <p className="org-name">Coming soon.</p>
        </section>
      ) : null}
    </section>
  );
}
