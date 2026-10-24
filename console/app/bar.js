import { cookies } from "next/headers";
import { AccountMenu } from "./account-menu";
import { accountFromSession } from "./account-data";
import { logout } from "./actions";
import { Wordmark } from "./mark";
import { NavLinks } from "./nav-links";
import { Ribbon, SystemNotices } from "./notices";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function ConsoleBar({ showTickets, showAlerts, showPatches, showDashboard, showLicenses, platform }) {
  const account = await accountFromSession();
  const notices = await loadNotices();
  return (
    <>
      <header className="topbar">
        <div className="brand-nav">
          <a className="brand-plate" href={platform ? "/control" : "/devices"} aria-label="Digital Fingers">
            <Wordmark />
          </a>
          <NavLinks
            links={[
              platform ? ["/control", "Tenants"] : ["/devices", "Devices"],
              showDashboard ? ["/dashboard", "Dashboard"] : null,
              showLicenses ? ["/licenses", "Licenses"] : null,
              showAlerts ? ["/alerts", "Alerts"] : null,
              showPatches ? ["/patches", "Patches"] : null,
              showTickets ? ["/tickets", "Tickets"] : null,
              ["/audit", "Audit"],
            ].filter(Boolean)}
          />
        </div>
        {account?.user ? (
          <div className="top-tools">
            <SystemNotices items={notices.devices || []} showOrg={account.user.isPlatformAdmin === true} />
            <AccountMenu user={account.user} />
          </div>
        ) : (
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        )}
      </header>
      {notices.ribbon ? <Ribbon notice={notices.ribbon} /> : null}
    </>
  );
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
