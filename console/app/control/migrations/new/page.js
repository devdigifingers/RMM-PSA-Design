import Link from "next/link";
import { platformGet } from "../../api";
import { MigrationWizard } from "./wizard";

export const metadata = { title: "New migration · Digital Fingers RMM" };

export default async function NewMigrationPage({ searchParams }) {
  const params = await searchParams;
  const editId = Number(params?.edit) || null;
  const existing = editId ? await platformGet(`/v1/platform/migrations/${editId}`) : null;
  const sourceId = existing?.source.id || Number(params?.source) || null;
  const options = await platformGet(`/v1/platform/migrations/options${sourceId ? `?source=${sourceId}` : ""}`);
  const back = existing ? `/control/migrations/${existing.id}` : "/control/migrations";

  return (
    <section className="admin-page">
      <p className="desk-back"><Link href={back}>← {existing ? `MIG-${existing.id}` : "All migrations"}</Link></p>
      <header className="admin-head">
        <div>
          <h1>{existing ? `Change MIG-${existing.id}` : "New migration"}</h1>
          <p className="org-name">
            {existing
              ? "Changing what moves, the mode or the schedule clears the approvals, and everyone is asked again."
              : "Choose what moves, check the dry run, then send it for approval. Nothing changes until both tenants and a second platform admin approve."}
          </p>
        </div>
      </header>
      {existing && !existing.canEdit ? (
        <p className="error admin-note">This request can no longer be changed.</p>
      ) : (
        <MigrationWizard
          tenants={options.tenants}
          initialCustomers={options.customers}
          initial={existing ? {
            id: existing.id,
            sourceId: existing.source.id,
            targetId: existing.target.id,
            mode: existing.mode,
            scope: existing.scope,
            resolutions: existing.resolutions || {},
            acknowledged: existing.acknowledged || [],
            scheduleAt: existing.scheduleAt,
          } : { sourceId }}
        />
      )}
    </section>
  );
}
