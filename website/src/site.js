// Shared constants and link helpers for the public website.

export const SITE_URL = "https://digitalfingers.co.za";
export const CONSOLE_URL = "https://rmm.digitalfingers.co.za/";
export const ENQUIRY_URL = import.meta.env.PUBLIC_ENQUIRY_URL || "https://api.digitalfingers.co.za/v1/public/enquiry";
export const ANALYTICS_SRC = import.meta.env.PUBLIC_ANALYTICS_SRC || "";
export const BRAND_VERSION = "c1";
export const PREVIEW = import.meta.env.BASE_URL.replace(/\/+$/, "") !== "";

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

// A site path such as "/pricing/" or "/signup/?module=suite", with the preview base in front when there is one.
export function href(path = "/") {
  return `${BASE}${path}`;
}

export function asset(path) {
  return `${BASE}${path}`;
}

export function brand(path) {
  return `${BASE}${path}?v=${BRAND_VERSION}`;
}

export const NAV = [
  {
    label: "Solutions",
    path: "/solutions/",
    children: [
      { label: "Invoicing", path: "/solutions/invoicing/", note: "Quotes, tax invoices and invoice links" },
      { label: "Remote support", path: "/solutions/remote-support/", note: "Remote Desk and the session panel" },
      { label: "Service Desk", path: "/solutions/service-desk/", note: "Tickets, in the Full Suite" },
      { label: "Full Suite", path: "/pricing/#suite", note: "Everything together, one account" },
    ],
  },
  { label: "Custom software", path: "/custom-software/" },
  { label: "Pricing", path: "/pricing/" },
  { label: "About", path: "/about/" },
  { label: "Support", path: "/support/" },
];

export const PACKAGES = [
  {
    key: "invoicing",
    name: "Invoicing",
    icon: "/apps/billing.svg",
    who: "Freelancers, sole traders and small shops. Upgrade to Pro later for payments and automation.",
    amount: "Free",
    small: "Core plan · Pro price TBC",
    free: true,
    items: [
      "100 invoices and 300 invoice emails a month",
      "Tax invoices, quotes and credit notes, 15% VAT",
      "A secure online link to send your customer",
      "Your logo and details on every document",
      "Unlimited customers",
    ],
    cta: "Start free",
  },
  {
    key: "remote-support",
    name: "Remote Support",
    icon: "/apps/remote-desk.svg",
    who: "For teams who look after other people's computers, with invoicing included.",
    amount: "Price TBC",
    small: "ZAR / month, excl. VAT 15% · placeholder",
    items: [
      "Digital Fingers Remote Desk",
      "Customer session panel and installed agent",
      "Invoicing Free included",
      "Seats and devices: TBC",
    ],
    cta: "Get started",
  },
  {
    key: "suite",
    name: "Full Suite",
    icon: "/apps/service-desk.svg",
    who: "Remote Desk, Service Desk and invoicing with MSP billing, in one tenant.",
    amount: "Price TBC",
    small: "ZAR / month, excl. VAT 15% · placeholder",
    items: [
      "Everything in Remote Support",
      "Service Desk tickets and shared customers",
      "MSP billing from time, sessions and devices",
      "Seats and devices: TBC",
    ],
    cta: "Get started",
  },
];

export const PAGES = [
  "/", "/solutions/", "/solutions/invoicing/", "/solutions/remote-support/", "/solutions/service-desk/",
  "/custom-software/", "/pricing/", "/about/", "/contact/", "/support/", "/signup/", "/privacy/", "/terms/",
];
