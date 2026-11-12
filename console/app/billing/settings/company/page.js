import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { SettingsCrumb } from "../../../settings-home";
import { addVatRecord, removeVatRecord, saveCompany } from "../../actions";
import { Notice, TEMPLATE_LABELS, billingData, shortDate } from "../../billing-data";
import { LogoUpload } from "./logo-upload";

export const metadata = { title: "Company and tax · Invoicing" };

const SAVED = {
  company: "Company and tax details saved.",
  vat: "VAT change recorded. Documents already issued stay as they were.",
  vatRemoved: "Scheduled VAT change removed.",
};

export default async function CompanyPage({ searchParams }) {
  const params = await searchParams;
  const { flags, data: [setup, logo] } = await billingData("/v1/billing/settings/company", "/v1/billing/settings/logo");
  const s = setup.settings;
  const bank = s.bank || {};
  const edit = setup.canManage;
  const upcoming = setup.vatHistory.filter((entry) => entry.effectiveFrom > setup.today);

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page bx-settings">
        <SettingsCrumb href="/billing/settings/company" />
        <h1><AppTitle app="billing">Company and tax</AppTitle></h1>
        <Notice params={params} saved={SAVED} />
        <p className="org-name">
          These details print on every quote, invoice and credit note, and are frozen onto each document when it is issued.
          {edit ? null : " Only an owner or admin can change them."}
        </p>

        <section className="mfa-card" id="vat">
          <h2>VAT registration</h2>
          <p className="bx-vat-now">
            Today: <strong>{setup.vat.registered ? `VAT registered (${setup.vat.vatNumber})` : "Not VAT registered"}</strong>.{" "}
            {setup.vat.registered
              ? "Invoices are titled Tax Invoice and show VAT."
              : "Invoices are titled Invoice, with no VAT column, VAT totals or VAT number, and no line can charge VAT."}
          </p>
          {upcoming.length ? (
            <p className="org-name">Scheduled: {upcoming.map((entry) => `${entry.registered ? "VAT registered" : "Not registered"} from ${shortDate(entry.effectiveFrom)}`).join("; ")}.</p>
          ) : null}
          {setup.vatHistory.length ? (
            <div className="tech-table">
              <table>
                <thead><tr><th>From</th><th>Status</th><th>VAT number</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {setup.vatHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td className="tech-nowrap">{shortDate(entry.effectiveFrom)}</td>
                      <td>{entry.registered ? "VAT registered" : "Not registered"}</td>
                      <td className="tech-nowrap">{entry.vatNumber || "—"}</td>
                      <td>
                        {edit && entry.effectiveFrom > setup.today ? (
                          <form action={removeVatRecord}>
                            <input type="hidden" name="id" value={entry.id} />
                            <button type="submit" className="link-button">Remove</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="org-name">No VAT registration recorded, so you are treated as not VAT registered.</p>}
          {edit ? (
            <form action={addVatRecord} className="stack bx-vat-form">
              <h3>Record a change</h3>
              <fieldset className="bx-radios">
                <legend>VAT registered</legend>
                <label><input type="radio" name="vatRegistered" value="yes" defaultChecked={!setup.vat.registered} /> Yes</label>
                <label><input type="radio" name="vatRegistered" value="no" defaultChecked={setup.vat.registered} /> No</label>
              </fieldset>
              <label>
                VAT number
                <input name="vatNumber" inputMode="numeric" placeholder="4xxxxxxxxx" maxLength={14} />
                <small className="field-hint">10 digits starting with 4. Leave empty when not registered.</small>
              </label>
              <label>
                Takes effect on
                <input name="effectiveFrom" type="date" defaultValue={setup.today} required />
                <small className="field-hint">New documents issued on or after this date follow it. Issued documents never change.</small>
              </label>
              <div className="form-actions"><button type="submit">Record VAT change</button></div>
            </form>
          ) : null}
        </section>

        <section className="mfa-card" id="logo">
          <h2>Logo</h2>
          <LogoUpload logo={logo.logo} canManage={edit} />
        </section>

        <form action={saveCompany} className="stack">
          <section className="mfa-card">
            <h2>Company</h2>
            <div className="bx-grid">
              <label>Registered name<input name="legalName" defaultValue={s.legalName} required maxLength={160} disabled={!edit} /></label>
              <label>Trading name<input name="tradingName" defaultValue={s.tradingName} maxLength={160} disabled={!edit} /></label>
              <label>Company registration number<input name="companyRegNo" defaultValue={s.companyRegNo} maxLength={40} disabled={!edit} /></label>
              <label>Billing email<input name="email" type="email" defaultValue={s.email} maxLength={200} disabled={!edit} /></label>
              <label>Phone<input name="phone" defaultValue={s.phone} maxLength={40} disabled={!edit} /></label>
              <label>Website<input name="website" defaultValue={s.website} maxLength={160} disabled={!edit} /></label>
              <label className="bx-span">Physical address<textarea name="physicalAddress" rows={3} defaultValue={s.physicalAddress} required maxLength={400} disabled={!edit} /></label>
              <label className="bx-span">Postal address<textarea name="postalAddress" rows={2} defaultValue={s.postalAddress} maxLength={400} disabled={!edit} placeholder="Leave empty when it is the same as the physical address" /></label>
              <label>B-BBEE level<input name="bbbeeLevel" defaultValue={s.bbbeeLevel} maxLength={40} disabled={!edit} placeholder="Optional" /></label>
              <label>CSD number<input name="csdNumber" defaultValue={s.csdNumber} maxLength={40} disabled={!edit} placeholder="Optional" /></label>
            </div>
          </section>

          <section className="mfa-card" id="bank">
            <h2>Bank details (EFT)</h2>
            <p className="org-name">Printed in the &ldquo;How to pay&rdquo; block, with the invoice number as the payment reference.</p>
            <div className="bx-grid">
              <label>Bank<input name="bankName" defaultValue={bank.bankName || ""} maxLength={80} disabled={!edit} /></label>
              <label>Account holder<input name="accountName" defaultValue={bank.accountName || ""} maxLength={160} disabled={!edit} /></label>
              <label>Account number<input name="accountNumber" defaultValue={bank.accountNumber || ""} maxLength={30} disabled={!edit} /></label>
              <label>Branch code<input name="branchCode" defaultValue={bank.branchCode || ""} maxLength={20} disabled={!edit} /></label>
              <label>Account type<input name="accountType" defaultValue={bank.accountType || ""} maxLength={40} disabled={!edit} /></label>
              <label>BIC / SWIFT<input name="swift" defaultValue={bank.swift || ""} maxLength={20} disabled={!edit} /></label>
            </div>
          </section>

          <section className="mfa-card">
            <h2>Defaults</h2>
            <div className="bx-grid">
              <label>Payment terms (days)<input name="defaultTermsDays" type="number" min="0" max="365" defaultValue={s.defaultTermsDays} disabled={!edit} /></label>
              <label>
                Prices are entered
                <select name="priceMode" defaultValue={s.priceMode} disabled={!edit}>
                  <option value="excl">Excluding VAT</option>
                  <option value="incl">Including VAT</option>
                </select>
              </label>
              <label>
                Template
                <select name="defaultTemplate" defaultValue={s.defaultTemplate} disabled={!edit}>
                  {setup.templates.map((key) => <option key={key} value={key}>{TEMPLATE_LABELS[key]}</option>)}
                </select>
              </label>
              <label>Online links expire after (days)<input name="linkExpiryDays" type="number" min="1" max="3650" defaultValue={s.linkExpiryDays} disabled={!edit} /></label>
              <label>Primary colour<input name="primaryColour" type="color" defaultValue={s.primaryColour} disabled={!edit} /></label>
              <label>Secondary colour<input name="secondaryColour" type="color" defaultValue={s.secondaryColour} disabled={!edit} /></label>
              <label className="admin-check bx-span"><input type="checkbox" name="attachPdf" defaultChecked={s.attachPdf} disabled={!edit} /> Attach the PDF to invoice emails</label>
              <label className="bx-span">Default notes<textarea name="defaultNotes" rows={2} defaultValue={s.defaultNotes} maxLength={2000} disabled={!edit} /></label>
              <label className="bx-span">Default terms<textarea name="defaultTermsText" rows={3} defaultValue={s.defaultTermsText} maxLength={4000} disabled={!edit} /></label>
            </div>
          </section>
          {edit ? <div className="form-actions"><button type="submit">Save company details</button></div> : null}
        </form>
      </main>
    </div>
  );
}
