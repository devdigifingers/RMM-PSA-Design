"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createReportSubscription, reportContacts } from "../actions";
import { Bars, TimeChart, toneColor } from "../charts";

function localToday() {
  return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
}

function shift(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function presets() {
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastEnd = shift(monthStart, -1);
  return [
    { key: "7", label: "7 days", from: shift(today, -6), to: today },
    { key: "30", label: "30 days", from: shift(today, -29), to: today },
    { key: "90", label: "90 days", from: shift(today, -89), to: today },
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last", label: "Last month", from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd },
  ];
}

export function ReportView({ report, customers, customer, canManage }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [scheduling, setScheduling] = useState(false);
  const ranges = useMemo(presets, []);

  function go(changes) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    startTransition(() => router.push(text ? `?${text}` : "?", { scroll: false }));
  }

  const fileQuery = (format) => {
    const next = new URLSearchParams(params.toString());
    next.set("format", format);
    return `/reports/file/${report.key}?${next.toString()}`;
  };
  const activePreset = ranges.find((range) => range.from === report.from && range.to === report.to)?.key || "";
  const deviceLink = (id) => (id ? `/devices/${id}/diagnostics` : null);

  return (
    <div className={pending ? "rx-report is-loading" : "rx-report"} aria-busy={pending}>
      <div className="dx-head">
        <div>
          <p className="rx-crumb"><a href="/reports">Reports</a></p>
          <h1>{report.title}</h1>
          <p className="rx-lead">{report.description}</p>
        </div>
        <div className="rx-actions">
          <a className="rx-button" href={fileQuery("csv")} download>Download CSV</a>
          <a className="rx-button" href={fileQuery("pdf")} download>Download PDF</a>
          {canManage ? <button type="button" className="rx-button is-primary" onClick={() => setScheduling(true)}>Schedule</button> : null}
        </div>
      </div>

      <div className="rx-filters" role="group" aria-label="Report filters">
        <label>
          Customer
          <select value={customer} onChange={(event) => go({ customer: event.target.value, country: "", region: "" })}>
            <option value="">All customers</option>
            {customers.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
            <option value="none">No customer</option>
          </select>
        </label>
        {report.key === "locations" ? null : (
          <>
            <div className="dx-toggle rx-presets" role="group" aria-label="Date range">
              {ranges.map((range) => (
                <button key={range.key} type="button" aria-pressed={activePreset === range.key} onClick={() => go({ from: range.from, to: range.to })}>{range.label}</button>
              ))}
            </div>
            <label>
              From
              <input type="date" value={report.from} max={report.to} onChange={(event) => event.target.value && go({ from: event.target.value })} />
            </label>
            <label>
              To
              <input type="date" value={report.to} min={report.from} max={localToday()} onChange={(event) => event.target.value && go({ to: event.target.value })} />
            </label>
          </>
        )}
        <span className="rx-range">{report.key === "locations" ? `As of ${report.generatedLabel}` : report.rangeLabel}</span>
      </div>

      {report.drill ? <Drill drill={report.drill} go={go} /> : null}

      <section className="rx-kpis" aria-label="Summary">
        {report.summary.map((item) => (
          <div key={item.label} className="rx-kpi">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <div className="rx-charts">
        {report.charts.map((chart) => <ChartCard key={chart.title} chart={chart} />)}
      </div>

      {report.tables.map((table) => (
        <TableCard key={table.key} table={table} deviceLink={deviceLink} drill={report.key === "locations" ? go : null} />
      ))}

      {report.notes.length ? (
        <section className="rx-notes">
          {report.notes.map((note) => <p key={note}>{note}</p>)}
        </section>
      ) : null}

      {scheduling ? (
        <ScheduleDialog report={report} customers={customers} customer={customer} onClose={() => setScheduling(false)} />
      ) : null}
    </div>
  );
}

function Drill({ drill, go }) {
  return (
    <nav className="rx-drill" aria-label="Location">
      {drill.country ? <button type="button" onClick={() => go({ country: "", region: "" })}>All countries</button> : <span>All countries</span>}
      {drill.country ? (
        <>
          <span aria-hidden="true">›</span>
          {drill.region ? <button type="button" onClick={() => go({ region: "" })}>{drill.countryName}</button> : <span>{drill.countryName}</span>}
        </>
      ) : null}
      {drill.region ? (
        <>
          <span aria-hidden="true">›</span>
          <span>{drill.region}</span>
        </>
      ) : null}
    </nav>
  );
}

function ChartCard({ chart }) {
  const hasData = chart.type === "bars"
    ? chart.items?.length > 0
    : chart.days?.length > 0 && chart.series?.some((series) => series.values.some((value) => value != null));
  return (
    <section className={`dx-card rx-chart-card ${chart.type === "bars" ? "is-bars" : ""}`}>
      <header><h2>{chart.title}</h2></header>
      {!hasData ? <p className="rx-empty">{chart.empty}</p> : chart.type === "bars" ? (
        <Bars items={chart.items.map((item, index) => ({
          key: `${item.label}-${index}`,
          label: item.label,
          value: item.value,
          display: item.display,
          color: chart.colorBy === "index" || item.tone ? toneColor(index, item.tone) : undefined,
        }))} />
      ) : (
        <TimeChart type={chart.type} days={chart.days} series={chart.series} unit={chart.unit} label={chart.title} />
      )}
    </section>
  );
}

function TableCard({ table, deviceLink, drill }) {
  const columns = table.columns.filter((column) => !column.key.startsWith("_"));
  return (
    <section className="dx-card rx-table-card">
      <header><h2>{table.title}</h2>{table.rows.length ? <span className="rx-count">{table.more ? `${table.rows.length}+` : table.rows.length}</span> : null}</header>
      {table.rows.length === 0 ? <p className="rx-empty">{table.empty}</p> : (
        <div className="rx-table-wrap">
          <table className="rx-table">
            <thead>
              <tr>{columns.map((column) => <th key={column.key} className={column.align === "right" ? "num" : undefined} scope="col">{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={`${row._id || ""}-${index}`}>
                  {columns.map((column, i) => {
                    const value = row[column.key];
                    let content = value === "" || value == null ? <span className="rx-dash">—</span> : value;
                    if (i === 0 && row._drill && drill) {
                      content = <button type="button" className="rx-link" onClick={() => drill(row._drill)}>{value}</button>;
                    } else if (i === 0 && row._id && deviceLink(row._id)) {
                      content = <a href={deviceLink(row._id)}>{value}</a>;
                    }
                    const className = column.align === "right" ? "num" : column.width >= 5 ? "is-wrap" : undefined;
                    return <td key={column.key} className={className}>{content}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.more ? <p className="dx-note">{table.more}</p> : null}
    </section>
  );
}

export function ScheduleDialog({ report: fixed, reports, customers, customer, onClose, onDone }) {
  const box = useRef(null);
  const [reportKey, setReportKey] = useState(fixed?.key || reports?.[0]?.key || "");
  const report = fixed || reports.find((item) => item.key === reportKey);
  const [contacts, setContacts] = useState(null);
  const [customerId, setCustomerId] = useState(customer && customer !== "none" ? customer : "");
  const [recipient, setRecipient] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ busy: false, error: "", done: null });

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    reportContacts().then((result) => { if (live) setContacts(result.ok ? result.contacts : []); });
    box.current?.querySelector("select, input")?.focus();
    const onKey = (event) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const choices = (contacts || []).filter((contact) => !customerId || String(contact.customerId) === customerId);
  const customerName = (id) => customers.find((item) => String(item.id) === String(id))?.name || "";

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true, error: "", done: null });
    const result = await createReportSubscription({
      report: report.key,
      customerId,
      contactId: recipient && recipient !== "other" ? recipient : "",
      email: recipient === "other" ? email : "",
    });
    if (!result.ok) return setState({ busy: false, error: result.error, done: null });
    setState({ busy: false, error: "", done: result.nextRunAt });
    onDone?.();
  }

  return (
    <div className="rx-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="rx-dialog" role="dialog" aria-modal="true" aria-labelledby="rx-schedule-title" ref={box}>
        <h2 id="rx-schedule-title">Schedule a monthly report</h2>
        {state.done ? (
          <>
            <p>{`${report.title} will be emailed as a PDF on the 1st of every month, covering the month before. The first email goes out on ${new Date(state.done).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.`}</p>
            <div className="rx-dialog-actions">
              {fixed ? <a className="rx-button" href="/reports/exports">View scheduled reports</a> : null}
              <button type="button" className="rx-button is-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="dx-note">{`A PDF of ${fixed ? report.title : "the report"} for the previous month is emailed on the 1st of each month. Every send is logged under Scheduled exports.`}</p>
            {fixed ? null : (
              <label>
                Report
                <select value={reportKey} onChange={(event) => setReportKey(event.target.value)}>
                  {reports.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
                </select>
              </label>
            )}
            <label>
              Customer
              <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setRecipient(""); }}>
                <option value="">All customers</option>
                {customers.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Send to
              <select value={recipient} onChange={(event) => setRecipient(event.target.value)} required disabled={contacts == null}>
                <option value="" disabled>{contacts == null ? "Loading contacts…" : "Choose a contact"}</option>
                {choices.map((contact) => (
                  <option key={contact.id} value={String(contact.id)}>
                    {`${contact.name} (${contact.email})${customerId ? "" : ` · ${customerName(contact.customerId)}`}`}
                  </option>
                ))}
                <option value="other">Another email address</option>
              </select>
            </label>
            {recipient === "other" ? (
              <label>
                Email address
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" />
              </label>
            ) : null}
            {state.error ? <p className="rx-error" role="alert">{state.error}</p> : null}
            <div className="rx-dialog-actions">
              <button type="button" className="rx-button" onClick={onClose}>Cancel</button>
              <button type="submit" className="rx-button is-primary" disabled={state.busy}>{state.busy ? "Scheduling…" : "Schedule"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
