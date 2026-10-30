import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";
import { saveIpAllowlist } from "../../../actions";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function IpRestrictionPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const jar = await cookies();
  const response = await fetch(`${apiUrl}/v1/org/security`, {
    headers: {
      authorization: `Bearer ${jar.get("df_session")?.value}`,
      "x-forwarded-for": (await headers()).get("x-forwarded-for") || "",
    },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const org = response.ok ? await response.json() : null;
  const flash = params?.error ? jar.get("df_flash")?.value || "That change was not saved." : null;

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/settings/org/ip-restriction" />
        <h1>IP Based Restriction</h1>
        <p className="org-name">Only allow sign-in to this console from your office or VPN addresses. Leave the list empty to allow sign-in from anywhere.</p>
        {params?.saved ? <p className="saved" role="status">Saved. Everyone else in the organisation was signed out and must sign in again from an allowed address.</p> : null}
        {flash ? <p className="error" role="alert">{flash}</p> : null}
        {!org ? (
          <p className="error">Only an owner or admin can change security settings.</p>
        ) : (
          <section className="mfa-card">
            <div className="tech-seats">
              Your current address: <strong>{org.yourAddress}</strong>
              {org.ipAllowlist.length ? <span>Restricted</span> : <span className="full">Open to all addresses</span>}
            </div>
            <form action={saveIpAllowlist} className="ip-form">
              <label>
                Allowed addresses and ranges, one per line
                <textarea name="ipAllowlist" rows={8} defaultValue={org.ipAllowlist.join("\n")} placeholder={`${org.yourAddress}\n196.25.0.0/16`} spellCheck={false} />
              </label>
              <p className="org-name">Use a single address such as 41.13.8.20 or a range such as 41.13.8.0/24. IPv6 works too. Your current address must be in the list, so you cannot lock yourself out.</p>
              <button type="submit">Save</button>
            </form>
            <p className="org-name">This applies to signing in to the console. Devices, the agent and customers joining a remote support session are not affected.</p>
          </section>
        )}
      </main>
    </div>
  );
}
