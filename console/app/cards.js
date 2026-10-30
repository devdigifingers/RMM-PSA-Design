"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function InfoTip({ text }) {
  const id = useId();
  return (
    <span className="dx-info" tabIndex={0} aria-describedby={id}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="dx-tip" role="tooltip" id={id}>{text}</span>
    </span>
  );
}

export function ReportLink({ report, canReport }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (canReport) return <a className="dx-report" href={`/reports/${report}`}>View report →</a>;
  return (
    <span className="dx-upsell-wrap" ref={box}>
      <button type="button" className="dx-report" aria-expanded={open} onClick={() => setOpen(!open)}>View report →</button>
      {open ? (
        <span className="dx-upsell" role="dialog" aria-label="Reports not included">
          <strong>Reports is not in your package</strong>
          <span>Trends over time, CSV and PDF exports and scheduled reports for your customers come with the Reports app.</span>
          <a href="/settings/org/subscription">Manage Subscription</a>
        </span>
      ) : null}
    </span>
  );
}

// The whole card opens the device list for its slice; inner links and controls keep their own action.
export function Card({ title, info, report, canReport, href, className = "", actions, children }) {
  const router = useRouter();
  function open(event) {
    if (!href || event.defaultPrevented) return;
    if (event.target.closest("a, button, select, input, label, [role='dialog'], [data-noclick]")) return;
    router.push(href);
  }
  return (
    <section className={`dx-card ${href ? "is-link" : ""} ${className}`} onClick={open}>
      <header>
        <h2>{href ? <a href={href}>{title}</a> : title}</h2>
        {info ? <InfoTip text={info} /> : null}
        <span className="dx-card-tools">
          {actions}
          {report ? <ReportLink report={report} canReport={canReport} /> : null}
        </span>
      </header>
      {children}
    </section>
  );
}
