import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function AuditPage() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/audit`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const body = await response.json();
  const events = body.events || [];

  return (
    <div className="console">
      <ConsoleBar
        showTickets={body.canTicket}
        showAlerts={body.canMonitor}
        showPatches={body.canPatch}
        showDashboard={body.canReport}
        showLicenses={body.canReport}
      />
      <main className="main">
        <h1>Audit</h1>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Ticket</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>No audit events yet.</td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td>{formatWhen(event.createdAt)}</td>
                  <td>{event.action}</td>
                  <td>{event.ticketSubject || "—"}</td>
                  <td>{event.actorEmail || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function formatWhen(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
