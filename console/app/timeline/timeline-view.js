"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadTimeline } from "../actions";

const EMPTY = { type: [], device: "", actor: "", from: "", to: "", q: "" };

const dayLabel = (value) => new Date(value).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeLabel = (value) => new Date(value).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });

function params(filters, before) {
  return {
    type: filters.type.join(","),
    device: filters.device,
    actor: filters.actor,
    from: filters.from,
    to: filters.to,
    q: filters.q,
    ...(before ? { before } : {}),
  };
}

// The customer or device timeline: filters on top, events grouped by day, more loaded on scroll.
export function TimelineView({ scope, id, customerBase = null }) {
  const [filters, setFilters] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ items: [], next: null, loading: true, error: "" });
  const [options, setOptions] = useState(null);
  const request = useRef(0);
  const sentinel = useRef(null);

  const load = useCallback(async (before) => {
    const ticket = ++request.current;
    setState((current) => ({ ...current, loading: true, error: "" }));
    const result = await loadTimeline(scope, String(id), params(filters, before));
    if (ticket !== request.current) return;
    if (!result.ok) {
      setState((current) => ({ ...current, loading: false, error: result.error }));
      return;
    }
    if (result.options) setOptions(result.options);
    setState((current) => ({
      items: before ? [...current.items, ...result.items] : result.items,
      next: result.next,
      loading: false,
      error: "",
    }));
  }, [scope, id, filters]);

  useEffect(() => {
    load(null);
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => (current.q === search.trim() ? current : { ...current, q: search.trim() })), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !state.next || state.loading) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load(state.next);
    }, { rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state.next, state.loading, load]);

  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const toggle = (group) => setFilters((current) => ({
    ...current,
    type: current.type.includes(group) ? current.type.filter((item) => item !== group) : [...current.type, group],
  }));
  const filtered = filters.type.length || filters.device || filters.actor || filters.from || filters.to || filters.q;
  const groupLabel = Object.fromEntries((options?.groups || []).map((group) => [group.key, group.label]));

  let lastDay = "";
  return (
    <section className="tl" aria-label="Timeline">
      <div className="tl-filters">
        <label className="search tl-search">
          <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input value={search} placeholder="Search the timeline" aria-label="Search the timeline" onChange={(event) => setSearch(event.target.value)} />
        </label>
        {scope === "accounts" && options?.devices?.length ? (
          <select value={filters.device} onChange={(event) => set("device", event.target.value)} aria-label="Device">
            <option value="">All devices</option>
            {options.devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
          </select>
        ) : null}
        {options?.actors?.length ? (
          <select value={filters.actor} onChange={(event) => set("actor", event.target.value)} aria-label="Technician">
            <option value="">Everyone</option>
            {options.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </select>
        ) : null}
        <span className="tl-range">
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set("from", event.target.value)} aria-label="From" />
          <span aria-hidden="true">to</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set("to", event.target.value)} aria-label="To" />
        </span>
        {filtered ? (
          <button type="button" className="link-button" onClick={() => { setSearch(""); setFilters(EMPTY); }}>Clear filters</button>
        ) : null}
      </div>
      {options?.groups?.length ? (
        <div className="tl-types" role="group" aria-label="Event types">
          {options.groups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={filters.type.includes(group.key) ? `tl-type is-${group.key} is-on` : `tl-type is-${group.key}`}
              aria-pressed={filters.type.includes(group.key)}
              onClick={() => toggle(group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}

      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <p className="org-name tl-empty">{filtered ? "Nothing matches these filters." : "Nothing recorded here yet."}</p>
      ) : null}

      <ol className="tl-list">
        {state.items.map((item) => {
          const day = dayLabel(item.at);
          const heading = day !== lastDay;
          lastDay = day;
          return (
            <li key={item.id} className={heading ? "tl-item has-day" : "tl-item"}>
              {heading ? <h3 className="tl-day">{day}</h3> : null}
              <div className="tl-row">
                <time dateTime={item.at} title={new Date(item.at).toLocaleString("en-ZA")}>{timeLabel(item.at)}</time>
                <span className={`tl-dot is-${item.group}`} title={groupLabel[item.group] || item.group} aria-hidden="true" />
                <div className="tl-body">
                  <p>
                    <strong className={item.actorType === "user" ? undefined : "tl-system"}>{item.actor}</strong> {item.summary}
                  </p>
                  <p className="tl-links">
                    {item.ticket ? <a href={`/tickets/${item.ticket.id}`}>#{item.ticket.id}{item.ticket.subject ? ` ${item.ticket.subject}` : ""}</a> : null}
                    {item.device && scope === "accounts" ? <a href={`/devices/${item.device.id}/diagnostics?tool=timeline`}>{item.device.name || `Device ${item.device.id}`}</a> : null}
                    {item.customer && scope === "devices" && customerBase ? <a href={`${customerBase}/${item.customer.id}?tab=timeline`}>{item.customer.name || "Customer"}</a> : null}
                    <span className="tl-kind">{groupLabel[item.group] || item.group}</span>
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {state.next ? <div ref={sentinel} className="tl-more"><button type="button" className="secondary" disabled={state.loading} onClick={() => load(state.next)}>{state.loading ? "Loading…" : "Load more"}</button></div> : null}
      {state.loading && !state.items.length ? <p className="org-name">Loading the timeline…</p> : null}
    </section>
  );
}
