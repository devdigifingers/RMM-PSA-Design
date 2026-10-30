import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

// `remote` is Remote Desk's view of the customer record and `desk` is Service Desk's; the data is shared.
export const CUSTOMER_APPS = {
  remote: { base: "/remote/customers", name: "Remote Desk" },
  desk: { base: "/desk/customers", name: "Service Desk" },
};

export function customersBase(app) {
  return CUSTOMER_APPS[app]?.base || CUSTOMER_APPS.remote.base;
}

// Customers follow the package's apps even while the licence is inactive (read-only), so this ignores the licence state.
export function customerApps(account) {
  const apps = account?.license?.apps || [];
  return { remote: apps.includes("remote"), desk: apps.includes("servicedesk") };
}

// `hint` wins when the tenant has that app; otherwise the last app used, then Remote Desk, then Service Desk.
export async function preferredCustomersApp(account, hint) {
  const { remote, desk } = customerApps(account);
  if (!remote && !desk) return null;
  if (hint === "remote" && remote) return "remote";
  if (hint === "desk" && desk) return "desk";
  const saved = (await cookies()).get("df_app")?.value;
  if (saved === "service" && desk) return "desk";
  if (saved === "remote" && remote) return "remote";
  return remote ? "remote" : "desk";
}

export function queryString(params, drop = []) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (drop.includes(key) || value == null) continue;
    for (const item of Array.isArray(value) ? value : [value]) out.append(key, String(item));
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

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
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => ({}));
    if (body.code === "app_not_entitled") forbidden();
    redirect("/control/tenants");
  }
  return response;
}

export function ReadOnlyNote({ show }) {
  if (!show) return null;
  return (
    <p className="cust-readonly" role="status">
      The license is not active, so customers are read-only. <a href="/settings/org/subscription">Manage Subscription</a>
    </p>
  );
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

export function CustomerSide({ app, active, accounts, contacts }) {
  const base = customersBase(app);
  return (
    <aside className="desk-views">
      <p className="desk-views-title">Customers</p>
      <nav aria-label="Customers">
        <a href={base} className={active === "accounts" ? "is-active" : undefined} aria-current={active === "accounts" ? "page" : undefined}>
          <span>All customers</span>
          {accounts != null ? <span className="desk-count">{accounts}</span> : null}
        </a>
        <a href={`${base}/contacts`} className={active === "contacts" ? "is-active" : undefined} aria-current={active === "contacts" ? "page" : undefined}>
          <span>Contacts</span>
          {contacts != null ? <span className="desk-count">{contacts}</span> : null}
        </a>
      </nav>
    </aside>
  );
}

export function AccountFields({ account, withNotes = false }) {
  const value = (key) => account?.[key] || "";
  return (
    <div className="cust-fields">
      <label className="cust-wide">
        Customer name
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
      {withNotes ? (
        <label className="cust-wide">
          Notes
          <textarea name="notes" rows={4} maxLength={4000} defaultValue={value("notes")} />
        </label>
      ) : null}
    </div>
  );
}

export function minutesLabel(minutes) {
  if (minutes == null) return "—";
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
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
