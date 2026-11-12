import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { accountFromSession, navFlags } from "../account-data";

export { KINDS, METHOD_LABELS, TAX_LABELS, quantityInput, rand, randInput, shortDate } from "./format";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function billingFetch(path) {
  const jar = await cookies();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${jar.get("df_session")?.value}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) forbidden();
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Invoicing could not be loaded.");
  return response.json();
}

export async function billingData(...paths) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const data = await Promise.all(paths.map((path) => billingFetch(path)));
  return { account, flags: navFlags(account), data };
}

export function Notice({ params, saved }) {
  const message = typeof saved[params?.saved] === "function" ? saved[params.saved](params) : saved[params?.saved];
  return (
    <>
      {params?.error ? <p className="error" role="alert">{String(params.error)}</p> : null}
      {message ? <p className="saved" role="status">{message}</p> : null}
    </>
  );
}

const TONES = {
  Overdue: "is-red", Paid: "is-green", Accepted: "is-green", Invoiced: "is-green", Applied: "is-green", "Open credit": "is-blue",
  "Partly paid": "is-blue", Sent: "is-blue", "Awaiting payment": "is-amber", Declined: "is-red", Void: "is-grey", Expired: "is-grey", Credited: "is-grey", Draft: "is-grey",
};

export function StatusPill({ label }) {
  return <span className={`bx-pill ${TONES[label] || ""}`}>{label}</span>;
}

export const TEMPLATE_LABELS = { modern: "Modern", classic: "Classic", minimal: "Minimal" };
export const VAT_STATUS_LABELS = { registered: "VAT registered", not_registered: "Not VAT registered", unknown: "Not known yet" };
export const ITEM_TYPE_LABELS = { service: "Service", product: "Product", labour: "Labour", device_plan: "Per device", user_plan: "Per user" };
export const UNIT_LABELS = { each: "each", hour: "hour", device: "device", user: "user", month: "month" };
