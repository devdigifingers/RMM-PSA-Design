import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { saveSla } from "../../actions";
import { ConsoleBar } from "../../bar";
import { AppTitle } from "../../mark";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function DeskSetupPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/tickets`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  const body = await response.json();

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <p className="desk-back"><a href="/tickets">← All Tickets</a></p>
        <h1><AppTitle app="service-desk">SLA Targets</AppTitle></h1>
        {params?.error ? <p className="error">Those SLA targets could not be saved.</p> : null}
        {params?.saved ? <p className="org-name">SLA targets saved.</p> : null}
        <section className="job desk-form">
          <p className="org-name">Due dates on the ticket list are the creation time plus the resolve target. Accounts and contacts are under <a href="/customers">Customers</a>.</p>
          <form className="stack" action={saveSla}>
            <label>
              Response minutes
              <input name="responseMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.responseMinutes || ""} />
            </label>
            <label>
              Resolve minutes
              <input name="resolveMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.resolveMinutes || ""} />
            </label>
            <button type="submit">Save SLA</button>
          </form>
        </section>
      </main>
    </div>
  );
}
