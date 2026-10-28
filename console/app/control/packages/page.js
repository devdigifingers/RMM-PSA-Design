import Link from "next/link";
import { platformGet } from "../api";
import { money } from "../catalog";
import { AppIcons } from "../ui";

export const metadata = { title: "Packages · Digital Fingers RMM" };

export default async function PackagesPage({ searchParams }) {
  const params = await searchParams;
  const showCustom = params?.custom === "1";
  const { packages } = await platformGet("/v1/platform/packages");
  const shown = packages.filter((item) => showCustom || !item.isCustom);
  const customCount = packages.filter((item) => item.isCustom).length;

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Packages</h1>
          <p className="org-name">What each package includes, and the limits a tenant gets unless their license overrides them.</p>
        </div>
        <Link className="desk-new" href="/control/packages/new"><span aria-hidden="true">+</span> New package</Link>
      </header>
      <div className="admin-filters">
        <Link className={showCustom ? "filter-chip on" : "filter-chip"} href={showCustom ? "/control/packages" : "/control/packages?custom=1"} aria-pressed={showCustom}>
          Show custom packages ({customCount})
        </Link>
      </div>
      <div className="usage-table admin-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Apps</th>
              <th>Features</th>
              <th>Seats / Devices / Sessions</th>
              <th>Price</th>
              <th>Tenants</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td className="empty" colSpan={8}>No packages yet.</td></tr>
            ) : shown.map((item) => (
              <tr key={item.id}>
                <td><Link href={`/control/packages/${item.id}`}>{item.name}</Link>{item.isCustom ? <span className="chip admin-chip">Custom</span> : null}</td>
                <td><code>{item.code}</code></td>
                <td><AppIcons apps={item.apps} /></td>
                <td>{item.features.length}</td>
                <td>{item.defaultSeats} / {item.defaultDevices} / {item.defaultSessions}</td>
                <td>{item.priceMonthly == null ? "—" : `${money(item.priceMonthly, item.currency)} / month`}</td>
                <td>{item.tenantCount}</td>
                <td>{item.active ? <span className="usage-state">Active</span> : <span className="usage-state is-full">Inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
