import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { deskSettingsData, Notice } from "../desk-data";

const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const SAVED = {
  hours: "Business hours saved. SLA clocks use them from now on.",
  holidayCreate: "Holiday added.",
  holidayDelete: "Holiday removed.",
  holidaysLoad: (params) => `${Number(params.added) || 0} public holiday${Number(params.added) === 1 ? "" : "s"} added.`,
};

function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function BusinessHoursPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData();
  const edit = setup.canEdit;
  const hours = setup.businessHours.hours || {};
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }).slice(0, 4));

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/business-hours" />
        <h1><AppTitle app="service-desk">Business Hours and Holidays</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        {!edit ? <p className="org-name">Only an owner or admin can change these settings.</p> : null}

        <section className="job desk-form" id="hours">
          <h2>Business hours</h2>
          <p className="org-name">
            When business hours are on, SLA targets only count time inside these hours (South African time), and skip the holidays below.
            When they are off, SLA clocks run around the clock.
          </p>
          <form className="stack desk-one" action={saveDeskSetting}>
            <input type="hidden" name="form" value="hours" />
            <input type="hidden" name="anchor" value="hours" />
            <label className="check">
              <input type="checkbox" name="enabled" defaultChecked={setup.businessHours.enabled} disabled={!edit} />
              Use business hours for SLA targets
            </label>
            <table className="desk-hours">
              <thead>
                <tr><th scope="col">Day</th><th scope="col">Open</th><th scope="col">From</th><th scope="col">To</th></tr>
              </thead>
              <tbody>
                {DAYS.map(([key, label]) => {
                  const window = (hours[key] || [])[0];
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td><input type="checkbox" name={`${key}_on`} defaultChecked={Boolean(window)} aria-label={`Open on ${label}`} disabled={!edit} /></td>
                      <td><input type="time" name={`${key}_open`} defaultValue={window?.[0] || "08:00"} aria-label={`${label} opening time`} disabled={!edit} /></td>
                      <td><input type="time" name={`${key}_close`} defaultValue={window?.[1] || "17:00"} aria-label={`${label} closing time`} disabled={!edit} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {edit ? <button type="submit">Save Hours</button> : null}
          </form>
        </section>

        <section className="job desk-form" id="holidays">
          <h2>Holidays</h2>
          <p className="org-name">No SLA time is counted on these days while business hours are on.</p>
          {edit ? (
            <form className="desk-inline" action={saveDeskSetting}>
              <input type="hidden" name="form" value="holidaysLoad" />
              <input type="hidden" name="anchor" value="holidays" />
              <select name="year" defaultValue={year} aria-label="Year">
                {[year, year + 1].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <button type="submit">Load South African Public Holidays</button>
            </form>
          ) : null}
          {setup.holidays.length ? (
            <ul className="desk-setting-list">
              {setup.holidays.map((item) => (
                <li key={item.id}>
                  <span className="desk-holiday-day">{dayLabel(item.day)}</span>
                  <span>{item.name}</span>
                  {edit ? (
                    <form action={saveDeskSetting}>
                      <input type="hidden" name="form" value="holidayDelete" />
                      <input type="hidden" name="anchor" value="holidays" />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="danger-link">Remove</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="org-name">No holidays yet.</p>}
          {edit ? (
            <form className="desk-inline" action={saveDeskSetting}>
              <input type="hidden" name="form" value="holidayCreate" />
              <input type="hidden" name="anchor" value="holidays" />
              <input type="date" name="day" required aria-label="Holiday date" />
              <input name="name" maxLength={80} required placeholder="Office closed" aria-label="Holiday name" />
              <button type="submit">Add Holiday</button>
            </form>
          ) : null}
        </section>
      </main>
    </div>
  );
}
