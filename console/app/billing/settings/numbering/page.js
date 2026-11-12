import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { SettingsCrumb } from "../../../settings-home";
import { saveSequence } from "../../actions";
import { Notice, billingData } from "../../billing-data";

export const metadata = { title: "Numbering · Invoicing" };

export default async function NumberingPage({ searchParams }) {
  const params = await searchParams;
  const { flags, data: [setup] } = await billingData("/v1/billing/settings/numbering");
  const edit = setup.canManage;
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page bx-settings">
        <SettingsCrumb href="/billing/settings/numbering" />
        <h1><AppTitle app="billing">Numbering</AppTitle></h1>
        <Notice params={params} saved={{ numbering: "Numbering saved." }} />
        <p className="org-name">
          A number is given when a document is issued, never to a draft, so numbers run without gaps. The next number can only
          move forward, for example when you continue from another system.
        </p>
        {setup.sequences.map((seq) => (
          <section key={seq.kind} className="mfa-card">
            <h2>{seq.label} <span className="bx-preview">Next: {seq.preview}</span></h2>
            <form action={saveSequence} className="bx-grid">
              <input type="hidden" name="kind" value={seq.kind} />
              <label>Prefix<input name="prefix" defaultValue={seq.prefix} required maxLength={12} pattern="[A-Za-z0-9/_\-]+" disabled={!edit} /></label>
              <label>Digits<input name="padding" type="number" min="1" max="10" defaultValue={seq.padding} disabled={!edit} /></label>
              <label>Next number<input name="nextNumber" type="number" min={seq.nextNumber} defaultValue={seq.nextNumber} disabled={!edit} /></label>
              <label className="admin-check"><input type="checkbox" name="includeYear" defaultChecked={seq.includeYear} disabled={!edit} /> Include the year (INV-2026-0042)</label>
              {edit ? <div className="form-actions bx-span"><button type="submit">Save {seq.label.toLowerCase()}</button></div> : null}
            </form>
          </section>
        ))}
      </main>
    </div>
  );
}
