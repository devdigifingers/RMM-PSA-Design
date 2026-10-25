import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../bar";
import { accountFromSession, formatWhen, navFlags } from "../../account-data";
import { addTechnician, updateTechnician } from "../../actions";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const ROLE_LABELS = { owner: "Owner", admin: "Admin", tech: "Technician" };

const NOTICES = {
  added: ["saved", "Technician added. Give them their email and password so they can sign in."],
  role: ["saved", "Role changed. They need to sign in again."],
  disabled: ["saved", "Login disabled and signed out. The seat is free again."],
  enabled: ["saved", "Login enabled."],
  email: ["error", "That email is already a login."],
  bademail: ["error", "Enter a valid email address."],
  short: ["error", "Use at least 8 characters for the password."],
  seats: ["error", "All logins on the licence are in use. Disable a technician or add seats first."],
  owner: ["error", "Only an owner can add, change or appoint an owner."],
  managers: ["error", "The organisation needs at least one active owner or admin."],
  self: ["error", "You cannot change your own role or disable your own login."],
  denied: ["error", "Only an owner or admin can manage technicians."],
  save: ["error", "That change was not saved."],
};

export default async function TechniciansPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const jar = await cookies();
  const response = await fetch(`${apiUrl}/v1/users`, {
    headers: { authorization: `Bearer ${jar.get("df_session")?.value}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const body = response.ok ? await response.json() : null;
  const isOwner = (account.user.roles || []).includes("owner");
  const notice = NOTICES[params?.saved] || NOTICES[params?.error];
  const roles = isOwner ? ["tech", "admin", "owner"] : ["tech", "admin"];

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <p className="settings-crumb"><span>Settings</span> / Organization</p>
        <h1>Manage Technicians</h1>
        <p className="org-name">The people who can sign in to this console for {account.org?.name || "your organisation"}.</p>
        {notice ? <p className={notice[0]} role="status">{notice[1]}</p> : null}
        {!body ? (
          <p className="error">{response.status === 403 ? NOTICES.denied[1] : "The technician list could not be loaded."}</p>
        ) : (
          <>
            <div className="tech-seats">
              <strong>{account.license?.seatsUsed ?? "—"}</strong> of <strong>{account.license?.seats ?? "—"}</strong> logins in use
              {body.seatsLeft > 0 ? <span>{body.seatsLeft} free</span> : <span className="full">Licence full</span>}
            </div>
            <div className="tech-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Added</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {body.users.map((user) => {
                    const self = user.id === Number(account.user.id);
                    const locked = self || (user.role === "owner" && !isOwner);
                    return (
                      <tr key={user.id} className={user.disabledAt ? "is-disabled" : undefined}>
                        <td className="tech-name">{user.name}{self ? <span className="tech-you">You</span> : null}</td>
                        <td>{user.email}</td>
                        <td>
                          {locked ? ROLE_LABELS[user.role] : (
                            <form action={updateTechnician} className="tech-role">
                              <input type="hidden" name="id" value={user.id} />
                              <select name="role" defaultValue={user.role} aria-label={`Role for ${user.name}`}>
                                {roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                              </select>
                              <button type="submit" className="secondary">Save</button>
                            </form>
                          )}
                        </td>
                        <td className="tech-nowrap">{formatWhen(user.createdAt)}</td>
                        <td>{user.disabledAt ? <span className="tech-state off">Disabled</span> : <span className="tech-state on">Active</span>}</td>
                        <td>
                          {locked ? null : (
                            <form action={updateTechnician}>
                              <input type="hidden" name="id" value={user.id} />
                              <input type="hidden" name="disabled" value={user.disabledAt ? "0" : "1"} />
                              <button type="submit" className={user.disabledAt ? "secondary" : "danger"}>
                                {user.disabledAt ? "Enable" : "Disable"}
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <form action={addTechnician} className="tech-add">
              <h2>Add a technician</h2>
              <p className="org-name">Admins can do everything in the console. Technicians can view devices and use remote support, but cannot run commands, change files or manage settings.</p>
              <div className="tech-add-grid">
                <label>Full name<input name="name" required maxLength={120} autoComplete="off" /></label>
                <label>Email<input name="email" type="email" required maxLength={200} autoComplete="off" /></label>
                <label>
                  Role
                  <select name="role" defaultValue="tech">
                    {roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  </select>
                </label>
                <label>Temporary password<input name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password" /></label>
              </div>
              <button type="submit" disabled={body.seatsLeft < 1}>Add technician</button>
              {body.seatsLeft < 1 ? <p className="org-name">The licence has no free logins. <a href="/subscription">Manage Subscription</a></p> : null}
            </form>
          </>
        )}
      </main>
    </div>
  );
}
