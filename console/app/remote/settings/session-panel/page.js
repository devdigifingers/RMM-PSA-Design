import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";
import { saveSessionPanel } from "../../../actions";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Session Panel" };

export default async function SessionPanelPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const jar = await cookies();
  const response = await fetch(`${apiUrl}/v1/org/session-panel`, {
    headers: {
      authorization: `Bearer ${jar.get("df_session")?.value}`,
      "x-forwarded-for": (await headers()).get("x-forwarded-for") || "",
    },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const data = response.ok ? await response.json() : null;
  const flash = params?.error ? jar.get("df_flash")?.value || "That change was not saved." : null;
  const options = data?.options;

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/remote/settings/session-panel" />
        <h1>Session Panel</h1>
        <p className="org-name">During a remote session the person at the computer sees a Digital Fingers panel on the right of their screen, with who is connected, how long the session has run, and buttons to pause or end it. It replaces the thin &ldquo;Digital Fingers Support is connected&rdquo; strip. Windows computers with agent 1.7 or later show it.</p>
        {params?.saved ? <p className="saved" role="status">Saved. Devices pick up the change within a minute.</p> : null}
        {flash ? <p className="error" role="alert">{flash}</p> : null}
        {!options ? (
          <p className="error">Only an owner or admin can change Session Panel settings.</p>
        ) : (
          <section className="mfa-card">
            <div className="tech-seats">
              <strong>{data.ready}</strong> of <strong>{data.windows}</strong> Windows devices can show the panel now
              {options.enabled ? <span>On</span> : <span className="full">Off</span>}
            </div>
            <form action={saveSessionPanel} className="panel-options">
              <label className="check">
                <input type="checkbox" name="enabled" value="1" defaultChecked={options.enabled} />
                <span><strong>Show the Session Panel instead of the connection strip</strong>
                  Devices that can&apos;t show the panel (older agent, no WebView2, or the panel failed) keep the strip, so the customer always knows a session is live.</span>
              </label>
              <label className="check">
                <input type="checkbox" name="showToTechnician" value="1" defaultChecked={options.showToTechnician} />
                <span><strong>Show the Session Panel to the technician</strong>
                  Off: the panel is hidden from the remote view (Windows 10 2004 and later) so it doesn&apos;t cover what you are working on.</span>
              </label>
              <label className="check">
                <input type="checkbox" name="silentWorkstations" value="1" defaultChecked={options.silentWorkstations} />
                <span><strong>Silent agent on workstations</strong>
                  No Digital Fingers tray icon or panel on desktops and laptops. They keep the connection strip.</span>
              </label>
              <label className="check">
                <input type="checkbox" name="silentServers" value="1" defaultChecked={options.silentServers} />
                <span><strong>Silent agent on servers</strong>
                  No tray icon or panel on Windows Server. They keep the connection strip.</span>
              </label>
              <h2 className="panel-section">Files</h2>
              <p className="panel-help">Files go through Digital Fingers, are checked against a SHA-256 hash, and are kept for 30 days so the timeline can link to them. The customer always accepts a file before it is saved, to Downloads\Digital Fingers.</p>
              <label className="check">
                <input type="checkbox" name="filesToTechnician" value="1" defaultChecked={options.filesToTechnician} />
                <span><strong>Customers can send files to the technician</strong>
                  A Send files button and drag and drop in the panel. Agent 1.9 or later.</span>
              </label>
              <label className="check">
                <input type="checkbox" name="filesToCustomer" value="1" defaultChecked={options.filesToCustomer} />
                <span><strong>Technicians can send files to the customer</strong>
                  From Files in the session window. Windows Defender scans each file before the customer can accept it.</span>
              </label>
              <div className="panel-contact">
                <label>
                  Largest file (MB)
                  <input name="fileMaxMb" type="number" min={1} max={100} step={1} defaultValue={options.fileMaxMb} required />
                </label>
                <label>
                  Programs and scripts sent to the customer
                  <select name="executables" defaultValue={options.executables}>
                    <option value="warn">Warn the customer and ask twice</option>
                    <option value="block">Don&apos;t allow</option>
                    <option value="allow">Allow without a warning</option>
                  </select>
                </label>
              </div>
              <h2 className="panel-section">Contact</h2>
              <div className="panel-contact">
                <label>
                  Support phone (shown in the tray menu)
                  <input name="phone" defaultValue={options.phone} maxLength={40} placeholder="+27 21 555 0100" autoComplete="off" />
                </label>
                <label>
                  Support email (shown in the tray menu)
                  <input name="email" type="email" defaultValue={options.email} maxLength={120} placeholder="support@example.co.za" autoComplete="off" />
                </label>
              </div>
              <button type="submit">Save</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
