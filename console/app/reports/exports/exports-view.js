"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteReportSubscription, scheduleExport, sendReportNow, stopExportSchedule } from "../../actions";
import { ScheduleDialog } from "../report-view";

const dateTime = (value) => new Date(value).toLocaleString("en-ZA", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg",
});
const day = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATUS = { sent: ["Sent", "green"], failed: ["Failed", "red"], skipped: ["Skipped", "amber"] };

export function ExportsView({ reports, customers, subscriptions, deliveries, schedule, canManage }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [, startTransition] = useTransition();

  async function run(key, action, success, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy("");
    setMessage(result.ok ? { tone: "ok", text: success } : { tone: "error", text: result.error });
    startTransition(() => router.refresh());
  }

  return (
    <>
      {message ? <p className={message.tone === "ok" ? "patch-done" : "error"} role="status">{message.text}</p> : null}

      <section className="dx-card rx-table-card">
        <header>
          <h2>Monthly emailed reports</h2>
          {canManage ? <button type="button" className="rx-button is-primary" onClick={() => setAdding(true)}>Add scheduled report</button> : null}
        </header>
        <p className="dx-note">Each report is emailed as a PDF at 07:00 on the 1st of the month and covers the month before.</p>
        {subscriptions.length === 0 ? (
          <p className="rx-empty">No reports are scheduled yet. Open any report and choose Schedule, or add one here.</p>
        ) : (
          <div className="rx-table-wrap">
            <table className="rx-table">
              <thead>
                <tr>
                  <th scope="col">Report</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Sent to</th>
                  <th scope="col">Next send</th>
                  {canManage ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id}>
                    <td><a href={`/reports/${sub.report}${sub.customerId ? `?customer=${sub.customerId}` : ""}`}>{sub.reportTitle}</a></td>
                    <td>{sub.customerName}</td>
                    <td>{sub.contactName ? `${sub.contactName} (${sub.email})` : sub.email}</td>
                    <td>{dateTime(sub.nextRunAt)}</td>
                    {canManage ? (
                      <td className="rx-row-actions">
                        <button
                          type="button"
                          className="rx-button"
                          disabled={Boolean(busy)}
                          onClick={() => run(`send-${sub.id}`, () => sendReportNow(sub.id), `Last month's ${sub.reportTitle} was sent to ${sub.email}.`, `Email last month's ${sub.reportTitle} to ${sub.email} now?`)}
                        >
                          {busy === `send-${sub.id}` ? "Sending…" : "Send now"}
                        </button>
                        <button
                          type="button"
                          className="rx-button is-danger"
                          disabled={Boolean(busy)}
                          onClick={() => run(`del-${sub.id}`, () => deleteReportSubscription(sub.id), "Scheduled report removed.", `Stop emailing ${sub.reportTitle} to ${sub.email}?`)}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dx-card rx-table-card">
        <header><h2>Delivery log</h2>{deliveries.length ? <span className="rx-count">{deliveries.length}</span> : null}</header>
        {deliveries.length === 0 ? <p className="rx-empty">Nothing has been sent yet.</p> : (
          <div className="rx-table-wrap">
            <table className="rx-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Report</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Period</th>
                  <th scope="col">Sent to</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((item) => {
                  const [label, tone] = STATUS[item.status] || [item.status, ""];
                  return (
                    <tr key={item.id}>
                      <td>{dateTime(item.createdAt)}</td>
                      <td>{item.reportTitle}</td>
                      <td>{item.customerName}</td>
                      <td>{`${day(item.from)} – ${day(item.to)}`}</td>
                      <td>{item.email}</td>
                      <td>
                        <span className={`rx-status ${tone}`}>{label}</span>
                        {item.detail ? <span className="rx-detail">{item.detail}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dx-card rx-table-card">
        <header>
          <h2>Fleet CSV export</h2>
          {schedule?.latest ? <a className="rx-button" href="/dashboard/export" download>Download latest CSV</a> : null}
        </header>
        {schedule ? (
          <>
            <p className="dx-note">
              {schedule.intervalMinutes === 1440
                ? `A CSV of your fleet is produced once a day.${schedule.latest ? ` Next file in ${schedule.nextInHours} hours.` : " No file yet."}`
                : `A CSV of your fleet is produced every ${schedule.intervalMinutes} ${schedule.intervalMinutes === 1 ? "minute" : "minutes"}.${schedule.latest ? "" : " No file yet."}`}
              {schedule.latest ? ` Last file (${dateTime(schedule.latest.producedAt)}): ${schedule.latest.deviceCount} devices, ${schedule.latest.openTicketCount} open tickets, ${schedule.latest.missingCount} missing patches.` : ""}
            </p>
            {canManage ? (
              <button
                type="button"
                className="rx-button is-danger"
                disabled={Boolean(busy)}
                onClick={() => run("stop", stopExportSchedule, "CSV export stopped.", "Stop the CSV export? Past files are deleted.")}
              >
                Stop CSV export
              </button>
            ) : null}
          </>
        ) : canManage ? (
          <form className="dash-form" action={scheduleExport}>
            <label>
              Every minutes
              <input name="intervalMinutes" type="number" min={1} max={1440} defaultValue={1440} required />
            </label>
            <button type="submit">Schedule export</button>
          </form>
        ) : (
          <p className="rx-empty">No CSV export is scheduled.</p>
        )}
      </section>

      {adding ? (
        <ScheduleDialog
          reports={reports}
          customers={customers}
          customer=""
          onClose={() => setAdding(false)}
          onDone={() => startTransition(() => router.refresh())}
        />
      ) : null}
    </>
  );
}
