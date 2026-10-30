import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";
import { logout, saveRequireMfa } from "../../../actions";
import { Wordmark } from "../../../mark";
import { MfaCard } from "./mfa-card";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function MfaPage({ searchParams }) {
  const account = await accountFromSession({ allowMfaSetup: true });
  if (!account) redirect("/");
  const required = account.user.mfaSetupRequired === true;
  const card = <MfaCard enabled={account.user.mfaEnabled} orgRequires={account.org?.requireMfa === true} platform={account.user.isPlatformAdmin === true} required={required} />;

  if (required) {
    return (
      <main className="login-shell">
        <section className="login-card mfa-required">
          <div className="login-brand">
            <div className="brand-plate"><Wordmark tagline /></div>
          </div>
          <h1>Set up MFA to continue</h1>
          <p className="org-name">
            {account.user.isPlatformAdmin
              ? "Platform accounts need a code from an authenticator app for every sign-in."
              : `${account.org?.name || "Your organisation"} requires a code from an authenticator app for every sign-in.`}
          </p>
          {card}
          <form action={logout}>
            <button type="submit" className="mfa-login-back">Sign out</button>
          </form>
        </section>
      </main>
    );
  }

  const manage = !account.user.isPlatformAdmin && (account.user.roles || []).some((role) => role === "owner" || role === "admin");
  const params = await searchParams;
  const jar = await cookies();
  let org = null;
  if (manage) {
    const response = await fetch(`${apiUrl}/v1/org/security`, {
      headers: {
        authorization: `Bearer ${jar.get("df_session")?.value}`,
        "x-forwarded-for": (await headers()).get("x-forwarded-for") || "",
      },
      cache: "no-store",
    });
    org = response.ok ? await response.json() : null;
  }
  const flash = params?.error ? jar.get("df_flash")?.value || "That change was not saved." : null;

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/settings/org/mfa" />
        <h1>Multi-Factor Authentication</h1>
        <p className="org-name">Protect sign-in with a second step: a code from an app on your phone.</p>
        {params?.saved === "org" ? <p className="saved" role="status">Organisation setting saved.</p> : null}
        {flash ? <p className="error" role="alert">{flash}</p> : null}
        {card}
        {org ? (
          <section className="mfa-card">
            <h2>Organisation policy</h2>
            <p className="org-name">
              {org.mfaUsers} of {org.activeUsers} active logins have MFA on.
              {org.requireMfa ? " Everyone must use MFA." : " MFA is optional."}
            </p>
            <form action={saveRequireMfa} className="mfa-policy">
              <input type="hidden" name="requireMfa" value={org.requireMfa ? "0" : "1"} />
              <p className="org-name">
                {org.requireMfa
                  ? "Logins without MFA must set it up at their next sign-in before they can use the console."
                  : "When required, logins without MFA are sent to set it up before they can use the console."}
              </p>
              <button type="submit" className={org.requireMfa ? "danger" : undefined}>
                {org.requireMfa ? "Make MFA optional" : "Require MFA for everyone"}
              </button>
            </form>
            <p className="org-name">If someone loses their phone and recovery codes, reset their MFA on <a href="/settings/org/technicians">Manage Technicians</a>.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
