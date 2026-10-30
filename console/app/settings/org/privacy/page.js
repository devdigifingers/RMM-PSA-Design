import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";

export const metadata = { title: "Data & Privacy" };

export default async function PrivacyPage() {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/settings/org/privacy" />
        <h1>Data &amp; Privacy</h1>
        <p className="org-name">What the Digital Fingers agent collects from your devices, and how it is used. This notice supports your obligations under the Protection of Personal Information Act (POPIA).</p>
        <section className="mfa-card privacy-notice">
          <h2>Device information</h2>
          <p>The agent reports the computer name, operating system, version and build, hardware make, model and serial number, installed software and updates, CPU, memory and disk use, last boot time, signed-in user names and the agent version.</p>
          <h2>Network address and location</h2>
          <p>When a device checks in, the server records the public IP address the connection came from. The agent never reports it. The address is matched against the MaxMind GeoLite2 database kept on our own server, so it is not sent to an outside service. Only if that database is ever unavailable is the address looked up with the ip-api.com service instead, and then only the address is sent, never the device name, customer or any other detail.</p>
          <p>Location is stored at city level only: country, province, city and coordinates rounded to about 1 km. Private and unknown addresses are shown as Unknown. The lookup runs again only when a device&apos;s public address changes.</p>
          <p>A technician can set a Site / Branch for a device. When set, it replaces the GeoIP location when devices are grouped.</p>
          <h2>Who can see it</h2>
          <p>Device, location and report data belongs to your organisation. It is only shown to signed-in users of your organisation and is never shown to, or combined with, another tenant&apos;s data.</p>
          <h2>How it is used</h2>
          <p>The data is used to run the service: monitoring, patching, remote support, the Dashboard and Reports. A daily summary of counts (devices online, agent versions, operating systems, regions and patch compliance) is kept so reports can show trends.</p>
        </section>
      </main>
    </div>
  );
}
