"use client";

import { useState } from "react";
import { saveDeskSetting } from "../../../actions";

const PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
const STATUSES = [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"]];
const CHANNELS = [["email", "Email"], ["phone", "Phone"], ["walk_in", "Walk-in"], ["portal", "Portal"], ["remote", "Remote session"], ["console", "Console"], ["alert", "Alert"], ["automatic", "Automatic"]];
const FIELDS = [
  ["priority", "Priority"],
  ["status", "Status"],
  ["channel", "Channel"],
  ["category", "Category"],
  ["customer", "Customer"],
  ["plan", "SLA plan"],
  ["subject", "Subject"],
  ["tag", "Tag"],
];
const OPS = {
  subject: [["contains", "contains"], ["not_contains", "does not contain"]],
  tag: [["has", "has"], ["has_not", "does not have"]],
};
const DEFAULT_OPS = [["is", "is"], ["is_not", "is not"]];
const ACTIONS = [
  ["set_priority", "Set priority"],
  ["set_status", "Set status"],
  ["set_category", "Set category"],
  ["add_tag", "Add tag"],
  ["assign", "Assign to"],
];

function choicesFor(kind, lists) {
  switch (kind) {
    case "priority": case "set_priority": return PRIORITIES;
    case "status": case "set_status": return STATUSES;
    case "channel": return CHANNELS;
    case "customer": return lists.customers.map((item) => [String(item.id), item.name]);
    case "plan": return lists.plans.map((item) => [String(item.id), item.name]);
    case "assign": return lists.users.map((item) => [String(item.id), item.name]);
    default: return null;
  }
}

function ValueInput({ kind, value, onChange, lists, label }) {
  const choices = choicesFor(kind, lists);
  if (choices) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        <option value="">Choose</option>
        {choices.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    );
  }
  const list = kind === "category" || kind === "set_category" ? "automation-categories" : kind === "tag" || kind === "add_tag" ? "automation-tags" : undefined;
  return <input value={value} onChange={(event) => onChange(event.target.value)} list={list} maxLength={100} aria-label={label} />;
}

export function AutomationForm({ rule, lists, canEdit }) {
  const [conditions, setConditions] = useState(rule?.conditions?.length ? rule.conditions : []);
  const [actions, setActions] = useState(rule?.actions?.length ? rule.actions : [{ type: "set_priority", value: "" }]);
  const edit = (setter, list, index, patch) => setter(list.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  return (
    <form className="stack desk-one automation-form" action={saveDeskSetting}>
      <input type="hidden" name="form" value={rule ? "automationUpdate" : "automationCreate"} />
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <input type="hidden" name="anchor" value={rule ? `rule-${rule.id}` : "new-rule"} />
      <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />
      <input type="hidden" name="actions" value={JSON.stringify(actions)} />
      <div className="automation-head">
        <label>
          Name
          <input name="name" defaultValue={rule?.name || ""} maxLength={80} required placeholder="e.g. Urgent for Gold customers" />
        </label>
        <label>
          When
          <select name="trigger" defaultValue={rule?.trigger || "created"}>
            <option value="created">A ticket is created</option>
            <option value="updated">A ticket is updated</option>
          </select>
        </label>
        <label>
          Order
          <input name="position" type="number" min="0" max="999" defaultValue={rule?.position ?? 0} />
        </label>
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={rule ? rule.enabled : true} />
          On
        </label>
      </div>

      <fieldset className="automation-rows">
        <legend>If all of these match {conditions.length ? null : <span className="org-name">(no conditions: every ticket)</span>}</legend>
        {conditions.map((item, index) => (
          <div key={index} className="automation-row">
            <select value={item.field} aria-label="Field" onChange={(event) => edit(setConditions, conditions, index, { field: event.target.value, op: (OPS[event.target.value] || DEFAULT_OPS)[0][0], value: "" })}>
              {FIELDS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <select value={item.op} aria-label="Comparison" onChange={(event) => edit(setConditions, conditions, index, { op: event.target.value })}>
              {(OPS[item.field] || DEFAULT_OPS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <ValueInput kind={item.field} value={item.value} lists={lists} label="Value" onChange={(value) => edit(setConditions, conditions, index, { value })} />
            <button type="button" className="danger-link" onClick={() => setConditions(conditions.filter((_, at) => at !== index))}>Remove</button>
          </div>
        ))}
        {conditions.length < 10 ? (
          <button type="button" className="link-button" onClick={() => setConditions([...conditions, { field: "priority", op: "is", value: "" }])}>+ Add condition</button>
        ) : null}
      </fieldset>

      <fieldset className="automation-rows">
        <legend>Then</legend>
        {actions.map((item, index) => (
          <div key={index} className="automation-row">
            <select value={item.type} aria-label="Action" onChange={(event) => edit(setActions, actions, index, { type: event.target.value, value: "" })}>
              {ACTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <ValueInput kind={item.type} value={item.value} lists={lists} label="Action value" onChange={(value) => edit(setActions, actions, index, { value })} />
            {actions.length > 1 ? (
              <button type="button" className="danger-link" onClick={() => setActions(actions.filter((_, at) => at !== index))}>Remove</button>
            ) : null}
          </div>
        ))}
        {actions.length < 10 ? (
          <button type="button" className="link-button" onClick={() => setActions([...actions, { type: "add_tag", value: "" }])}>+ Add action</button>
        ) : null}
      </fieldset>
      {canEdit ? <button type="submit">{rule ? "Save Automation" : "Add Automation"}</button> : null}
    </form>
  );
}
