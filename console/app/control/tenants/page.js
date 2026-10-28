import Link from "next/link";
import { platformGet } from "../api";
import { STATUS_LABEL, expiryLabel, meter } from "../catalog";
import { StatusChip, UsageMeter } from "../ui";

export const metadata = { title: "Tenants · Digital Fingers RMM" };

const PAGE_SIZE = 25;
const DAY = 86400000;

export default async function TenantsPage({ searchParams }) {
  const params = await searchParams;
  const [{ tenants }, { packages }] = await Promise.all([platformGet("/v1/platform/tenants"), platformGet("/v1/platform/packages")]);
  const q = String(params?.q || "").trim().toLowerCase();
  const pkg = String(params?.package || "");
  const status = String(params?.status || "");
  const expiring = params?.expiring === "1";
  const now = Date.now();
  const shown = tenants.filter((tenant) => {
    if (q && ![tenant.name, tenant.slug, String(tenant.licenseNumber)].some((value) => value.toLowerCase().includes(q))) return false;
    if (pkg && String(tenant.packageId) !== pkg) return false;
    if (status && tenant.status !== status) return false;
    if (expiring) {
      if (tenant.noExpiry || !tenant.expiresAt) return false;
      const left = new Date(tenant.expiresAt).getTime() - now;
      if (left < 0 || left > 30 * DAY) return false;
    }
    return true;
  });
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(params?.page || "1", 10) || 1));
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: params?.q, package: pkg, status, expiring: expiring ? "1" : "" })) {
      if (value) next.set(key, value);
    }
    if (number > 1) next.set("page", String(number));
    const query = next.toString();
    return `/control/tenants${query ? `?${query}` : ""}`;
  };

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Tenants</h1>
          <p className="org-name">Companies on the platform, their package, and what they use against it.</p>
        </div>
        <Link className="desk-new" href="/control/tenants/new"><span aria-hidden="true">+</span> New tenant</Link>
      </header>
      <form className="admin-filters" method="get" action="/control/tenants">
        <label>
          <span className="sr-only">Search</span>
          <input name="q" defaultValue={params?.q || ""} placeholder="Name, slug or license number" />
        </label>
        <label>
          <span className="sr-only">Package</span>
          <select name="package" defaultValue={pkg}>
            <option value="">All packages</option>
            {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select name="status" defaultValue={status}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="admin-check">
          <input type="checkbox" name="expiring" value="1" defaultChecked={expiring} />
          Expiring in 30 days
        </label>
        <button type="submit">Filter</button>
        {q || pkg || status || expiring ? <Link className="admin-clear" href="/control/tenants">Clear</Link> : null}
      </form>
      <div className="usage-table admin-table">
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Slug</th>
              <th>Package</th>
              <th>Seats</th>
              <th>Devices</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty" colSpan={7}>No tenants match.</td></tr>
            ) : rows.map((tenant) => (
              <tr key={tenant.id}>
                <td><Link href={`/control/tenants/${tenant.id}`}>{tenant.name}</Link></td>
                <td>{tenant.slug}</td>
                <td>{tenant.package?.name || "—"}</td>
                <td><UsageMeter meter={meter(tenant.seatsUsed, tenant.seats)} /></td>
                <td><UsageMeter meter={meter(tenant.deviceCount, tenant.devices)} /></td>
                <td>{expiryLabel(tenant)}</td>
                <td><StatusChip status={tenant.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="admin-pager" aria-label="Pages">
        <span>{shown.length} tenant{shown.length === 1 ? "" : "s"} · page {page} of {pages}</span>
        {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link href={pageHref(page + 1)}>Next</Link> : null}
      </nav>
    </section>
  );
}
