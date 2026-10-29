import { cookies } from "next/headers";
import { AccountMenu } from "./account-menu";
import { accountFromSession, entitlements, licenseStatus } from "./account-data";
import { logout } from "./actions";
import { customerApps } from "./customers/shared";
import { AppLauncher } from "./launcher";
import { BrandMark, Wordmark } from "./mark";
import { BrandLink, NavLinks } from "./nav-links";
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
          <BrandLink platform={Boolean(platform)} allowed={{ remote: allowed.remote, service: allowed.service }} lastApp={lastApp}>
            <Wordmark />
            <BrandMark className="brand-mark" />
          </BrandLink>
        </div>
        {!platform && allowed.remote ? <SearchConnect /> : <span className="topbar-spacer" />}
        {account?.user ? (
          <div className="top-tools">
            {account.user.isPlatformAdmin ? null : (
              <a className="settings-btn downloads-btn" href="/downloads" aria-label="Downloads" title="Downloads">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4.5 15.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </a>
            )}
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
            ["/control/system", "System"],
          ]}
        />
      ) : (
        <NavLinks
          lastApp={lastApp}
          links={allowed.remote || allowed.service ? [
            allowed.support ? ["/support", "Support"] : null,
            ["/devices", "Devices"],
            ["/dashboard", "Dashboard"],
            showAlerts ? ["/alerts", "Alerts"] : null,
            showPatches ? ["/patches", "Patches"] : null,
            ["/audit", "Audit"],
          ].filter(Boolean) : []}
          serviceLinks={allowed.service ? [["/tickets", "Tickets"], ["/audit", "Audit"]] : []}
          reportLinks={allowed.reports ? [
            ["/reports", "Overview", "/reports", true],
            ["/reports/agents", "Agents"],
            ["/reports/os", "OS"],
            ["/reports/locations", "Locations"],
            ["/reports/patches", "Patches"],
            ["/reports/uptime", "Uptime"],
            ["/reports/sessions", "Sessions"],
            allowed.ticketing ? ["/reports/service-desk", "Service Desk"] : null,
            ["/reports/exports", "Scheduled"],
          ].filter(Boolean) : []}
          customers={account?.user ? customerApps(account) : null}
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
    reports: features.includes("reporting"),
    ticketing: features.includes("ticketing"),
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
