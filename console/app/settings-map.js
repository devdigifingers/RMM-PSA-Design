// Settings menus spec: Organisation settings are shared by every app; each app has its own area.
// Item fields: href (null = Soon), manage (owner/admin only), needs (a flag from settingsAccess).

export const SETTINGS_AREAS = {
  remote: { key: "remote", label: "Remote Desk", title: "Remote Desk settings", root: "/remote/settings", app: "remote-desk", needs: "remote" },
  desk: { key: "desk", label: "Service Desk", title: "Service Desk settings", root: "/desk/settings", app: "service-desk", needs: "service" },
  org: { key: "org", label: "Organisation", title: "Organisation settings", root: "/settings/org", app: null, needs: null },
};

const soon = (label, extra) => ({ label, href: null, ...extra });

export const SETTINGS_SECTIONS = {
  org: [
    {
      title: "Organisation",
      icon: "org",
      items: [
        { label: "Organisation details", href: "/settings/org/details" },
        soon("Branding"),
        soon("Departments"),
        soon("Time zone and language"),
      ],
    },
    {
      title: "Users and access",
      icon: "users",
      items: [
        { label: "Manage technicians", href: "/settings/org/technicians", manage: true },
        soon("Roles and permissions", { manage: true }),
        soon("Teams", { manage: true }),
      ],
    },
    {
      title: "Billing",
      icon: "billing",
      items: [
        soon("Contracts", { manage: true }),
        { label: "Subscription and package", href: "/settings/org/subscription", manage: true },
        { label: "Offers", href: "/settings/org/offers" },
        soon("Billing and invoices", { manage: true }),
      ],
    },
    {
      title: "Security and compliance",
      icon: "shield",
      items: [
        soon("Password policy", { manage: true }),
        { label: "Multi-factor authentication (MFA)", href: "/settings/org/mfa" },
        { label: "IP-based restriction", href: "/settings/org/ip-restriction", manage: true },
        { label: "API tokens", href: "/settings/org/api-tokens", manage: true },
        { label: "Action log viewer", href: "/audit" },
        { label: "Data and privacy (POPIA)", href: "/settings/org/privacy" },
        soon("Data subject requests", { manage: true }),
        soon("Data cleanup", { manage: true }),
      ],
    },
    {
      title: "Data administration",
      icon: "data",
      items: [
        soon("Import", { manage: true }),
        soon("Export", { manage: true }),
        soon("Backup", { manage: true }),
        soon("Recycle bin", { manage: true }),
        { label: "Data migration", href: "/settings/org/migrations", manage: true },
      ],
    },
    {
      title: "Integrations and developer",
      icon: "plug",
      items: [
        soon("Webhooks", { manage: true }),
        soon("Apps marketplace", { manage: true }),
        soon("Microsoft / Google sign-in", { manage: true }),
      ],
    },
    {
      title: "My account",
      icon: "user",
      items: [
        { label: "Profile and password", href: "/settings/org/account" },
        soon("Notification preferences"),
      ],
    },
  ],
  remote: [
    {
      title: "Remote support",
      icon: "headset",
      items: [
        { label: "Quick Support", href: "/support", needs: "support" },
        soon("Session confirmation", { manage: true }),
        soon("Session recording", { manage: true }),
        soon("Customer widget", { manage: true }),
        soon("Self-service join page", { manage: true }),
      ],
    },
    {
      title: "Unattended access",
      icon: "monitor",
      items: [
        { label: "Deployment and agent installers", href: "/remote/settings/deployment", manage: true },
        soon("Agent update policy", { manage: true }),
        soon("Groups", { manage: true }),
        soon("Wake on LAN", { manage: true }),
        soon("Device cleanup policy", { manage: true }),
      ],
    },
    {
      title: "Monitoring and alerts",
      icon: "bell",
      items: [
        { label: "Alert rules", href: "/alerts", needs: "alerts" },
        soon("Alert notifications", { manage: true, needs: "alerts" }),
        soon("Alert-to-ticket mapping", { manage: true, needs: "service" }),
      ],
    },
    {
      title: "Patch management",
      icon: "patch",
      items: [
        { label: "Patch policies", href: "/patches", needs: "patches" },
        soon("Maintenance windows", { manage: true, needs: "patches" }),
        soon("Approval rings", { manage: true, needs: "patches" }),
      ],
    },
    {
      title: "Scripts and commands",
      icon: "terminal",
      items: [
        { label: "Script library", href: "/remote/settings/scripts" },
        soon("Allowed commands per role", { manage: true }),
      ],
    },
    {
      title: "Reports",
      icon: "chart",
      items: [{ label: "Scheduled reports", href: "/reports/exports", needs: "reports" }],
    },
  ],
  desk: [
    {
      title: "Channels",
      icon: "mail",
      items: [
        { label: "Email", href: "/desk/settings/email" },
        soon("Phone", { manage: true }),
        soon("Web forms", { manage: true }),
        soon("Customer portal (Help Center)", { manage: true }),
        soon("Chat / WhatsApp", { manage: true }),
      ],
    },
    {
      title: "Ticket setup",
      icon: "ticket",
      items: [
        { label: "Statuses", href: "/desk/settings/ticket-setup#statuses" },
        { label: "Priorities", href: "/desk/settings/ticket-setup#priorities" },
        { label: "Categories and types", href: "/desk/settings/ticket-setup#categories" },
        { label: "Tags", href: "/desk/settings/ticket-setup#tags" },
        soon("Ticket fields and layouts", { manage: true }),
        soon("Ticket templates", { manage: true }),
      ],
    },
    {
      title: "Service levels",
      icon: "clock",
      items: [
        { label: "SLA targets and plans", href: "/desk/settings/service-levels" },
        soon("Escalations", { manage: true }),
        { label: "Business hours and holidays", href: "/desk/settings/business-hours" },
      ],
    },
    {
      title: "Automation",
      icon: "zap",
      items: [
        { label: "Workflows and assignment rules", href: "/desk/settings/automations" },
        { label: "Auto-close and alert tickets", href: "/desk/settings/automations#options" },
        soon("Macros", { manage: true }),
        soon("Supervisor rules", { manage: true }),
        { label: "Canned replies", href: "/desk/settings/canned-replies" },
      ],
    },
    {
      title: "Communication",
      icon: "message",
      items: [
        soon("Email templates", { manage: true }),
        { label: "Notification rules", href: "/desk/settings/notifications" },
        { label: "Signatures and email branding", href: "/desk/settings/automations#options" },
      ],
    },
    {
      title: "Customer happiness (CSAT)",
      icon: "smile",
      items: [
        { label: "Survey / CSAT", href: "/desk/settings/automations#options" },
        { label: "Happiness report", href: "/reports" },
      ],
    },
    {
      title: "Time tracking",
      icon: "timer",
      items: [soon("Billable defaults and rounding", { manage: true })],
    },
    {
      title: "Knowledge base",
      icon: "book",
      items: [
        soon("Articles and categories", { manage: true }),
        soon("Article numbering", { manage: true }),
      ],
    },
  ],
};

// access: { manage, remote, service, support, alerts, patches, reports }
export function areasFor(access) {
  return Object.values(SETTINGS_AREAS).filter((area) => !area.needs || access[area.needs]);
}

export function visibleSections(areaKey, access) {
  const area = SETTINGS_AREAS[areaKey];
  if (!area || (area.needs && !access[area.needs])) return [];
  return (SETTINGS_SECTIONS[areaKey] || [])
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.manage || access.manage) && (!item.needs || access[item.needs])),
    }))
    .filter((section) => section.items.length);
}

export function searchSections(sections, term) {
  const needle = term.trim().toLowerCase();
  if (!needle) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => `${section.title} ${item.label}`.toLowerCase().includes(needle)),
    }))
    .filter((section) => section.items.length);
}

// The settings area for a page: the app in the URL when the tenant has it, else the remembered app, else Organisation.
export function areaForApp(appKey, access) {
  if (appKey === "service" && access.service) return "desk";
  if (appKey === "remote" && access.remote) return "remote";
  if (access.remote) return "remote";
  if (access.service) return "desk";
  return "org";
}

export function findSetting(href) {
  for (const [areaKey, sections] of Object.entries(SETTINGS_SECTIONS)) {
    for (const section of sections) {
      const item = section.items.find((entry) => entry.href === href);
      if (item) return { area: SETTINGS_AREAS[areaKey], section, item };
    }
  }
  return null;
}
