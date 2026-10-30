import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { deskSettingsData, Notice } from "../desk-data";

const EVENTS = [
  ["new_ticket", "New ticket", "The ticket owner, or every owner and admin when nobody owns it."],
  ["assigned", "Ticket assigned", "The person the ticket was assigned to."],
  ["customer_reply", "Customer replied", "The ticket owner, or every owner and admin."],
  ["sla_warning", "SLA due soon", "Sent once when less than a quarter of a target is left."],
  ["sla_breach", "SLA breached", "Sent once when a target is missed."],
];
const SAVED = { rules: "Notification rules saved." };

export default async function NotificationRulesPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData();
  const edit = setup.canEdit;
  const custom = Object.values(setup.rules).some((rule) => rule.custom);

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/notifications" />
        <h1><AppTitle app="service-desk">Notification Rules</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">
          Choose who hears about ticket events. In-app notifications show under the bell at the top of the console. Nobody is told about their own changes.
          {custom ? null : " Until you save these rules, email only goes to the Digital Fingers support inbox."}
        </p>
        <section className="job desk-form">
          <form className="stack desk-one" action={saveDeskSetting}>
            <input type="hidden" name="form" value="rules" />
            <table className="desk-rules">
              <thead>
                <tr><th scope="col">Event</th><th scope="col">Who</th><th scope="col">In app</th><th scope="col">Email</th></tr>
              </thead>
              <tbody>
                {EVENTS.map(([key, label, who]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td>{who}</td>
                    <td><input type="checkbox" name={`${key}_inApp`} defaultChecked={setup.rules[key]?.inApp} aria-label={`${label} in app`} disabled={!edit} /></td>
                    <td><input type="checkbox" name={`${key}_email`} defaultChecked={setup.rules[key]?.email} aria-label={`${label} by email`} disabled={!edit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {edit ? <button type="submit">Save Rules</button> : <p className="org-name">Only an owner or admin can change these rules.</p>}
          </form>
        </section>
      </main>
    </div>
  );
}
