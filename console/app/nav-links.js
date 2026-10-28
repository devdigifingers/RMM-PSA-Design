"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { appForPath as suiteAppForPath } from "./apps";

export function appForPath(path) {
  return suiteAppForPath(path)?.key || null;
}

// Which app's customer view to link to: the app in the URL when the package has it, else whichever one it has.
function customersHref(app, customers) {
  if (!customers?.remote && !customers?.desk) return null;
  if (app === "service" && customers.desk) return "/desk/customers";
  if (app === "remote" && customers.remote) return "/remote/customers";
  return customers.remote ? "/remote/customers" : "/desk/customers";
}

export function NavLinks({ links, serviceLinks, customers = null, lastApp, label }) {
  const path = usePathname() || "";
  const fromPath = appForPath(path);
  const app = fromPath || lastApp;

  useEffect(() => {
    if (fromPath) document.cookie = `df_app=${fromPath}; path=/; max-age=31536000; samesite=lax`;
  }, [fromPath]);

  const shown = app === "service" && serviceLinks ? serviceLinks : links;
  const customersLink = customersHref(app, customers);
  const shared = customersLink ? [[customersLink, "Customers", "/customers"]] : [];
  const item = ([href, text, icon]) => {
    const on = path === href || path.startsWith(`${href}/`);
    return (
      <Link key={href} href={href} className={on ? "is-active" : undefined} aria-current={on ? "page" : undefined}>
        {ICONS[icon || href] || ICONS["/devices"]}
        <span>{text}</span>
      </Link>
    );
  };
  return (
    <nav className="app-rail" aria-label={label || (app === "service" ? "Service Desk" : "Remote Desk")}>
      {shown.map(item)}
      {shown.length && shared.length ? <span className="app-rail-sep" aria-hidden="true" /> : null}
      {shared.map(item)}
    </nav>
  );
}

export function BrandLink({ platform, allowed, lastApp, children }) {
  const app = appForPath(usePathname() || "") || lastApp;
  let href = "/customers";
  if (platform) href = "/control/tenants";
  else if (app === "service" && allowed.service) href = "/tickets";
  else if (allowed.remote) href = "/devices";
  else if (allowed.service) href = "/tickets";
  return (
    <Link className="brand-plate" href={href} aria-label="Digital Fingers home">
      {children}
    </Link>
  );
}

// Outline icons from Lucide (https://lucide.dev), ISC license.
// Copyright (c) Cole Bemis 2013-2022 as part of Feather, and Lucide Contributors 2022.
const ICONS = {
  "/support": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  ),
  "/devices": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect className="solid" x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  "/dashboard": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect className="solid" x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect className="solid" x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  "/alerts": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3" />
      <path d="M10.3 21a2 2 0 0 0 3.4 0" />
    </svg>
  ),
  "/patches": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  "/audit": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" />
    </svg>
  ),
  "/tickets": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  ),
  "/customers": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" />
    </svg>
  ),
  "/control/tenants": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" />
    </svg>
  ),
  "/control/packages": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12M3.3 7 12 12l8.7-5M7.5 4.27l9 5.15" />
    </svg>
  ),
  "/control/notices": (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="solid" d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z" />
      <path d="M16 9a4 4 0 0 1 0 6M19.4 6a8 8 0 0 1 0 12" />
    </svg>
  ),
};
ICONS["/control/audit"] = ICONS["/audit"];
