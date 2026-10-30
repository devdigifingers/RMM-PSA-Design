import { platformGet } from "../api";
import { formatDate } from "../catalog";
import { platformMemberAction, revokePlatformInvite } from "../actions";
import { PlatformInviteForm } from "./invite-form";

export const metadata = { title: "Platform team · Digital Fingers RMM" };

const LEVELS = [
  ["super", "Super admin", "Everything in Control, plus inviting people and changing levels on this page."],
  ["admin", "Platform admin", "Runs Control: tenants, packages, migrations, notices. Can't change the team."],
  ["support", "Support (read-only)", "Can open every Control page but can't change anything or view as a tenant."],
];
const LEVEL_LABEL = Object.fromEntries(LEVELS.map(([key, label]) => [key, label]));

const SAVED = {
  invited: "Invite sent. They set a password from the email and set up MFA at their first sign-in.",
  "invite-revoked": "Invite cancelled.",
  role: "Level changed. They were signed out so the new level applies straight away.",
  disable: "Account deactivated and signed out.",
  enable: "Account reactivated.",
  "reset-mfa": "MFA reset. They were signed out and must set up a new authenticator at their next sign-in.",
  unchanged: "Nothing changed.",
};

function MfaState({ member }) {
  if (member.mfaEnabled) return <span className="usage-state">On</span>;
  const due = member.mfaDueAt ? new Date(member.mfaDueAt) : null;
  if (!due || due.getTime() <= Date.now()) return <span className="usage-state is-full">Needed at next sign-in</span>;
  return <span className="usage-state is-near">Due {formatDate(member.mfaDueAt)}</span>;
}

function MemberButton({ member, action, label, danger }) {
  return (
    <form action={platformMemberAction} className="admin-inline">
      <input type="hidden" name="userId" value={member.id} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={danger ? "danger" : "admin-secondary"}>{label}</button>
    </form>
  );
}

export default async function PlatformTeamPage({ searchParams }) {
  const query = await searchParams;
  const { members, invites, you } = await platformGet("/v1/platform/team");
  const isSuper = you.role === "super";

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Platform team</h1>
          <p className="org-name">The Digital Fingers people who can sign in to Control. Every platform account must use an authenticator app.</p>
        </div>
      </header>
      {SAVED[query?.saved] ? <p className="saved admin-note">{SAVED[query.saved]}</p> : null}
      {query?.error ? <p className="error admin-note">{String(query.error)}</p> : null}
      {!isSuper ? <p className="org-name">You're a {LEVEL_LABEL[you.role] || you.role}. Only a super admin can invite people or change this team.</p> : null}

      <div className="usage-table admin-table">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Level</th>
              <th>MFA</th>
              <th>Status</th>
              {isSuper ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const self = member.id === you.id;
              return (
                <tr key={member.id}>
                  <td className="team-person">
                    <strong>{member.name}{self ? " (you)" : ""}</strong>
                    <small>{member.email}</small>
                  </td>
                  <td>
                    {isSuper && !self ? (
                      <form action={platformMemberAction} className="admin-inline">
                        <input type="hidden" name="userId" value={member.id} />
                        <input type="hidden" name="action" value="role" />
                        <select name="role" defaultValue={member.role} aria-label={`Level for ${member.name}`}>
                          {LEVELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                        <button type="submit">Save</button>
                      </form>
                    ) : LEVEL_LABEL[member.role] || member.role}
                  </td>
                  <td><MfaState member={member} /></td>
                  <td><span className={member.active ? "usage-state" : "usage-state is-full"}>{member.active ? "Active" : "Deactivated"}</span></td>
                  {isSuper ? (
                    <td>
                      {self ? null : (
                        <div className="team-actions">
                          {member.mfaEnabled ? <MemberButton member={member} action="reset-mfa" label="Reset MFA" /> : null}
                          {member.active
                            ? <MemberButton member={member} action="disable" label="Deactivate" danger />
                            : <MemberButton member={member} action="enable" label="Reactivate" />}
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invites.length ? (
        <section className="admin-card admin-wide">
          <h2>Open invites</h2>
          <div className="usage-table admin-table">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Level</th><th>Sent by</th><th>Expires</th>{isSuper ? <th /> : null}</tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.name}</td>
                    <td>{invite.email}</td>
                    <td>{LEVEL_LABEL[invite.role] || invite.role}</td>
                    <td>{invite.invitedBy || "—"}</td>
                    <td>{invite.expired ? <span className="usage-state is-full">Expired</span> : formatDate(invite.expiresAt)}</td>
                    {isSuper ? (
                      <td>
                        <form action={revokePlatformInvite} className="admin-inline">
                          <input type="hidden" name="inviteId" value={invite.id} />
                          <button type="submit" className="admin-secondary">Cancel invite</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isSuper ? (
        <section className="admin-card admin-wide">
          <h2>Invite someone</h2>
          <p className="org-name">Use their Digital Fingers work address. An email that already belongs to a tenant login can't also be a platform account. The link works for 7 days.</p>
          <PlatformInviteForm />
        </section>
      ) : null}

      <section className="admin-card admin-wide">
        <h2>Levels</h2>
        <dl className="admin-dl">
          {LEVELS.flatMap(([key, label, about]) => [<dt key={`${key}-t`}>{label}</dt>, <dd key={`${key}-d`}>{about}</dd>])}
        </dl>
        <p className="org-name">
          Nobody can change their own level or deactivate themselves, and the last active super admin can't be demoted or deactivated.
          If every super admin is locked out, the server&apos;s break-glass script can create a new one; it is recorded in the audit log.
        </p>
      </section>
    </section>
  );
}
