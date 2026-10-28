import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function accountFromSession({ allowMfaSetup = false } = {}) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/account`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) return null;
  const account = await response.json();
  if (account.user?.mfaSetupRequired && !allowMfaSetup) redirect("/settings/mfa");
  return account;
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

export function entitlements(account) {
  const license = account?.license;
  const active = license?.active === true;
  return {
    active,
    apps: active ? license.apps || [] : [],
    features: active ? license.features || [] : [],
  };
}

export function hasFeature(account, feature) {
  return entitlements(account).features.includes(feature);
}

export function hasApp(account, app) {
  return entitlements(account).apps.includes(app);
}

export function homeFor(account) {
  if (account?.user?.isPlatformAdmin) return "/control";
  if (hasApp(account, "remote")) return "/devices";
  if (hasApp(account, "servicedesk")) return "/tickets";
  return "/customers";
}

export function navFlags(account) {
  if (account?.user?.isPlatformAdmin) return { platform: true };
  return {
    showTickets: hasFeature(account, "ticketing"),
    showAlerts: hasFeature(account, "monitoring"),
    showPatches: hasFeature(account, "patching"),
    showDashboard: hasFeature(account, "reporting"),
  };
}

export function licenseStatus(license, subject = "Your") {
  if (!license) return { seats: null, devices: null, daysLeft: null, warnings: [] };
  const seats = meter(license.seatsUsed, license.seats);
  const devices = meter(license.deviceCount, license.deviceCap);
  const daysLeft = license.expiresAt ? Math.ceil((new Date(license.expiresAt).getTime() - Date.now()) / 86400000) : null;
  const warnings = [];
  if (license.status === "suspended") {
    warnings.push({ level: "full", text: `${subject} license is suspended.` });
  } else if (daysLeft != null && daysLeft <= 0) {
    warnings.push({ level: "full", text: `${subject} license has expired.` });
  } else if (daysLeft != null && daysLeft <= 30) {
    warnings.push({ level: "near", text: `${subject} license expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` });
  }
  if (devices.level === "full") {
    warnings.push({ level: "full", text: `All ${devices.total} devices on the license are in use. New devices cannot be enrolled.` });
  } else if (devices.level === "near") {
    warnings.push({ level: "near", text: `${devices.used} of ${devices.total} devices on the license are in use.` });
  }
  if (seats.level === "full") {
    warnings.push({ level: "full", text: `All ${seats.total} seats on the license are in use. New users cannot be added.` });
  } else if (seats.level === "near") {
    warnings.push({ level: "near", text: `${seats.used} of ${seats.total} seats on the license are in use.` });
  }
  return { seats, devices, daysLeft, warnings };
}

function meter(used, total) {
  const count = Number(used) || 0;
  const limit = Number(total) || 0;
  const level = count >= limit ? "full" : count >= limit * 0.9 ? "near" : "ok";
  return { used: count, total: limit, percent: limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 100, level };
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
