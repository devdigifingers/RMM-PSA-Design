import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { diagnosticTool } from "../../diagnostic-tools";
import { DiagnosticsView } from "../../diagnostics-view";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DiagnosticsPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const tool = diagnosticTool(typeof query?.tool === "string" ? query.tool : "overview");
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/devices`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/control");
  const body = await response.json();
  const device = (body.devices || []).find((item) => String(item.id) === String(id));
  if (!device) redirect("/devices");

  return (
    <div className="console">
      <ConsoleBar showTickets={body.canTicket} showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main diag-page">
        <DiagnosticsView
          deviceId={device.id}
          tool={tool.id}
          hostname={device.displayName || device.hostname}
          osName={device.osName || ""}
          users={device.users || []}
          canRemote={Boolean(body.canRemote)}
        />
      </main>
    </div>
  );
}
