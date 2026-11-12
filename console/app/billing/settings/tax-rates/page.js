import { ConsoleBar } from "../../../bar";
import { AppTitle } from "../../../mark";
import { SettingsCrumb } from "../../../settings-home";
import { saveTaxRate } from "../../actions";
import { Notice, billingData, shortDate } from "../../billing-data";

export const metadata = { title: "Tax rates · Invoicing" };

export default async function TaxRatesPage({ searchParams }) {
  const params = await searchParams;
  const { flags, data: [setup] } = await billingData("/v1/billing/settings/tax-rates");
  const edit = setup.canManage;
  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page bx-settings">
        <SettingsCrumb href="/billing/settings/tax-rates" />
        <h1><AppTitle app="billing">Tax rates</AppTitle></h1>
        <Notice params={params} saved={{ rate: "Account code saved." }} />
        <p className="org-name">
          The standard rate is kept with its effective dates, so each document uses the rate in force on its issue date.
          {setup.vat.registered
            ? " You are VAT registered: lines can be Standard, Zero-rated or Exempt."
            : " You are not VAT registered, so every line uses No VAT. The other rates become available from your VAT effective date."}
        </p>
        <section className="mfa-card">
          <div className="tech-table">
            <table>
              <thead><tr><th>Rate</th><th>Type</th><th className="r">Rate</th><th>In force</th><th>SARS code</th><th>Account code</th></tr></thead>
              <tbody>
                {setup.rates.map((rate) => (
                  <tr key={rate.id}>
                    <td className="tech-name">{rate.name}{rate.current ? null : <span className="token-by">Historical</span>}</td>
                    <td>{rate.typeLabel}</td>
                    <td className="r tech-nowrap">{(rate.rateBp / 100).toLocaleString("en-ZA")}%</td>
                    <td className="tech-nowrap">{rate.type === "standard" ? `${shortDate(rate.effectiveFrom)} – ${rate.effectiveTo ? shortDate(rate.effectiveTo) : "now"}` : "Always"}</td>
                    <td>{rate.sarsCode || "—"}</td>
                    <td>
                      <form action={saveTaxRate} className="bx-inline">
                        <input type="hidden" name="id" value={rate.id} />
                        <input name="accountCode" defaultValue={rate.accountCode} maxLength={40} aria-label={`Account code for ${rate.name}`} disabled={!edit} />
                        {edit ? <button type="submit" className="link-button">Save</button> : null}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
