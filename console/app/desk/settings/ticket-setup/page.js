import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { deskSettingsData, Notice } from "../desk-data";

const SAVED = {
  statusCreate: "Status added.",
  statusUpdate: "Status saved.",
  statusDelete: "Status removed. Its tickets keep their Open, Pending or Resolved state.",
  priorities: "Priority labels saved.",
  categoryCreate: "Category added.",
  categoryDelete: "Category removed. Tickets that use it keep it.",
  tagCreate: "Tag added.",
  tagDelete: "Tag removed from the suggestions. Tickets that use it keep it.",
};
const BASES = [["open", "Open"], ["pending", "Pending (SLA paused)"], ["resolved", "Resolved"]];
const PRIORITY_KEYS = ["low", "normal", "high", "urgent"];

function Hidden({ form, anchor, id }) {
  return (
    <>
      <input type="hidden" name="form" value={form} />
      <input type="hidden" name="anchor" value={anchor} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  );
}

export default async function TicketSetupPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData();
  const edit = setup.canEdit;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/ticket-setup#statuses" />
        <h1><AppTitle app="service-desk">Ticket Setup</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        {!edit ? <p className="org-name">Only an owner or admin can change these settings.</p> : null}

        <section className="job desk-form" id="statuses">
          <h2>Statuses</h2>
          <p className="org-name">
            Open, Pending and Resolved are always there. Add your own, such as &quot;Waiting on supplier&quot;, and choose which of the three it counts as.
            Statuses that count as Pending pause the SLA clock.
          </p>
          {setup.statuses.length ? (
            <ul className="desk-setting-list">
              {setup.statuses.map((status) => (
                <li key={status.id}>
                  <form className="desk-inline" action={saveDeskSetting}>
                    <Hidden form="statusUpdate" anchor="statuses" id={status.id} />
                    <input name="name" defaultValue={status.name} maxLength={40} required aria-label="Status name" disabled={!edit} />
                    <select name="base" defaultValue={status.base} aria-label="Counts as" disabled={!edit}>
                      {BASES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input name="position" type="number" min="0" max="999" defaultValue={status.position} aria-label="Order" className="desk-order" disabled={!edit} />
                    {edit ? <button type="submit">Save</button> : null}
                  </form>
                  {edit ? (
                    <form action={saveDeskSetting}>
                      <Hidden form="statusDelete" anchor="statuses" id={status.id} />
                      <button type="submit" className="danger-link">Remove</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="org-name">No custom statuses yet.</p>}
          {edit ? (
            <form className="desk-inline" action={saveDeskSetting}>
              <Hidden form="statusCreate" anchor="statuses" />
              <input name="name" maxLength={40} required placeholder="Waiting on supplier" aria-label="New status name" />
              <select name="base" defaultValue="pending" aria-label="Counts as">
                {BASES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button type="submit">Add Status</button>
            </form>
          ) : null}
        </section>

        <section className="job desk-form" id="priorities">
          <h2>Priorities</h2>
          <p className="org-name">There are always four priorities. You can rename them; SLA percentages per priority are on <a href="/desk/settings/service-levels">SLA Targets</a>.</p>
          <form className="stack sla-form" action={saveDeskSetting}>
            <Hidden form="priorities" anchor="priorities" />
            {PRIORITY_KEYS.map((key) => (
              <label key={key}>
                {key[0].toUpperCase() + key.slice(1)}
                <input name={`label_${key}`} defaultValue={setup.priorityLabels[key]} maxLength={30} required disabled={!edit} />
              </label>
            ))}
            {edit ? <button type="submit">Save Labels</button> : null}
          </form>
        </section>

        <NameList
          id="categories"
          title="Categories"
          hint="Suggested on new tickets and in the ticket details. Anyone can still type a new one."
          items={setup.categories}
          create="categoryCreate"
          remove="categoryDelete"
          max={60}
          placeholder="Network"
          edit={edit}
        />
        <NameList
          id="tags"
          title="Tags"
          hint="Suggested when tagging tickets. Removing one here does not remove it from tickets."
          items={setup.tags}
          create="tagCreate"
          remove="tagDelete"
          max={30}
          placeholder="VIP"
          edit={edit}
        />
      </main>
    </div>
  );
}

function NameList({ id, title, hint, items, create, remove, max, placeholder, edit }) {
  return (
    <section className="job desk-form" id={id}>
      <h2>{title}</h2>
      <p className="org-name">{hint}</p>
      {items.length ? (
        <ul className="desk-chips">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>
              {edit ? (
                <form action={saveDeskSetting}>
                  <Hidden form={remove} anchor={id} id={item.id} />
                  <button type="submit" className="danger-link" aria-label={`Remove ${item.name}`}>×</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="org-name">None yet.</p>}
      {edit ? (
        <form className="desk-inline" action={saveDeskSetting}>
          <Hidden form={create} anchor={id} />
          <input name="name" maxLength={max} required placeholder={placeholder} aria-label={`New ${title.toLowerCase()}`} />
          <button type="submit">Add</button>
        </form>
      ) : null}
    </section>
  );
}
