import { notFound } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, formatWhen } from "../account-data";

export default async function ControlLayout({ children }) {
  const account = await accountFromSession();
  if (!account?.user?.isPlatformAdmin) notFound();
  const { mfaDueAt, platformRole } = account.user;
  return (
    <div className="console">
      <ConsoleBar platform />
      <main className="main admin-main">
        {mfaDueAt ? (
          <p className="control-banner" role="status">
            Platform accounts must use an authenticator app. Set it up before {formatWhen(mfaDueAt)}, or you&apos;ll be asked to at your next sign-in.
            <a href="/settings/org/mfa">Set up MFA</a>
          </p>
        ) : null}
        {platformRole === "support" ? (
          <p className="control-banner" role="status">You have read-only access. Ask a platform admin to make changes.</p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
