import { redirect } from "next/navigation";
import { ConsoleBar } from "../../bar";
import { accountFromSession, navFlags } from "../../account-data";

export default async function DeploymentPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  if (account.user.isPlatformAdmin) redirect("/control");
  const manage = (account.user.roles || []).some((role) => role === "owner" || role === "admin");
  const license = account.license;
  const full = license?.deviceCap > 0 && license?.deviceCount >= license.deviceCap;

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <p className="settings-crumb"><span>Settings</span> / Unattended Access</p>
        <h1>Deployment</h1>
        <p className="org-name">Install the Digital Fingers agent on computers you look after. Each installed computer appears under Devices and can be reached at any time, without someone at the screen.</p>
        <div className="tech-seats">
          <strong>{license?.deviceCount ?? "—"}</strong> of <strong>{license?.deviceCap ?? "—"}</strong> devices enrolled
          {full ? <span className="full">Licence full</span> : null}
        </div>
        <div className="deploy-grid">
          <section className="deploy-card">
            <h2>Windows</h2>
            <p>One package for a new computer and for a computer that already has the agent. The download contains a single-use enrolment key for {account.org?.name || "your organisation"}.</p>
            <ol>
              <li>Download the package and copy it to the computer.</li>
              <li>Extract the zip and run <strong>Install</strong>.</li>
              <li>Approve the administrator prompt.</li>
              <li>The computer appears under Devices within a minute.</li>
            </ol>
            {manage && !full ? (
              <a className="deploy-download" href="/agent/windows">Download for Windows</a>
            ) : (
              <p className="error">{full ? "All devices on the licence are in use. Remove a device or add capacity first." : "Only an owner or admin can download the installer."}</p>
            )}
          </section>
          <section className="deploy-card is-soon">
            <h2>macOS <em>Soon</em></h2>
            <p>A Mac agent is not available yet.</p>
          </section>
          <section className="deploy-card is-soon">
            <h2>Linux <em>Soon</em></h2>
            <p>A Linux agent is not available yet.</p>
          </section>
        </div>
        <p className="org-name">For a one-off session without installing anything, use <a href="/support">Remote Support</a> instead.</p>
      </main>
    </div>
  );
}
