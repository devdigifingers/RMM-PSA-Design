import Link from "next/link";
import { platformGet } from "../../api";
import { formatDate } from "../../catalog";
import { AppIcons } from "../../ui";
import { PackageForm } from "../package-form";

export const metadata = { title: "Package · Digital Fingers RMM" };

const SAVED = { created: "Package created.", package: "Package saved." };

export default async function PackagePage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const { package: pkg, tenants } = await platformGet(`/v1/platform/packages/${Number(id)}`);

  return (
    <section className="admin-page">
      <p className="desk-back"><Link href="/control/packages">← All packages</Link></p>
      <header className="admin-head">
        <div>
          <h1>{pkg.name} <AppIcons apps={pkg.apps} /></h1>
          <p className="org-name"><code>{pkg.code}</code>{pkg.isCustom ? " · Custom package" : ""} · Updated {formatDate(pkg.updatedAt, true)}</p>
        </div>
      </header>
      {SAVED[query?.saved] ? <p className="saved admin-note">{SAVED[query.saved]}</p> : null}
      <PackageForm pkg={pkg} />
      <section className="admin-card admin-wide">
        <h2>Tenants on this package</h2>
        {tenants.length === 0 ? <p className="org-name">No tenants use this package.</p> : (
          <ul className="admin-list">
            {tenants.map((tenant) => (
              <li key={tenant.id}><Link href={`/control/tenants/${tenant.id}`}>{tenant.name}</Link> <span className="org-name">{tenant.slug}</span></li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
