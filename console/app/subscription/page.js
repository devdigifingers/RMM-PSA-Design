import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, formatWhen, included, licenseStatus, navFlags } from "../account-data";
import { Facts } from "../facts";

const CHANGE_EMAIL = "admin@digitalfingers.co.za";

export default async function SubscriptionPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  const license = account.license;
  const status = licenseStatus(license);
  const orgName = account.org?.name || "This organisation";
  const subject = license ? `License change for ${orgName} (license ${license.number})` : "";
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main subscription">
        <h1>Manage Subscription</h1>
        {license ? (
          <>
            <div className="sub-head">
              <p className="org-name">{orgName} · {titlePlan(license.plan)} · License {license.number}</p>
              <a className="sub-change" href={`mailto:${CHANGE_EMAIL}?subject=${encodeURIComponent(subject)}`}>Request a change</a>
            </div>
            {status.warnings.map((item) => (
              <p key={item.text} className={`sub-warning is-${item.level}`}>{item.text}</p>
            ))}
            <section className="sub-meters">
              <Meter label="Seats" meter={status.seats} note="People who can sign in to this organisation." />
              <Meter label="Devices" meter={status.devices} note="Computers enrolled for monitoring and support." />
              <div className="sub-meter">
                <p>Expires</p>
                <strong>{license.expiresAt ? formatWhen(license.expiresAt) : "No expiry date"}</strong>
                <small>
                  {status.daysLeft == null ? "This license does not expire." : status.daysLeft > 0 ? `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left.` : "Renew it with Digital Fingers."}
                </small>
              </div>
            </section>
            <h2>What is included</h2>
            <Facts rows={[
              { label: "Remote sessions", value: included(license.remoteDesktop) },
              {
                label: "Remote support",
                value: license.remoteSupport
                  ? `Included, ${license.supportConcurrent} session${license.supportConcurrent === 1 ? "" : "s"} at a time`
                  : included(false),
              },
              { label: "Ticketing", value: included(license.ticketing) },
              { label: "Monitoring", value: included(license.monitoring) },
              { label: "Patching", value: included(license.patch) },
              { label: "Reporting", value: included(license.reporting) },
            ]} />
            <p className="org-name">Changes to the license are made by Digital Fingers. Use Request a change, or email {CHANGE_EMAIL}.</p>
          </>
        ) : (
          <p className="org-name">
            {account.user.isPlatformAdmin
              ? <>Licenses are assigned from the <a href="/control">control panel</a>.</>
              : "This account does not have a license yet."}
          </p>
        )}
      </main>
    </div>
  );
}

function Meter({ label, meter, note }) {
  return (
    <div className={`sub-meter is-${meter.level}`}>
      <p>{label}</p>
      <strong>{meter.used} <span>of {meter.total}</span></strong>
      <div className="sub-bar"><i className={meter.percent > 0 ? "has-value" : undefined} style={{ width: `${meter.percent}%` }} /></div>
      <small>{note}</small>
    </div>
  );
}

function titlePlan(plan) {
  const text = String(plan || "").replace(/[-_]/g, " ");
  if (!text) return "License";
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}
