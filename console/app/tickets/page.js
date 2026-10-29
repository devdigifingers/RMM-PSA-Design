import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { AppTitle } from "../mark";
import {
  CHANNEL_LABELS,
  COLUMN_LABELS,
  FILTER_PARAMS,
  LIST_PARAMS,
  PRIORITY_LABELS,
  SLA_LABELS,
  STATUS_LABELS,
  VIEW_LABELS,
} from "./columns";
import { DeleteView, SaveView } from "./saved-views";
import { TicketTable } from "./ticket-table";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const NEWEST_FIRST = new Set(["lastActivity", "created", "id"]);

export default async function TicketsPage({ searchParams }) {
  const raw = (await searchParams) || {};
  const query = new URLSearchParams();
  let messy = false;
  for (const key of [...LIST_PARAMS, "saved"]) {
    const value = raw[key];
    if (value === undefined) continue;
    const values = (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
    if (Array.isArray(value) || values.length === 0) messy = true;
    if (values.length) query.set(key, values.join(","));
  }
  if (messy) redirect(query.size ? `/tickets?${query}` : "/tickets");

  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const apiQuery = new URLSearchParams(query);
  apiQuery.delete("saved");
  const response = await fetch(`${apiUrl}/v1/tickets${apiQuery.size ? `?${apiQuery}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  const body = await response.json();
  const users = body.users || [];
  const customers = body.customers || [];
  const devices = body.devices || [];
  const counts = body.counts || {};
  const views = body.views || [];

  const view = VIEW_LABELS[query.get("view")] ? query.get("view") : "all";
  const saved = views.find((item) => String(item.id) === query.get("saved")) || null;
  const q = query.get("q") || "";
  const sort = query.get("sort") && COLUMN_LABELS[query.get("sort")] ? query.get("sort") : "lastActivity";
  const dir = query.get("dir") === "asc" || query.get("dir") === "desc" ? query.get("dir") : NEWEST_FIRST.has(sort) ? "desc" : "asc";
  const columns = saved?.columns || body.columns || body.defaultColumns || [];

  function href(changes, { keepPage = false, keepSaved = true } = {}) {
    const next = new URLSearchParams(query);
    if (!keepPage) next.delete("page");
    if (!keepSaved) next.delete("saved");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    return next.size ? `/tickets?${next}` : "/tickets";
  }

  const sortHrefs = Object.fromEntries((body.allColumns || []).map((column) => {
    const nextDir = sort === column ? (dir === "asc" ? "desc" : "asc") : NEWEST_FIRST.has(column) ? "desc" : "asc";
    return [column, href({ sort: column, dir: nextDir })];
  }));

  const chips = FILTER_PARAMS.filter((key) => query.has(key)).map((key) => ({
    key,
    label: chipLabel(key, query.get(key), { users, customers, devices }),
    href: href({ [key]: null }, { keepSaved: false }),
  }));
  const filtered = chips.length > 0 || q;
  const clearHref = view === "all" ? "/tickets" : `/tickets?view=${view}`;
  const viewQuery = new URLSearchParams(apiQuery);
  viewQuery.delete("page");
  const exportHref = `/tickets/export${viewQuery.size ? `?${viewQuery}` : ""}`;
  const first = body.total ? (body.page - 1) * body.pageSize + 1 : 0;
  const last = Math.min(body.total || 0, (body.page || 1) * (body.pageSize || 50));
  const personal = views.filter((item) => !item.shared);
  const shared = views.filter((item) => item.shared);
  const ownerValue = query.get("owner") || "";
  const statusValues = new Set((query.get("status") || "").split(","));
  const priorityValues = new Set((query.get("priority") || "").split(","));
  const categories = withValue(body.categories || [], query.get("category"));
  const tags = withValue(body.tags || [], query.get("tag"));

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <aside className="desk-views" aria-label="Ticket views">
          <p className="desk-views-title">Views</p>
          <nav>
            {Object.entries(VIEW_LABELS).map(([id, label]) => {
              const active = !saved && id === view;
              return (
                <a
                  key={id}
                  href={id === "all" ? "/tickets" : `/tickets?view=${id}`}
                  className={active ? "is-active" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  <span>{label}</span>
                  <span className="desk-count">{counts[id] ?? 0}</span>
                </a>
              );
            })}
          </nav>
          <SavedList title="My Views" views={personal} saved={saved} />
          <SavedList title="Shared Views" views={shared} saved={saved} />
          <p className="desk-views-title">Desk</p>
          <nav>
            <a href="/tickets/setup"><span>SLA Targets</span></a>
          </nav>
        </aside>
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              <AppTitle app="service-desk">
                {saved ? saved.name : VIEW_LABELS[view]} <span className="desk-total">({body.total ?? 0})</span>
              </AppTitle>
            </h1>
            <form className="find desk-find" method="get" action="/tickets">
              {[...query.entries()].filter(([key]) => key !== "q" && key !== "page").map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <label className="search">
                <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input name="q" placeholder="Search tickets" defaultValue={q} aria-label="Search tickets" />
              </label>
            </form>
            <a className="desk-new" href="/tickets/new">
              <span aria-hidden="true">+</span> New Ticket
            </a>
          </header>

          <details className="desk-filters">
            <summary>
              Filters{chips.length ? <span className="desk-count">{chips.length}</span> : null}
            </summary>
            <form method="get" action="/tickets" className="desk-filter-form">
              {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
              {q ? <input type="hidden" name="q" value={q} /> : null}
              {query.has("sort") ? <input type="hidden" name="sort" value={sort} /> : null}
              {query.has("dir") ? <input type="hidden" name="dir" value={dir} /> : null}
              <fieldset>
                <legend>Status</legend>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <label key={value} className="desk-tick">
                    <input type="checkbox" name="status" value={value} defaultChecked={statusValues.has(value)} /> {label}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Priority</legend>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <label key={value} className="desk-tick">
                    <input type="checkbox" name="priority" value={value} defaultChecked={priorityValues.has(value)} /> {label}
                  </label>
                ))}
              </fieldset>
              <label>
                Owner
                <select name="owner" defaultValue={ownerValue}>
                  <option value="">Anyone</option>
                  <option value="me">Me</option>
                  <option value="none">Unassigned</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <label>
                Customer
                <select name="customer" defaultValue={query.get("customer") || ""}>
                  <option value="">Any customer</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
              </label>
              <label>
                Device
                <select name="device" defaultValue={query.get("device") || ""}>
                  <option value="">Any device</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.hostname}{device.customerName ? ` (${device.customerName})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select name="channel" defaultValue={query.get("channel") || ""}>
                  <option value="">Any channel</option>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Category
                <select name="category" defaultValue={query.get("category") || ""}>
                  <option value="">Any category</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                Tag
                <select name="tag" defaultValue={query.get("tag") || ""}>
                  <option value="">Any tag</option>
                  {tags.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                SLA
                <select name="sla" defaultValue={query.get("sla") || ""}>
                  <option value="">Any SLA state</option>
                  {Object.entries(SLA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <fieldset className="desk-range">
                <legend>Created</legend>
                <input type="date" name="created_from" defaultValue={query.get("created_from") || ""} aria-label="Created from" />
                <span aria-hidden="true">to</span>
                <input type="date" name="created_to" defaultValue={query.get("created_to") || ""} aria-label="Created to" />
              </fieldset>
              <fieldset className="desk-range">
                <legend>Due</legend>
                <input type="date" name="due_from" defaultValue={query.get("due_from") || ""} aria-label="Due from" />
                <span aria-hidden="true">to</span>
                <input type="date" name="due_to" defaultValue={query.get("due_to") || ""} aria-label="Due to" />
              </fieldset>
              <div className="desk-filter-actions">
                <button type="submit">Apply filters</button>
                <a href={clearHref}>Clear all</a>
              </div>
            </form>
          </details>

          {chips.length ? (
            <div className="desk-chips" aria-label="Active filters">
              {chips.map((chip) => (
                <a key={chip.key} className="desk-chip" href={chip.href} aria-label={`Remove filter ${chip.label}`}>
                  {chip.label} <span aria-hidden="true">×</span>
                </a>
              ))}
              <a className="desk-chip-clear" href={clearHref}>Clear all</a>
            </div>
          ) : null}

          {!body.sla ? (
            <p className="org-name">Due dates and SLA states appear once targets are set in <a href="/tickets/setup">SLA Targets</a>.</p>
          ) : null}

          <TicketTable
            key={`${query}`}
            tickets={body.tickets || []}
            columns={columns}
            allColumns={body.allColumns || []}
            viewColumns={Boolean(saved?.columns)}
            sort={sort}
            dir={dir}
            sortHrefs={sortHrefs}
            users={users}
            me={body.me}
            categories={body.categories || []}
            tags={body.tags || []}
            empty={filtered ? "No tickets match these filters." : "No tickets in this view."}
            emptyHref={filtered ? clearHref : null}
            tools={(
              <>
                <span className="desk-range-note">{body.total ? `${first}–${last} of ${body.total}` : "0 tickets"}</span>
                <a className="desk-tool" href={exportHref} download>Export CSV</a>
                <SaveView query={viewQuery.toString()} columns={columns} canShare={body.canOperate} />
              </>
            )}
          />

          {body.pages > 1 ? (
            <nav className="desk-pages" aria-label="Pages">
              {body.page > 1 ? <a href={href({ page: body.page - 1 }, { keepPage: true })} rel="prev">← Previous</a> : <span aria-disabled="true">← Previous</span>}
              {pageList(body.page, body.pages).map((item, index) => (
                item === "…"
                  ? <span key={`gap-${index}`} aria-hidden="true">…</span>
                  : (
                    <a
                      key={item}
                      href={href({ page: item === 1 ? null : item }, { keepPage: true })}
                      className={item === body.page ? "is-active" : undefined}
                      aria-current={item === body.page ? "page" : undefined}
                    >
                      {item}
                    </a>
                  )
              ))}
              {body.page < body.pages ? <a href={href({ page: body.page + 1 }, { keepPage: true })} rel="next">Next →</a> : <span aria-disabled="true">Next →</span>}
            </nav>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function SavedList({ title, views, saved }) {
  if (!views.length) return null;
  return (
    <>
      <p className="desk-views-title">{title}</p>
      <nav>
        {views.map((item) => {
          const active = saved?.id === item.id;
          return (
            <div key={item.id} className="desk-saved">
              <a
                href={`/tickets?${item.query ? `${item.query}&` : ""}saved=${item.id}`}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                title={item.shared && !item.mine ? `Shared by ${item.ownerName}` : undefined}
              >
                <span>{item.name}</span>
              </a>
              {item.canDelete ? <DeleteView id={item.id} name={item.name} active={active} /> : null}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function chipLabel(key, value, { users, customers, devices }) {
  switch (key) {
    case "status":
      return `Status: ${value.split(",").map((item) => STATUS_LABELS[item] || item).join(", ")}`;
    case "priority":
      return `Priority: ${value.split(",").map((item) => PRIORITY_LABELS[item] || item).join(", ")}`;
    case "owner":
      return `Owner: ${value === "me" ? "Me" : value === "none" ? "Unassigned" : users.find((user) => String(user.id) === value)?.name || "Unknown"}`;
    case "customer":
      return `Customer: ${customers.find((customer) => String(customer.id) === value)?.name || "Unknown"}`;
    case "device":
      return `Device: ${devices.find((device) => String(device.id) === value)?.hostname || "Unknown"}`;
    case "channel":
      return `Channel: ${CHANNEL_LABELS[value] || value}`;
    case "category":
      return `Category: ${value}`;
    case "tag":
      return `Tag: ${value}`;
    case "sla":
      return `SLA: ${SLA_LABELS[value] || value}`;
    case "created_from":
      return `Created from ${value}`;
    case "created_to":
      return `Created up to ${value}`;
    case "due_from":
      return `Due from ${value}`;
    case "due_to":
      return `Due up to ${value}`;
    default:
      return value;
  }
}

function withValue(list, value) {
  if (!value || list.some((item) => item.toLowerCase() === value.toLowerCase())) return list;
  return [...list, value];
}

function pageList(page, pages) {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((item) => item >= 1 && item <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out = [];
  for (const item of sorted) {
    if (out.length && item - out[out.length - 1] > 1) out.push("…");
    out.push(item);
  }
  return out;
}
