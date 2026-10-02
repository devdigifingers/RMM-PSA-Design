import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { approvePatchDeploy, createPatchPolicy } from "../actions";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const modeLabel = { approve: "Approve before deploy", auto: "Deploy without approval" };
const statusLabel = {
  waiting: "Waiting for approval",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

export default async function PatchesPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/patches`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=patch");
  const body = await response.json();
  const devices = body.devices || [];
  const deploys = body.deploys || [];
  const compliance = body.compliance || [];

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts={body.canMonitor} showPatches showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main">
        <h1>Patches</h1>
        {params?.error === "approve" ? <p className="error">That update could not be approved.</p> : null}
        {params?.error && params.error !== "approve" ? <p className="error">That policy could not be saved.</p> : null}
        {devices.length > 0 ? (
          <section className="job">
            <h2>Policy</h2>
            <form className="stack" action={createPatchPolicy}>
              <label>
                Name
                <input name="name" required maxLength={80} />
              </label>
              <label>
                Device
                <select name="deviceId" required defaultValue={devices[0].id}>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>{device.hostname}</option>
                  ))}
                </select>
              </label>
              <label>
                Policy
                <select name="mode" defaultValue="approve">
                  <option value="approve">Approve before deploy</option>
                  <option value="auto">Deploy without approval</option>
                </select>
              </label>
              <button type="submit">Save policy</button>
            </form>
          </section>
        ) : null}
        <h2>Compliance</h2>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Device</th>
              <th>Patched</th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {compliance.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>No devices yet.</td>
              </tr>
            ) : (
              compliance.flatMap((group) => group.devices.map((device) => (
                <tr key={`${group.id}-${device.hostname}`}>
                  <td>{group.name}</td>
                  <td>{device.hostname}</td>
                  <td>{device.patched.length > 0 ? device.patched.join(", ") : "None"}</td>
                  <td>{device.missing.length > 0 ? device.missing.join(", ") : "None"}</td>
                </tr>
              )))
            )}
          </tbody>
        </table>
        <h2>Deploys</h2>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Update</th>
              <th>Policy</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {deploys.length === 0 ? (
              <tr>
                <td className="empty" colSpan={5}>No patch policies yet.</td>
              </tr>
            ) : (
              deploys.map((deploy) => (
                <tr key={deploy.id}>
                  <td>{deploy.hostname}</td>
                  <td>{deploy.packageName}</td>
                  <td>{modeLabel[deploy.mode] || deploy.policyName}</td>
                  <td>
                    {statusLabel[deploy.status] || deploy.status}
                    {deploy.detail ? <div className="org-name">{deploy.detail}</div> : null}
                  </td>
                  <td>
                    {body.canOperate && deploy.status === "waiting" ? (
                      <form action={approvePatchDeploy}>
                        <input type="hidden" name="deployId" value={deploy.id} />
                        <button type="submit">Approve</button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}
