import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { deskSettingsData, Notice } from "../desk-data";

const SAVED = {
  cannedCreate: "Canned reply added.",
  cannedUpdate: "Canned reply saved.",
  cannedDelete: "Canned reply removed.",
};

export default async function CannedRepliesPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData();
  const edit = setup.canEdit;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/canned-replies" />
        <h1><AppTitle app="service-desk">Canned Replies</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">
          Saved answers you can insert from the reply box on any ticket. These words are filled in for you:{" "}
          <code>{"{contact.name}"}</code>, <code>{"{ticket.id}"}</code> and <code>{"{agent.name}"}</code>.
          {edit ? null : " Only an owner or admin can change them."}
        </p>

        {setup.canned.length ? (
          <div className="sla-plan-list">
            {setup.canned.map((item) => (
              <details key={item.id} className="sla-plan-edit">
                <summary>
                  <strong>{item.title}</strong>
                  <span className="canned-preview">{item.body.slice(0, 80)}{item.body.length > 80 ? "…" : ""}</span>
                  {edit ? <span className="sla-plan-toggle">Edit</span> : null}
                </summary>
                {edit ? (
                  <>
                    <form className="stack desk-one" action={saveDeskSetting}>
                      <input type="hidden" name="form" value="cannedUpdate" />
                      <input type="hidden" name="id" value={item.id} />
                      <label>
                        Title
                        <input name="title" defaultValue={item.title} maxLength={80} required />
                      </label>
                      <label>
                        Reply
                        <textarea name="body" defaultValue={item.body} maxLength={4000} rows={6} required />
                      </label>
                      <button type="submit">Save Reply</button>
                    </form>
                    <form action={saveDeskSetting} className="cust-remove">
                      <input type="hidden" name="form" value="cannedDelete" />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="danger-link">Delete canned reply</button>
                    </form>
                  </>
                ) : <p className="timeline-body">{item.body}</p>}
              </details>
            ))}
          </div>
        ) : <p className="org-name">No canned replies yet.</p>}

        {edit ? (
          <section className="job desk-form">
            <h2>Add a canned reply</h2>
            <form className="stack desk-one" action={saveDeskSetting}>
              <input type="hidden" name="form" value="cannedCreate" />
              <label>
                Title
                <input name="title" maxLength={80} required placeholder="Password reset done" />
              </label>
              <label>
                Reply
                <textarea
                  name="body"
                  maxLength={4000}
                  rows={6}
                  required
                  placeholder={"Hi {contact.name},\n\nYour password has been reset. Let us know if you have any trouble signing in.\n\n{agent.name}"}
                />
              </label>
              <button type="submit">Add Reply</button>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
