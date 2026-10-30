import { saveDeskSetting } from "../../../actions";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { AppTitle } from "../../../mark";
import { formatWhen } from "../../../tickets/format";
import { deskSettingsData, Notice } from "../desk-data";

const SAVED = {
  mailbox: "Mailbox settings saved.",
  mailboxTest: (params) => `Connected to the mailbox.${params.messages != null ? ` ${params.messages} messages in the folder.` : ""}`,
  mailboxDelete: "Mailbox removed. Email is no longer read.",
};

export default async function EmailChannelPage({ searchParams }) {
  const params = await searchParams;
  const { flags, setup } = await deskSettingsData("/v1/desk/mailbox");
  const edit = setup.canEdit;
  const box = setup.mailbox;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main desk-settings">
        <SettingsCrumb href="/desk/settings/email" />
        <h1><AppTitle app="service-desk">Email Channel</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">
          Connect your support mailbox and every new email becomes a ticket. Replies to a ticket email are added to the same ticket and reopen it
          when it was pending or resolved. Out-of-office and other automatic emails are ignored.
        </p>

        {box ? (
          <section className="job desk-form">
            <h2>Status</h2>
            <dl className="desk-mailbox-status">
              <div><dt>Reading mail</dt><dd>{box.enabled ? "On, checked every 2 minutes" : "Off"}</dd></div>
              <div><dt>Last checked</dt><dd>{box.lastPolledAt ? formatWhen(box.lastPolledAt) : "Not yet"}</dd></div>
              <div><dt>Emails turned into tickets or replies</dt><dd>{box.messagesIn}</dd></div>
            </dl>
            {box.lastError ? <p className="error">{box.lastError}</p> : null}
            {edit ? (
              <form action={saveDeskSetting} className="desk-inline">
                <input type="hidden" name="form" value="mailboxTest" />
                <button type="submit">Test Connection</button>
              </form>
            ) : null}
          </section>
        ) : null}

        <section className="job desk-form">
          <h2>Mailbox</h2>
          <form className="stack" action={saveDeskSetting}>
            <input type="hidden" name="form" value="mailbox" />
            <label>
              Support address
              <input name="address" type="email" defaultValue={box?.address || ""} placeholder="support@yourcompany.co.za" required disabled={!edit} />
              <small className="field-hint">Customers write to this address. Replies from the console ask customers to reply here.</small>
            </label>
            <label>
              Default customer
              <select name="defaultCustomerId" defaultValue={box?.defaultCustomerId || ""} disabled={!edit}>
                <option value="">Choose a customer</option>
                {(setup.customers || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <small className="field-hint">Used when the sender is not a contact and their email domain does not match one customer.</small>
            </label>
            <label>
              IMAP server
              <input name="host" defaultValue={box?.host || ""} placeholder="outlook.office365.com" required disabled={!edit} />
            </label>
            <label>
              Port
              <input name="port" type="number" min="1" max="65535" defaultValue={box?.port || 993} disabled={!edit} />
            </label>
            <label>
              Sign-in name
              <input name="username" defaultValue={box?.username || ""} autoComplete="off" required disabled={!edit} />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" placeholder={box?.hasPassword ? "Saved. Leave empty to keep it." : ""} disabled={!edit} />
              <small className="field-hint">Many providers need an app password. It is stored encrypted and never shown again.</small>
            </label>
            <label>
              Folder
              <input name="folder" defaultValue={box?.folder || "INBOX"} disabled={!edit} />
            </label>
            <label className="check">
              <input type="checkbox" name="secure" defaultChecked={box ? box.secure : true} disabled={!edit} />
              Use SSL/TLS (port 993)
            </label>
            <fieldset className="desk-toggles">
              <legend>What to do</legend>
              <label className="check">
                <input type="checkbox" name="enabled" defaultChecked={box?.enabled} disabled={!edit} />
                Read this mailbox and create tickets
              </label>
              <label className="check">
                <input type="checkbox" name="sendReplies" defaultChecked={box?.sendReplies} disabled={!edit} />
                Email console replies and a resolved notice to the ticket contact (internal notes are never sent)
              </label>
              <label className="check">
                <input type="checkbox" name="acknowledge" defaultChecked={box?.acknowledge} disabled={!edit} />
                Send an automatic &quot;we received your request&quot; email for new tickets
              </label>
            </fieldset>
            {edit ? <button type="submit">Save Mailbox</button> : <p className="org-name">Only an owner or admin can change the mailbox.</p>}
          </form>
          <p className="org-name">
            The first check starts from the newest email, so mail already in the folder is not imported.
          </p>
        </section>

        {box && edit ? (
          <section className="job desk-form">
            <h2>Remove</h2>
            <form action={saveDeskSetting} className="desk-inline">
              <input type="hidden" name="form" value="mailboxDelete" />
              <button type="submit" className="danger-link">Remove Mailbox</button>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
