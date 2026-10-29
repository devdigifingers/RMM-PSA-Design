"use client";

import { useId, useState } from "react";

// Remote Desk accent range, chosen to keep 3:1 contrast against the dark card background.
export const SERIES = ["#22D3EE", "#3B82F6", "#38BDF8", "#818CF8", "#0EA5E9", "#60A5FA", "#67E8F9", "#A5B4FC"];
export const AMBER = "#F59E0B";
export const RED = "#EF4444";

export function seriesColor(index) {
  return SERIES[index % SERIES.length];
}

export function Ring({ pct, size = 56, label }) {
  const id = useId();
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const radius = 22;
  const length = 2 * Math.PI * radius;
  return (
    <svg className="dx-ring" viewBox="0 0 56 56" width={size} height={size} role="img" aria-label={label || `${value}%`}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <circle cx="28" cy="28" r={radius} className="dx-ring-track" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke={`url(#${id}-g)`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * length} ${length}`}
        transform="rotate(-90 28 28)"
      />
      <text x="28" y="32" textAnchor="middle" className="dx-ring-text">{`${value}%`}</text>
    </svg>
  );
}

// segments: [{ key, label, value, pct, color, href, detail }]
export function Donut({ segments, size = 168, centerLabel, centerValue, onActive }) {
  const [active, setActive] = useState(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 60;
  const length = 2 * Math.PI * radius;
  let offset = 0;
  const current = segments.find((segment) => segment.key === active) || null;
  function pick(key) {
    setActive(key);
    onActive?.(key);
  }
  return (
    <svg className="dx-donut" viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={centerLabel}>
      <circle cx="80" cy="80" r={radius} className="dx-ring-track" strokeWidth="20" />
      {total > 0 ? segments.map((segment) => {
        const part = (segment.value / total) * length;
        const gap = segments.length > 1 ? Math.min(2, part / 3) : 0;
        const dash = `${Math.max(0, part - gap)} ${length}`;
        const node = (
          <circle
            key={segment.key}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={active === segment.key ? 24 : 20}
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            transform="rotate(-90 80 80)"
            className="dx-donut-seg"
            onMouseEnter={() => pick(segment.key)}
            onMouseLeave={() => pick(null)}
            onFocus={() => pick(segment.key)}
            onBlur={() => pick(null)}
          >
            <title>{`${segment.label}: ${segment.value} (${segment.pct}%)`}</title>
          </circle>
        );
        offset += part;
        return segment.href ? <a key={segment.key} href={segment.href} aria-label={`${segment.label}: ${segment.value}`}>{node}</a> : node;
      }) : null}
      <text x="80" y="78" textAnchor="middle" className="dx-donut-value">{current ? `${current.pct}%` : centerValue}</text>
      <text x="80" y="98" textAnchor="middle" className="dx-donut-label">{current ? truncate(current.label, 16) : centerLabel}</text>
    </svg>
  );
}

export function Legend({ items }) {
  return (
    <ul className="dx-legend">
      {items.map((item) => (
        <li key={item.key}>
          <a href={item.href} title={item.detail || undefined}>
            <i style={{ background: item.color }} aria-hidden="true" />
            <span className="dx-legend-label">{item.label}</span>
            {item.badge ? <em className={`dx-badge ${item.badgeTone || ""}`}>{item.badge}</em> : null}
            <b>{item.value}</b>
            <small>{`${item.pct}%`}</small>
          </a>
          {item.detail ? <p className="dx-legend-detail">{item.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function Bars({ items }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="dx-bars">
      {items.map((item) => {
        const body = (
          <>
            <span className="dx-bars-label">{item.label}</span>
            <span className="dx-bars-track"><i style={{ width: `${(item.value / max) * 100}%`, ...(item.color ? { background: item.color } : {}) }} /></span>
            <b>{item.display ?? item.value}</b>
          </>
        );
        return <li key={item.key}>{item.href ? <a href={item.href}>{body}</a> : <span className="dx-bars-row">{body}</span>}</li>;
      })}
    </ul>
  );
}

const TONES = { amber: AMBER, red: RED, green: "#22C55E", muted: "#94A3B8" };

export function toneColor(index, tone) {
  return TONES[tone] || seriesColor(index);
}

function niceMax(value) {
  if (!(value > 0)) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return Math.max(4, step * power);
  return value;
}

function runsOf(flags) {
  const out = [];
  let run = [];
  flags.forEach((on, i) => {
    if (on) run.push(i);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  });
  if (run.length) out.push(run);
  return out;
}

function dayLabel(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

// type "area" stacks the series; "lines" draws each one. Null values are days without data and leave a gap.
export function TimeChart({ type = "lines", days, series, unit, label }) {
  const [hover, setHover] = useState(null);
  const W = 720;
  const H = 240;
  const pad = { left: 44, right: 12, top: 12, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const shown = series.filter((item) => item.values.some((value) => value != null));
  const stacked = type === "area";
  const totals = days.map((_, i) => shown.reduce((sum, item) => sum + (Number(item.values[i]) || 0), 0));
  const peak = stacked ? Math.max(0, ...totals) : Math.max(0, ...shown.flatMap((item) => item.values.filter((value) => value != null)));
  const max = unit === "%" ? 100 : niceMax(peak);
  const xAt = (i) => pad.left + (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const yAt = (value) => pad.top + plotH - (Math.max(0, value) / max) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((step) => (max / 4) * step);
  const labels = days.length <= 2 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const has = (i) => shown.some((item) => item.values[i] != null);
  const base = days.map(() => 0);
  const layers = shown.map((item, index) => {
    const color = toneColor(index, item.tone);
    const lower = [...base];
    days.forEach((_, i) => { base[i] += Number(item.values[i]) || 0; });
    return { item, color, lower, upper: [...base] };
  });
  function move(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * W;
    const i = days.length <= 1 ? 0 : Math.round(((x - pad.left) / plotW) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  }
  const fmt = (value) => (value == null ? "No data" : `${Math.round(value * 10) / 10}${unit === "%" ? "%" : ""}`);
  return (
    <div className="rx-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {ticks.map((value) => (
          <g key={value}>
            <line x1={pad.left} x2={W - pad.right} y1={yAt(value)} y2={yAt(value)} className="rx-grid" />
            <text x={pad.left - 6} y={yAt(value) + 4} textAnchor="end" className="rx-axis">{`${Number.isInteger(value) ? value : value.toFixed(1)}${unit === "%" ? "%" : ""}`}</text>
          </g>
        ))}
        {stacked
          ? layers.map(({ item, color, lower, upper }) => runsOf(days.map((_, i) => has(i))).map((run) => (
            run.length === 1
              ? <rect key={`${item.label}-${run[0]}`} x={xAt(run[0]) - 3} y={yAt(upper[run[0]])} width={6} height={Math.max(0, yAt(lower[run[0]]) - yAt(upper[run[0]]))} fill={color} />
              : <polygon key={`${item.label}-${run[0]}`} fill={color} fillOpacity="0.85" points={[...run.map((i) => `${xAt(i)},${yAt(upper[i])}`), ...[...run].reverse().map((i) => `${xAt(i)},${yAt(lower[i])}`)].join(" ")} />
          )))
          : shown.map((item, index) => runsOf(item.values.map((value) => value != null)).map((run) => (
            run.length === 1
              ? <circle key={`${item.label}-${run[0]}`} cx={xAt(run[0])} cy={yAt(item.values[run[0]])} r="3.5" fill={toneColor(index, item.tone)} />
              : <polyline key={`${item.label}-${run[0]}`} fill="none" stroke={toneColor(index, item.tone)} strokeWidth="2.2" strokeLinejoin="round" points={run.map((i) => `${xAt(i)},${yAt(item.values[i])}`).join(" ")} />
          )))}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="rx-baseline" />
        {labels.map((i) => <text key={i} x={xAt(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="rx-axis">{dayLabel(days[i])}</text>)}
        {hover != null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.top} y2={pad.top + plotH} className="rx-guide" /> : null}
      </svg>
      <div className="rx-readout" aria-live="polite">
        {hover != null ? (
          <>
            <strong>{dayLabel(days[hover])}</strong>
            {shown.map((item, index) => (
              <span key={item.label}><i style={{ background: toneColor(index, item.tone) }} />{`${item.label}: ${fmt(item.values[hover])}`}</span>
            ))}
          </>
        ) : (
          shown.map((item, index) => <span key={item.label}><i style={{ background: toneColor(index, item.tone) }} />{item.label}</span>)
        )}
      </div>
    </div>
  );
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
