import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, formatWhen, navFlags } from "../account-data";
import { Facts } from "../facts";

export default async function OrganizationPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>My Organization</h1>
        {account.org ? (
          <>
            <p className="org-name">Company details for the organisation on this login.</p>
            <Facts rows={[
              { label: "Company", value: account.org.name },
              { label: "Organisation code", value: account.org.slug },
              { label: "Created", value: formatWhen(account.org.createdAt) },
            ]} />
          </>
        ) : (
          <p className="org-name">
            {account.user.isPlatformAdmin
              ? <>This login sits above the tenants. Companies and licenses are on the <a href="/control">control panel</a>.</>
              : "This account is not linked to an organisation."}
          </p>
        )}
      </main>
    </div>
  );
}
