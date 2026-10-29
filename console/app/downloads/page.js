import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, entitlements, navFlags } from "../account-data";
import { consoleOrigin } from "../agent/package";
import { DownloadGrid } from "./download-grid";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Downloads" };

export default async function DownloadsPage() {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const manage = (account.user.roles || []).some((role) => role === "owner" || role === "admin");
  const license = account.license;
  const full = license?.deviceCap > 0 && license?.deviceCount >= license.deviceCap;
  const { features } = entitlements(account);
  const accounts = manage && license?.ticketing === true ? await loadAccounts() : [];
  let blocked = "";
  if (!manage) blocked = "Only an owner or admin can download the unattended access installer.";
  else if (full) blocked = "All devices on the licence are in use. Remove a device or add capacity first.";

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main downloads-page">
        <h1>Downloads</h1>
        <p className="downloads-intro">
          Install Digital Fingers desktop on a computer for the first time. Pick the row that matches who will use it.
          A computer that already has the agent gets its update from <strong>Agent Updates</strong> in the account menu.
        </p>
        <DownloadGrid
          accounts={accounts}
          blocked={blocked}
          quickSupport={features.includes("remote_support")}
          orgName={account.org?.name || "your organisation"}
          commands={manage ? await loadCommands() : []}
          origin={consoleOrigin}
        />
      </main>
    </div>
  );
}

async function loadCommands() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return [];
  const response = await fetch(`${apiUrl}/v1/enroll-tokens`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json()).commands || [];
}

async function loadAccounts() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return [];
  const response = await fetch(`${apiUrl}/v1/accounts`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = await response.json();
  return (body.accounts || []).map((item) => ({ id: item.id, name: item.name }));
}
