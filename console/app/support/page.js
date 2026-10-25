import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";
import { SupportDesk } from "./support-desk";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Remote Support" };

export default async function SupportPage({ searchParams }) {
  const params = await searchParams;
  const wrapId = typeof params?.wrap === "string" && /^\d+$/.test(params.wrap) ? params.wrap : "";
  const account = await accountFromSession();
  if (account?.user?.isPlatformAdmin) redirect("/control");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  const response = await fetch(`${apiUrl}/v1/support-sessions`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const body = response.ok ? await response.json() : null;
  const error = body ? "" : (await response.json().catch(() => ({}))).error || "Remote support is not available.";

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main support">
        {body ? (
          <SupportDesk initial={body} wrapId={wrapId} />
        ) : (
          <>
            <h1>Remote Support</h1>
            <p className="error">{error}</p>
            <p className="org-name">Remote support is a separate license option. Ask Digital Fingers to add it from Manage Subscription.</p>
          </>
        )}
      </main>
    </div>
  );
}
