import Link from "next/link";
import { PackageForm } from "../package-form";

export const metadata = { title: "New package · Digital Fingers RMM" };

export default function NewPackagePage() {
  return (
    <section className="admin-page">
      <p className="desk-back"><Link href="/control/packages">← All packages</Link></p>
      <header className="admin-head">
        <div>
          <h1>New package</h1>
          <p className="org-name">Names, limits and prices are yours to set. The code cannot be changed later.</p>
        </div>
      </header>
      <PackageForm />
    </section>
  );
}
