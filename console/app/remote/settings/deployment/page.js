import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DeploymentPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  if (account.user.isPlatformAdmin) redirect("/control");
  const manage = (account.user.roles || []).some((role) => role === "owner" || role === "admin");
  const license = account.license;
  const full = license?.deviceCap > 0 && license?.deviceCount >= license.deviceCap;
  const accounts = manage && license?.ticketing === true ? await loadAccounts() : [];

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/remote/settings/deployment" />
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
              <form className="deploy-form" method="get" action="/agent/windows">
                {accounts.length ? (
                  <label>
                    Account
                    <select name="customer" defaultValue="">
                      <option value="">No account yet</option>
                      {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <button type="submit" className="deploy-download">Download for Windows</button>
              </form>
            ) : (
              <p className="error">{full ? "All devices on the licence are in use. Remove a device or add capacity first." : "Only an owner or admin can download the installer."}</p>
            )}
          </section>
          <section className="deploy-card is-soon">
            <h2>macOS <em>Soon</em></h2>
            <p>A Mac agent is not available yet.</p>
          </section>
          <section className="deploy-card">
            <h2>Linux</h2>
            <p>Ubuntu, Debian, Fedora, CentOS Stream, Rocky Linux and AlmaLinux on 64-bit Intel, AMD or ARM. The download contains a single-use enrolment key.</p>
            <ol>
              <li>Copy the download to the computer.</li>
              <li>Run <code>tar xzf DigitalFingersAgent-linux.tar.gz</code> and <code>cd DigitalFingersAgent</code>.</li>
              <li>Run <code>sudo ./install.sh</code>.</li>
              <li>The computer appears under Devices within a minute.</li>
            </ol>
            {manage && !full ? (
              <form className="deploy-form" method="get" action="/agent/linux">
                {accounts.length ? (
                  <label>
                    Account
                    <select name="customer" defaultValue="">
                      <option value="">No account yet</option>
                      {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <button type="submit" className="deploy-download">Download for Linux</button>
              </form>
            ) : null}
          </section>
        </div>
        <p className="org-name">For a one-off session without installing anything, use <a href="/support">Remote Support</a> instead.</p>
      </main>
    </div>
  );
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
