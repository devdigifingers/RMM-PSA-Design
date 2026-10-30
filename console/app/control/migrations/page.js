import Link from "next/link";
import { platformGet } from "../api";
import { MIGRATION_TABS } from "../../migration-labels";
import { MigrationTable } from "./migration-table";

export const metadata = { title: "Migrations · Digital Fingers RMM" };

export default async function MigrationsPage({ searchParams }) {
  const params = await searchParams;
  const tab = MIGRATION_TABS.some(([key]) => key === params?.tab) ? params.tab : "pending";
  const { items, counts, waiting } = await platformGet(`/v1/platform/migrations?tab=${tab}`);

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Migrations</h1>
          <p className="org-name">Move or copy customers, tickets and devices between tenants. Each request needs both tenants and a second platform admin to approve it.</p>
        </div>
        <Link className="desk-new" href="/control/migrations/new"><span aria-hidden="true">+</span> New migration</Link>
      </header>
      {waiting ? <p className="saved admin-note">{waiting === 1 ? "One request is waiting for you." : `${waiting} requests are waiting for you.`}</p> : null}
      <nav className="cust-tabs" aria-label="Sections">
        {MIGRATION_TABS.map(([key, label]) => (
          <a key={key} href={`/control/migrations?tab=${key}`} className={tab === key ? "is-active" : undefined} aria-current={tab === key ? "page" : undefined}>
            {label}{counts[key] ? <span className="mig-tab-count">{counts[key]}</span> : null}
          </a>
        ))}
      </nav>
      <MigrationTable items={items} empty="Nothing here." />
    </section>
  );
}
