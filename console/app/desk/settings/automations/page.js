import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { deskSettingsData, Notice } from "../desk-data";
import { AutomationForm } from "./automation-form";

const SAVED = {
  options: "Options saved.",
  automationCreate: "Automation added.",
  automationUpdate: "Automation saved.",
  automationDelete: "Automation removed.",
};

export default async function AutomationsPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData("/v1/desk/automation");
  const tags = await deskSettingsData();
  const edit = setup.canEdit;
  const options = setup.options;
  const lists = { users: setup.users || [], plans: setup.plans || [], customers: setup.customers || [] };

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/automations" />
        <h1><AppTitle app="service-desk">Automations</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">
          Rules run in order when a ticket is created or updated, and change the ticket for you. Changes made by a rule do not start other rules.
          Each run shows on the ticket&apos;s activity.
        </p>

        <section className="job desk-form" id="options">
          <h2>Options</h2>
          <form className="stack desk-one" action={saveDeskSetting}>
            <input type="hidden" name="form" value="options" />
            <input type="hidden" name="anchor" value="options" />
            <div className="desk-auto-close">
              <label className="check">
                <input type="checkbox" name="autoCloseOn" defaultChecked={options.autoCloseDays != null} disabled={!edit} />
                Resolve tickets left in Pending for
              </label>
              <input name="autoCloseDays" type="number" min="1" max="90" defaultValue={options.autoCloseDays ?? 7} aria-label="Days" disabled={!edit} />
              <span>days</span>
            </div>
            <label className="check">
              <input type="checkbox" name="alertTickets" defaultChecked={options.alertTickets} disabled={!edit} />
              Open a ticket automatically when a device alert fires (devices linked to a customer only)
            </label>
            <label className="check">
              <input type="checkbox" name="csatEnabled" defaultChecked={options.csatEnabled} disabled={!edit} />
              Ask customers to rate resolved tickets (Good, OK or Bad) in the resolved email
            </label>
            <p className="field-hint">
              The resolved email is only sent when replies are switched on under <a href="/desk/settings/email">Email Channel</a>.
            </p>
            <label>
              Email brand colour
              <input name="brandColor" type="color" defaultValue={options.brandColor} disabled={!edit} />
              <small className="field-hint">Used on reply emails customers receive.</small>
            </label>
            <label>
              Email signature
              <textarea name="signature" rows={3} maxLength={1000} defaultValue={options.signature} disabled={!edit} placeholder="Your company name, phone number and website" />
            </label>
            {edit ? <button type="submit">Save Options</button> : null}
          </form>
        </section>

        <datalist id="automation-categories">
          {(tags.setup.categories || []).map((item) => <option key={item.id} value={item.name} />)}
        </datalist>
        <datalist id="automation-tags">
          {(tags.setup.tags || []).map((item) => <option key={item.id} value={item.name} />)}
        </datalist>

        {setup.automations.map((rule) => (
          <section key={rule.id} className="job desk-form" id={`rule-${rule.id}`}>
            <h2>{rule.name}{rule.enabled ? null : <span className="dash-chip">Off</span>}</h2>
            <AutomationForm rule={rule} lists={lists} canEdit={edit} />
            {edit ? (
              <form action={saveDeskSetting} className="desk-inline">
                <input type="hidden" name="form" value="automationDelete" />
                <input type="hidden" name="id" value={rule.id} />
                <button type="submit" className="danger-link">Remove Automation</button>
              </form>
            ) : null}
          </section>
        ))}

        {edit ? (
          <section className="job desk-form" id="new-rule">
            <h2>New automation</h2>
            <AutomationForm lists={lists} canEdit={edit} />
          </section>
        ) : setup.automations.length ? null : <p className="org-name">No automations yet. An owner or admin can add them.</p>}
      </main>
    </div>
  );
}
