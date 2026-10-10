import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, dateInputValue, formatWhen } from "../account-data";
import { saveLicense } from "../actions";
import { PasswordReset, RibbonForm, TenantForm } from "./forms";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const MODULES = [
  ["core", "Device enrollment"],
  ["remote_desktop", "Remote sessions"],
  ["ticketing", "Ticketing"],
  ["monitoring", "Monitoring"],
  ["patch", "Patching"],
  ["reporting", "Reporting"],
];

export default async function ControlPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account?.user?.isPlatformAdmin) redirect("/devices");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  const response = await fetch(`${apiUrl}/v1/platform/tenants`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/devices");
  const body = await response.json();
  const params = await searchParams;
  const notice = noticeFrom(params);

  return (
    <div className="console">
      <ConsoleBar platform />
      <main className="main">
        <h1>Control panel</h1>
        <p className="org-name">Tenants, the license sold to each one, and the people who sign in there.</p>
        {notice ? <p className={notice.kind}>{notice.text}</p> : null}
        <section className="tenant">
          <h2>Ribbon notice</h2>
          <p className="org-name">Shows on the yellow bar for every tenant, or only the tenant you select. The people who see it can close it for themselves.</p>
          <RibbonForm tenants={body.tenants || []} ribbons={body.ribbons || []} />
        </section>
        {(body.tenants || []).map((tenant) => (
          <section className="tenant" key={tenant.id}>
            <h2>{tenant.name}</h2>
            <p className="org-name">
              {tenant.slug} · License {tenant.license.number} · {tenant.license.deviceCount} enrolled · Created {formatWhen(tenant.createdAt)}
            </p>
            <form action={saveLicense} className="license-grid">
              <input type="hidden" name="orgId" value={tenant.id} />
              <label>
                License type
                <input name="plan" defaultValue={tenant.license.plan} required maxLength={40} />
              </label>
              <label>
                Seats
                <input name="seats" type="number" min="1" step="1" defaultValue={tenant.license.seats} required />
              </label>
              <label>
                Systems that can be monitored
                <input name="deviceCap" type="number" min="0" step="1" defaultValue={tenant.license.deviceCap} required />
              </label>
              <label>
                Expires
                <input name="expiresAt" type="date" defaultValue={dateInputValue(tenant.license.expiresAt)} />
              </label>
              <div className="checks">
                {MODULES.map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" name={`module.${key}`} defaultChecked={tenant.license.modules?.[key] === true} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="form-actions">
                <button type="submit">Save license</button>
              </div>
            </form>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {tenant.users.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={5}>No logins in this tenant yet.</td>
                  </tr>
                ) : tenant.users.map((person) => (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{person.email}</td>
                    <td>{person.accountNumber}</td>
                    <td>{person.roles?.length ? person.roles.map(roleLabel).join(", ") : "Member"}</td>
                    <td><PasswordReset userId={person.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <section className="tenant">
          <h2>New tenant</h2>
          <p className="org-name">Creates the company, its license, and the first admin login.</p>
          <TenantForm />
        </section>
      </main>
    </div>
  );
}

function noticeFrom(params) {
  if (params?.saved === "license") return { kind: "saved", text: "License saved." };
  if (params?.saved === "ribbon") return { kind: "saved", text: "Ribbon notice published." };
  if (params?.saved === "ribbon-off") return { kind: "saved", text: "Ribbon notice removed." };
  if (params?.saved === "password") return { kind: "saved", text: "Password saved for that login." };
  if (params?.saved === "tenant") return { kind: "saved", text: "Tenant created." };
  if (params?.error === "match") return { kind: "error", text: "The new password and the confirmation do not match." };
  if (params?.error === "short") return { kind: "error", text: "Use at least 8 characters." };
  if (params?.error === "slug") return { kind: "error", text: "That company code is already in use, or it is not lowercase letters, numbers, and hyphens." };
  if (params?.error === "email") return { kind: "error", text: "That email is already a login." };
  if (params?.error === "seats") return { kind: "error", text: "Seats must be at least 1, and the device cap must be zero or more." };
  if (params?.error === "fields") return { kind: "error", text: "Enter the company, the company code, and a license type." };
  if (params?.error === "date") return { kind: "error", text: "Enter a valid expiry date, or leave it empty." };
  if (params?.error === "user") return { kind: "error", text: "That login cannot be changed from the control panel." };
  if (params?.error === "denied") return { kind: "error", text: "This login cannot change tenants." };
  if (params?.error === "message") return { kind: "error", text: "Enter a notice of 180 characters or less." };
  if (params?.error === "link") return { kind: "error", text: "The link must start with http:// or https://." };
  if (params?.error === "tenant") return { kind: "error", text: "Choose all tenants, or one tenant from the list." };
  if (params?.error === "ribbon") return { kind: "error", text: "The ribbon notice was not saved." };
  if (params?.error) return { kind: "error", text: "The change was not saved." };
  return null;
}

function roleLabel(role) {
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}
