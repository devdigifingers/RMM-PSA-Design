import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { deleteSlaPlan, saveSla, saveSlaPlan } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { minutesLabel } from "../../../customers/shared";
import { AppTitle } from "../../../mark";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const SAVED = {
  sla: "Default SLA targets saved.",
  plan: "SLA plan saved.",
  planRemoved: "SLA plan deleted. Its customers are back on the default targets.",
};

const PRIORITY_KEYS = ["low", "normal", "high", "urgent"];
const PRIORITY_NAMES = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

function PercentFields({ values, labels }) {
  return (
    <fieldset className="sla-wide sla-percent">
      <legend>Target by priority (% of the times above)</legend>
      {PRIORITY_KEYS.map((key) => (
        <label key={key}>
          {labels?.[key] || PRIORITY_NAMES[key]}
          <input name={`pct_${key}`} type="number" min="5" max="500" step="1" required defaultValue={values?.[key] ?? 100} />
        </label>
      ))}
    </fieldset>
  );
}

export default async function DeskSetupPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const [response, plansResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/tickets`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }),
    fetch(`${apiUrl}/v1/sla-plans`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }),
  ]);
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  const body = await response.json();
  const plans = plansResponse.ok ? (await plansResponse.json()).plans || [] : [];

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main">
        <SettingsCrumb href="/desk/settings/service-levels" />
        <h1><AppTitle app="service-desk">SLA Targets</AppTitle></h1>
        {params?.error ? <p className="error">Those SLA targets could not be saved.</p> : null}
        {params?.planError ? <p className="error">{String(params.planError)}</p> : null}
        {SAVED[params?.saved] ? <p className="org-name">{SAVED[params.saved]}</p> : null}
        <section className="job desk-form">
          <h2>Default targets</h2>
          <p className="org-name">
            Used for every customer without an SLA plan. A ticket is due when the resolve target has passed, counted in{" "}
            <a href="/desk/settings/business-hours">business hours</a> when those are on. Time in Pending does not count.
            The percentages scale both targets by priority, for example 50% makes Urgent tickets due twice as fast.
          </p>
          <form className="stack sla-form" action={saveSla}>
            <label>
              Response minutes
              <input name="responseMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.responseMinutes || ""} />
            </label>
            <label>
              Resolve minutes
              <input name="resolveMinutes" type="number" min="1" max="43200" required defaultValue={body.sla?.resolveMinutes || ""} />
            </label>
            <PercentFields values={body.sla?.priorityPercent} labels={body.priorityLabels} />
            <button type="submit">Save SLA</button>
          </form>
        </section>

        <section className="job desk-form sla-plans">
          <h2>SLA plans</h2>
          <p className="org-name">Named targets you can give a customer on its SLA / contract tab, for example Gold for contract customers. Only owners and admins can change plans.</p>
          {plans.length === 0 ? <p className="org-name">No plans yet. Every customer uses the default targets.</p> : (
            <div className="sla-plan-list">
              {plans.map((plan) => (
                <details key={plan.id} className="sla-plan-edit">
                  <summary>
                    <strong>{plan.name}</strong>
                    <span>Respond {minutesLabel(plan.responseMinutes)}</span>
                    <span>Resolve {minutesLabel(plan.resolveMinutes)}</span>
                    {plan.priorityPercent?.urgent !== 100 ? <span>Urgent {plan.priorityPercent?.urgent}%</span> : null}
                    <span>{plan.customerCount} customer{plan.customerCount === 1 ? "" : "s"}</span>
                    <span className="sla-plan-toggle">Edit</span>
                  </summary>
                  <form className="stack sla-form" action={saveSlaPlan}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <label className="sla-wide">
                      Name
                      <input name="name" required maxLength={80} defaultValue={plan.name} />
                    </label>
                    <label>
                      Response minutes
                      <input name="responseMinutes" type="number" min="1" max="43200" required defaultValue={plan.responseMinutes} />
                    </label>
                    <label>
                      Resolve minutes
                      <input name="resolveMinutes" type="number" min="1" max="43200" required defaultValue={plan.resolveMinutes} />
                    </label>
                    <PercentFields values={plan.priorityPercent} labels={body.priorityLabels} />
                    <button type="submit">Save Plan</button>
                  </form>
                  <form action={deleteSlaPlan} className="cust-remove">
                    <input type="hidden" name="planId" value={plan.id} />
                    <button type="submit" className="danger-link">
                      Delete plan{plan.customerCount ? ` (moves ${plan.customerCount} customer${plan.customerCount === 1 ? "" : "s"} to default)` : ""}
                    </button>
                  </form>
                </details>
              ))}
            </div>
          )}
          <h3>Add a plan</h3>
          <form className="stack sla-form" action={saveSlaPlan}>
            <label className="sla-wide">
              Name
              <input name="name" required maxLength={80} placeholder="Gold" />
            </label>
            <label>
              Response minutes
              <input name="responseMinutes" type="number" min="1" max="43200" required />
            </label>
            <label>
              Resolve minutes
              <input name="resolveMinutes" type="number" min="1" max="43200" required />
            </label>
            <PercentFields labels={body.priorityLabels} />
            <button type="submit">Add Plan</button>
          </form>
        </section>
      </main>
    </div>
  );
}
