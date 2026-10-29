// Customers are one record per tenant, shown differently per app.
// "remote" (Remote Desk) and "desk" (Service Desk) each need their app on the package; "" is the neutral list used by pickers.
export function resolveCustomerView(value, access) {
  const view = String(value || "");
  if (view === "") return { view };
  if (view !== "remote" && view !== "desk") return { status: 400, body: { error: "Unknown customer view." } };
  const remote = view === "remote";
  if (remote ? !access.remote : !access.service) {
    return {
      status: 403,
      body: {
        error: `${remote ? "Remote Desk" : "Service Desk"} is not in your package.`,
        code: "app_not_entitled",
        app: remote ? "remote" : "servicedesk",
      },
    };
  }
  return { view };
}

// Which app's data a response may carry. The neutral view keeps the old behaviour: whatever the package includes.
export function viewScope(view, access) {
  return {
    remote: view === "remote" || (view === "" && access.remote),
    desk: view === "desk" || (view === "" && access.service),
  };
}

export function listFields(row, view, access) {
  const scope = viewScope(view, access);
  return {
    ...(scope.remote ? { deviceCount: row.device_count } : {}),
    ...(view === "remote" ? { onlineCount: row.online_count, lastSessionAt: row.last_session_at } : {}),
    ...(scope.desk ? { openTicketCount: row.open_ticket_count } : {}),
    ...(view === "desk" ? { overdueCount: row.overdue_count, slaPlan: slaPlanName(row) } : {}),
  };
}

export function slaPlanName(row) {
  if (row.sla_plan_name) return row.sla_plan_name;
  return row.has_default_sla ? "Default" : null;
}

// A customer without a plan, or whose plan was deleted, falls back to the tenant default.
export function slaFor(book, planId) {
  return (planId != null && book.plans.get(String(planId))) || book.base;
}

export function ticketDue(row, sla) {
  if (!sla || row.status === "resolved") return null;
  return new Date(new Date(row.created_at).getTime() + sla.resolveMinutes * 60000);
}

// The one overdue rule: not resolved and past the resolution target. Dashboard, ticket list and customer pages all use it.
export function isOverdue(row, sla, now = new Date()) {
  const due = ticketDue(row, sla);
  return due ? due.getTime() < now.getTime() : false;
}

// node-postgres parses a `date` column as local midnight, so read it back with local fields.
export function dateOnly(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
