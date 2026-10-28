import Link from "next/link";
import { platformGet } from "../../api";
import { TenantWizard } from "./wizard";

export const metadata = { title: "New tenant · Digital Fingers RMM" };

export default async function NewTenantPage() {
  const { packages } = await platformGet("/v1/platform/packages");
  return (
    <section className="admin-page">
      <p className="desk-back"><Link href="/control/tenants">← All tenants</Link></p>
      <header className="admin-head">
        <div>
          <h1>New tenant</h1>
          <p className="org-name">Creates the company, its license and the first admin together.</p>
        </div>
      </header>
      <TenantWizard packages={packages.filter((item) => item.active && !item.isCustom)} />
    </section>
  );
}
