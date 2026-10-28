import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const KINDS = [
  ["company", "Company"],
  ["sole_proprietor", "Sole proprietor"],
  ["other", "Other entity"],
];

export function kindLabel(kind) {
  return KINDS.find(([value]) => value === kind)?.[1] || "Company";
}

export async function apiGet(path) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=ticket");
  return response;
}

export function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function CustomerSide({ active, accounts, contacts }) {
  return (
    <aside className="desk-views">
      <p className="desk-views-title">Customers</p>
      <nav aria-label="Customers">
        <a href="/customers" className={active === "accounts" ? "is-active" : undefined} aria-current={active === "accounts" ? "page" : undefined}>
          <span>Accounts</span>
          {accounts != null ? <span className="desk-count">{accounts}</span> : null}
        </a>
        <a href="/customers/contacts" className={active === "contacts" ? "is-active" : undefined} aria-current={active === "contacts" ? "page" : undefined}>
          <span>Contacts</span>
          {contacts != null ? <span className="desk-count">{contacts}</span> : null}
        </a>
      </nav>
    </aside>
  );
}

export function AccountFields({ account }) {
  const value = (key) => account?.[key] || "";
  return (
    <div className="cust-fields">
      <label className="cust-wide">
        Account name
        <input name="name" required maxLength={200} defaultValue={value("name")} />
      </label>
      <label>
        Type
        <select name="kind" defaultValue={account?.kind || "company"}>
          {KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </label>
      <label>
        Website
        <input name="website" maxLength={200} placeholder="https://" defaultValue={value("website")} />
      </label>
      <label>
        Email
        <input name="email" type="email" maxLength={200} defaultValue={value("email")} />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" maxLength={40} defaultValue={value("phone")} />
      </label>
      <label>
        Alternative contact number
        <input name="altPhone" type="tel" maxLength={40} defaultValue={value("altPhone")} />
      </label>
      <label>
        Registration number
        <input name="registrationNumber" maxLength={60} defaultValue={value("registrationNumber")} />
      </label>
      <label>
        VAT number
        <input name="vatNumber" maxLength={60} defaultValue={value("vatNumber")} />
      </label>
      <label className="cust-wide">
        Physical address
        <textarea name="address" rows={3} maxLength={500} defaultValue={value("address")} />
      </label>
      <label className="cust-wide">
        Notes
        <textarea name="notes" rows={4} maxLength={4000} defaultValue={value("notes")} />
      </label>
    </div>
  );
}

export function ContactFields({ contact, prefix = "", requireName = true }) {
  const value = (key) => contact?.[key] || "";
  return (
    <div className="cust-fields">
      <label>
        Name
        <input name={`${prefix}name`} required={requireName} maxLength={200} defaultValue={value("name")} />
      </label>
      <label>
        Job title
        <input name={`${prefix}jobTitle`} maxLength={120} defaultValue={value("jobTitle")} />
      </label>
      <label>
        Email
        <input name={`${prefix}email`} type="email" maxLength={200} defaultValue={value("email")} />
      </label>
      <label>
        Phone
        <input name={`${prefix}phone`} type="tel" maxLength={40} defaultValue={value("phone")} />
      </label>
      <label>
        Alternative contact number
        <input name={`${prefix}altPhone`} type="tel" maxLength={40} defaultValue={value("altPhone")} />
      </label>
    </div>
  );
}

export function SearchBox({ q, placeholder }) {
  return (
    <form className="find desk-find" method="get">
      <label className="search">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input name="q" placeholder={placeholder} defaultValue={q} aria-label={placeholder} />
      </label>
    </form>
  );
}

export function SubLine({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <p className="cust-sub">
      {shown.map((item, index) => <span key={index}>{item}</span>)}
    </p>
  );
}
