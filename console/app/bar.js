import { cookies } from "next/headers";
import { AccountMenu } from "./account-menu";
import { accountFromSession, entitlements, licenseStatus } from "./account-data";
import { logout } from "./actions";
import { AppLauncher } from "./launcher";
import Link from "next/link";
import { BrandMark, Wordmark } from "./mark";
import { NavLinks } from "./nav-links";
import { Ribbon, SystemNotices } from "./notices";
import { SearchConnect } from "./search-connect";
import { SettingsMenu } from "./settings-menu";

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
          <Link className="brand-plate" href={platform ? "/control/tenants" : lastApp === "service" ? "/tickets" : "/devices"} aria-label="Digital Fingers home">
            <Wordmark />
            <BrandMark className="brand-mark" />
          </Link>
        </div>
        {!platform && allowed.remote ? <SearchConnect /> : <span className="topbar-spacer" />}
        {account?.user ? (
          <div className="top-tools">
            <SettingsMenu
              platform={account.user.isPlatformAdmin === true}
              manage={(account.user.roles || []).some((role) => role === "owner" || role === "admin")}
              allowed={allowed}
              flags={{
                alerts: entitlements(account).features.includes("monitoring"),
                patches: entitlements(account).features.includes("patching"),
                dashboard: entitlements(account).features.includes("reporting"),
              }}
            />
            <SystemNotices items={notices.devices || []} showOrg={account.user.isPlatformAdmin === true} />
            <AccountMenu user={account.user} />
            <AppLauncher entitledApps={allowed.apps} lastApp={lastApp} />
          </div>
        ) : (
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        )}
      </header>
      {platform ? (
        <NavLinks
          label="Admin"
          lastApp="remote"
          links={[
            ["/control/tenants", "Tenants"],
            ["/control/packages", "Packages"],
            ["/control/audit", "Audit"],
            ["/control/notices", "Notices"],
          ]}
        />
      ) : (
        <NavLinks
          lastApp={lastApp}
          links={[
            allowed.support ? ["/support", "Support"] : null,
            ["/devices", "Devices"],
            showDashboard ? ["/dashboard", "Dashboard"] : null,
            showAlerts ? ["/alerts", "Alerts"] : null,
            showPatches ? ["/patches", "Patches"] : null,
            ["/audit", "Audit"],
          ].filter(Boolean)}
          serviceLinks={[["/tickets", "Tickets"], ["/customers", "Customers"], ["/audit", "Audit"]]}
        />
      )}
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
  if (account?.user?.isPlatformAdmin) return { service: true, remote: true, support: false, apps: ["remote", "servicedesk"] };
  const { apps, features } = entitlements(account);
  return {
    service: apps.includes("servicedesk"),
    remote: apps.includes("remote"),
    support: features.includes("remote_support"),
    apps,
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
