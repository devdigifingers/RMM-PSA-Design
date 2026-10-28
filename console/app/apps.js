export const APPS_V = "s1";

const assets = (id, lockupWidth) => ({
  lockupRatio: lockupWidth / 120,
  icon: `/apps/${id}.svg?v=${APPS_V}`,
  smallIcon: `/apps/${id}-small.svg?v=${APPS_V}`,
  lockup: {
    dark: `/apps/lockups/${id}-lockup-dark.svg?v=${APPS_V}`,
    light: `/apps/lockups/${id}-lockup-light.svg?v=${APPS_V}`,
  },
});

// `key` is the df_app cookie value; `entitlementKey` is the package app it needs; `paths` are the routes that belong to the app.
export const APPS = [
  { id: "remote-desk", key: "remote", entitlementKey: "remote", name: "Remote Desk", description: "Remote monitoring and support", route: "/devices", paths: ["/support", "/devices", "/dashboard", "/alerts", "/patches", "/remote"], status: "live", ...assets("remote-desk", 447) },
  { id: "service-desk", key: "service", entitlementKey: "servicedesk", name: "Service Desk", description: "Tickets and customer support", route: "/tickets", paths: ["/tickets", "/desk"], status: "live", ...assets("service-desk", 432) },
  { id: "monitoring", key: "monitoring", entitlementKey: "remote", name: "Monitoring", description: "Alerts and health checks", route: null, paths: [], status: "soon", ...assets("monitoring", 392) },
  { id: "billing", key: "billing", entitlementKey: null, name: "Billing", description: "Quotes and invoicing", route: null, paths: [], status: "soon", ...assets("billing", 323) },
  { id: "reports", key: "reports", entitlementKey: "reporting", name: "Reports", description: "Reports and backups", route: null, paths: [], status: "soon", ...assets("reports", 323) },
];

export const SHOW_SOON = false;

export function appById(id) {
  return APPS.find((app) => app.id === id || app.key === id) || null;
}

export function appForPath(path) {
  return APPS.find((app) => app.status === "live" && app.paths.some((root) => path === root || path.startsWith(`${root}/`))) || null;
}
