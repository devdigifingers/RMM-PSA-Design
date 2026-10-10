import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function accountFromSession() {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/account`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) return null;
  return response.json();
}

export function formatWhen(value) {
  if (!value) return "No date set";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
  }).format(new Date(value));
}

export function included(value) {
  return value ? "Included" : "Not included";
}

export function navFlags(account) {
  if (account?.user?.isPlatformAdmin) return { platform: true };
  const license = account?.license;
  return {
    showTickets: Boolean(license?.ticketing),
    showAlerts: Boolean(license?.monitoring),
    showPatches: Boolean(license?.patch),
    showDashboard: Boolean(license?.reporting),
    showLicenses: Boolean(license?.reporting),
  };
}

export function dateInputValue(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
