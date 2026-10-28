import Link from "next/link";
import { platformGet } from "../api";
import { formatDate } from "../catalog";

export const metadata = { title: "Audit · Digital Fingers RMM" };

const FILTERS = ["tenant", "actor", "action", "from", "to"];

function detailSummary(detail) {
  if (detail?.changes && typeof detail.changes === "object") {
    const keys = Object.keys(detail.changes);
    if (keys.length) return `Changed ${keys.join(", ")}`;
  }
  if (typeof detail?.before === "string" && typeof detail?.after === "string") return `${detail.before} → ${detail.after}`;
  if (detail?.email) return detail.email;
  if (detail?.name) return detail.name;
  return "";
}

export default async function AuditPage({ searchParams }) {
  const params = await searchParams;
  const filters = new URLSearchParams();
  for (const key of FILTERS) {
    const value = String(params?.[key] || "").trim();
    if (value) filters.set(key, value);
  }
  const page = Math.max(1, Number.parseInt(params?.page || "1", 10) || 1);
  const query = new URLSearchParams(filters);
  if (page > 1) query.set("page", String(page));
  const data = await platformGet(`/v1/platform/audit?${query}`);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageHref = (number) => {
    const next = new URLSearchParams(filters);
    if (number > 1) next.set("page", String(number));
    const text = next.toString();
    return `/control/audit${text ? `?${text}` : ""}`;
  };
  const exportQuery = filters.toString();

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Audit</h1>
          <p className="org-name">Every change made on the platform. Entries cannot be edited or deleted.</p>
        </div>
        <a className="desk-new" href={`/control/audit/export${exportQuery ? `?${exportQuery}` : ""}`} download>Export CSV</a>
      </header>
      <form className="admin-filters" method="get" action="/control/audit">
        <label>
          <span className="sr-only">Tenant</span>
          <select name="tenant" defaultValue={filters.get("tenant") || ""}>
            <option value="">All tenants</option>
            <option value="platform">Platform only</option>
            {data.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Actor</span>
          <select name="actor" defaultValue={filters.get("actor") || ""}>
            <option value="">Anyone</option>
            {data.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.email}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Action</span>
          <select name="action" defaultValue={filters.get("action") || ""}>
            <option value="">Any action</option>
            {data.actions.map((action) => <option key={action} value={action}>{action}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={filters.get("from") || ""} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={filters.get("to") || ""} />
        </label>
        <button type="submit">Filter</button>
        {exportQuery ? <Link className="admin-clear" href="/control/audit">Clear</Link> : null}
      </form>
      <div className="usage-table admin-table">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Tenant</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.events.length === 0 ? (
              <tr><td className="empty" colSpan={6}>No audit events match.</td></tr>
            ) : data.events.map((event) => {
              const summary = detailSummary(event.detail);
              const hasDetail = Object.keys(event.detail || {}).length > 0;
              return (
                <tr key={event.id}>
                  <td>{formatDate(event.createdAt, true)}</td>
                  <td>{event.orgId ? <Link href={`/control/tenants/${event.orgId}`}>{event.tenant}</Link> : event.tenant}</td>
                  <td>{event.actor}</td>
                  <td><code>{event.action}</code></td>
                  <td>{event.targetType ? `${event.targetType}${event.targetId ? ` ${event.targetId}` : ""}` : "—"}</td>
                  <td>
                    {hasDetail ? (
                      <details className="admin-detail">
                        <summary>{summary || "View"}</summary>
                        <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav className="admin-pager" aria-label="Pages">
        <span>{data.total} event{data.total === 1 ? "" : "s"} · page {Math.min(page, pages)} of {pages}</span>
        {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link href={pageHref(page + 1)}>Next</Link> : null}
      </nav>
    </section>
  );
}
