import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor } from "./account-data";
import { cancelLoginCode, login, verifyLoginCode } from "./actions";
import { Wordmark } from "./mark";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function LoginPage({ searchParams }) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (token) {
    const session = await fetch(`${apiUrl}/v1/account`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (session.ok) {
      const account = await session.json();
      if (account.user?.mfaSetupRequired) redirect("/settings/mfa");
      redirect(homeFor(account));
    }
  }
  const params = await searchParams;
  const invalid = params?.error === "invalid";
  const locked = params?.error === "locked";
  const codeStep = params?.step === "mfa" && Boolean(jar.get("df_mfa")?.value);
  const messages = {
    ip: "Sign-in is not allowed from this network. Ask your administrator to add this address.",
    expired: "The sign-in took too long or had too many wrong codes. Sign in again.",
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-plate">
            <Wordmark tagline />
          </div>
        </div>
        <p className="lede">Remote Monitoring and Management</p>
        {codeStep ? (
          <>
            <form action={verifyLoginCode} className="mfa-login">
              <p className="mfa-login-lede">Open your authenticator app and enter the 6-digit code for Digital Fingers RMM.</p>
              <label>
                Verification code
                <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} autoFocus required />
              </label>
              <button type="submit">Verify</button>
              <p className="mfa-login-hint">Lost your phone? Enter one of your recovery codes instead.</p>
            </form>
            <form action={cancelLoginCode}>
              <button type="submit" className="mfa-login-back">Back to sign in</button>
            </form>
            {params?.error === "code" ? <p className="error">That code is not right. Try the newest code.</p> : null}
          </>
        ) : (
          <>
            <form action={login}>
              <label>
                Email
                <input name="email" type="email" autoComplete="username" required />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <button type="submit">Log on</button>
            </form>
            {invalid ? <p className="error">That email or password is not valid.</p> : null}
            {locked ? <p className="error">Too many sign-in attempts. Wait 15 minutes and try again.</p> : null}
            {messages[params?.error] ? <p className="error">{messages[params.error]}</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
