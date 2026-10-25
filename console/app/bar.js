import { cookies } from "next/headers";
import { AccountMenu } from "./account-menu";
import { accountFromSession, licenseStatus } from "./account-data";
import { logout } from "./actions";
import { AppLauncher } from "./launcher";
import { Wordmark } from "./mark";
import { NavLinks } from "./nav-links";
import { Ribbon, SystemNotices } from "./notices";
import { SearchConnect } from "./search-connect";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function ConsoleBar({ showAlerts, showPatches, showDashboard, platform }) {
  const account = await accountFromSession();
  const notices = await loadNotices();
  const allowed = appsAllowed(account);
  const jar = await cookies();
  const saved = jar.get("df_app")?.value;
  const lastApp = saved === "service" && allowed.service ? "service" : allowed.remote || !allowed.service ? "remote" : "service";
  return (
    <>
      <header className="topbar">
        <div className="brand-nav">
          <a className="brand-plate" href={platform ? "/control" : lastApp === "service" ? "/tickets" : "/devices"} aria-label="Digital Fingers">
            <Wordmark />
          </a>
        </div>
        {!platform && allowed.remote ? <SearchConnect /> : <span className="topbar-spacer" />}
        {account?.user ? (
          <div className="top-tools">
            <SystemNotices items={notices.devices || []} showOrg={account.user.isPlatformAdmin === true} />
            <AccountMenu user={account.user} />
            <AppLauncher allowed={allowed} lastApp={lastApp} />
          </div>
        ) : (
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        )}
      </header>
      <NavLinks
        lastApp={platform ? "remote" : lastApp}
        links={[
          !platform && allowed.support ? ["/support", "Support"] : null,
          platform ? ["/control", "Tenants"] : ["/devices", "Devices"],
          showDashboard ? ["/dashboard", "Dashboard"] : null,
          showAlerts ? ["/alerts", "Alerts"] : null,
          showPatches ? ["/patches", "Patches"] : null,
          ["/audit", "Audit"],
        ].filter(Boolean)}
        serviceLinks={platform ? null : [["/tickets", "Tickets"], ["/audit", "Audit"]]}
      />
      {notices.ribbon ? <Ribbon notice={notices.ribbon} /> : null}
      <LicenseStrip account={account} />
    </>
  );
}

function LicenseStrip({ account }) {
  const roles = account?.user?.roles || [];
  if (account?.user?.isPlatformAdmin || !(roles.includes("owner") || roles.includes("admin"))) return null;
  const { warnings } = licenseStatus(account.license);
  if (warnings.length === 0) return null;
  const level = warnings.some((item) => item.level === "full") ? "full" : "near";
  return (
    <div className={`license-strip is-${level}`} role="status">
      <p>{warnings.map((item) => item.text).join(" ")}</p>
      <a href="/subscription">Manage Subscription</a>
    </div>
  );
}

function appsAllowed(account) {
  if (account?.user?.isPlatformAdmin) return { service: true, remote: true, support: false };
  const license = account?.license;
  const live = Boolean(license) && (!license.expiresAt || new Date(license.expiresAt) > new Date());
  return {
    service: live && license.ticketing === true,
    remote: live && license.remoteDesktop === true,
    support: live && license.remoteSupport === true,
  };
}

async function loadNotices() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) return { devices: [], ribbon: null };
  const response = await fetch(`${apiUrl}/v1/notices`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return { devices: [], ribbon: null };
  return response.json();
}
