// Pure rule matching for Service Desk automations: no database access.

export const AUTOMATION_TRIGGERS = ["created", "updated"];
export const CONDITION_FIELDS = {
  priority: ["is", "is_not"],
  status: ["is", "is_not"],
  channel: ["is", "is_not"],
  category: ["is", "is_not"],
  customer: ["is", "is_not"],
  plan: ["is", "is_not"],
  subject: ["contains", "not_contains"],
  tag: ["has", "has_not"],
};
export const ACTION_TYPES = ["set_priority", "set_status", "set_category", "add_tag", "assign"];
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const STATUSES = new Set(["open", "pending", "resolved"]);
const MAX_RULE_PARTS = 10;

function text(value, max) {
  const item = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value == null ? "" : String(value).trim();
  return item && item.length <= max ? item : null;
}

export function parseAutomation(body) {
  const name = text(body?.name, 80);
  if (!name) return { error: "Name the automation (up to 80 characters)." };
  if (!AUTOMATION_TRIGGERS.includes(body.trigger)) return { error: "Choose when the automation runs." };
  const rawConditions = Array.isArray(body.conditions) ? body.conditions : [];
  const rawActions = Array.isArray(body.actions) ? body.actions : [];
  if (rawConditions.length > MAX_RULE_PARTS || rawActions.length > MAX_RULE_PARTS) {
    return { error: `Use up to ${MAX_RULE_PARTS} conditions and ${MAX_RULE_PARTS} actions.` };
  }
  const conditions = [];
  for (const item of rawConditions) {
    const ops = CONDITION_FIELDS[item?.field];
    if (!ops || !ops.includes(item.op)) return { error: "One of the conditions is not complete." };
    const value = text(item.value, 100);
    if (!value) return { error: "Give every condition a value." };
    if (item.field === "priority" && !PRIORITIES.has(value)) return { error: "Choose a priority." };
    if (item.field === "status" && !STATUSES.has(value)) return { error: "Choose a status." };
    if ((item.field === "customer" || item.field === "plan") && !/^\d{1,18}$/.test(value)) return { error: "Choose a customer or plan." };
    conditions.push({ field: item.field, op: item.op, value });
  }
  const actions = [];
  for (const item of rawActions) {
    if (!ACTION_TYPES.includes(item?.type)) return { error: "One of the actions is not complete." };
    const value = text(item.value, 60);
    if (!value) return { error: "Give every action a value." };
    if (item.type === "set_priority" && !PRIORITIES.has(value)) return { error: "Choose a priority to set." };
    if (item.type === "set_status" && !STATUSES.has(value)) return { error: "Choose a status to set." };
    if (item.type === "assign" && !/^\d{1,18}$/.test(value)) return { error: "Choose who to assign." };
    actions.push({ type: item.type, value });
  }
  if (!actions.length) return { error: "Add at least one action." };
  const position = Number.isInteger(Number(body.position)) ? Math.max(0, Math.min(999, Number(body.position))) : 0;
  return { value: { name, trigger: body.trigger, conditions, actions, enabled: body.enabled !== false, position } };
}

function fieldValue(ticket, field) {
  switch (field) {
    case "customer": return ticket.customer_id == null ? "" : String(ticket.customer_id);
    case "plan": return ticket.plan_id == null ? "" : String(ticket.plan_id);
    case "category": return String(ticket.category || "").toLowerCase();
    default: return String(ticket[field] ?? "").toLowerCase();
  }
}

export function conditionMatches(ticket, condition) {
  const expected = String(condition.value).toLowerCase();
  if (condition.field === "subject") {
    const found = String(ticket.subject || "").toLowerCase().includes(expected);
    return condition.op === "contains" ? found : !found;
  }
  if (condition.field === "tag") {
    const found = (ticket.tags || []).some((tag) => String(tag).toLowerCase() === expected);
    return condition.op === "has" ? found : !found;
  }
  const same = fieldValue(ticket, condition.field) === expected;
  return condition.op === "is" ? same : !same;
}

export function ruleMatches(ticket, rule) {
  return rule.enabled !== false && (rule.conditions || []).every((condition) => conditionMatches(ticket, condition));
}

// Runs rules in order on a copy of the ticket; later rules see earlier changes.
export function applyAutomations(ticket, rules) {
  const next = { ...ticket, tags: [...(ticket.tags || [])] };
  const fired = [];
  for (const rule of rules) {
    if (!ruleMatches(next, rule)) continue;
    const changes = [];
    for (const action of rule.actions || []) {
      if (action.type === "set_priority" && next.priority !== action.value) {
        next.priority = action.value;
        changes.push(action);
      } else if (action.type === "set_status" && next.status !== action.value) {
        next.status = action.value;
        changes.push(action);
      } else if (action.type === "set_category" && next.category !== action.value) {
        next.category = action.value;
        changes.push(action);
      } else if (action.type === "add_tag" && !next.tags.some((tag) => tag.toLowerCase() === action.value.toLowerCase()) && next.tags.length < 10) {
        next.tags.push(action.value);
        changes.push(action);
      } else if (action.type === "assign" && String(next.assignee_user_id ?? "") !== action.value) {
        next.assignee_user_id = action.value;
        changes.push(action);
      }
    }
    if (changes.length) fired.push({ id: rule.id, name: rule.name, changes });
  }
  return { ticket: next, fired };
}
