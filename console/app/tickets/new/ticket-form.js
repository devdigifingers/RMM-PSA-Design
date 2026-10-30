"use client";

import { useEffect, useState } from "react";
import { createTicket, previewTicket } from "../../actions";
import { defaultDevice, DeviceOptions, deviceGroups } from "../device-options";
import { FileDrop } from "../file-drop";
import { CHANNEL_CHOICES, dueInputValue, dueLabel, PRIORITY_KEYS, StatusOptions } from "../ticket-fields";

export function NewTicketForm({ customers, devices, users, me, initialCustomer, statuses = [], priorityLabels = {}, categories = [], tags = [] }) {
  const start = customers.some((customer) => customer.id === initialCustomer) ? initialCustomer : customers[0].id;
  const [customerId, setCustomerId] = useState(start);
  const customer = customers.find((item) => item.id === customerId) || customers[0];
  const contacts = customer.contacts || [];
  const [contactId, setContactId] = useState(() => contacts.find((item) => item.primary)?.id || "");
  const contact = contacts.find((item) => item.id === contactId) || null;
  const groups = deviceGroups(devices, customerId, contact);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("normal");
  const [preview, setPreview] = useState({ dueAt: null, similar: [] });
  const [override, setOverride] = useState(false);
  const [cc, setCc] = useState([]);
  const needle = find.trim().toLowerCase();
  const matches = needle ? customers.filter((item) => item.name.toLowerCase().includes(needle)) : customers;
  const shown = matches.some((item) => item.id === customerId) ? matches : [customer, ...matches];

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      previewTicket(customerId, priority, subject).then((result) => {
        if (live) setPreview(result);
      }).catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [customerId, priority, subject]);

  function pickCustomer(value) {
    const next = customers.find((item) => item.id === value);
    setCustomerId(value);
    setContactId(next?.contacts?.find((item) => item.primary)?.id || "");
    setCc([]);
  }

  function search(value) {
    setFind(value);
    const term = value.trim().toLowerCase();
    const first = term ? customers.find((item) => item.name.toLowerCase().includes(term)) : null;
    if (first && first.id !== customerId) pickCustomer(first.id);
  }

  function toggleCc(id) {
    setCc((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

  const ccChoices = contacts.filter((item) => item.id !== contactId);

  return (
    <form className="stack" action={createTicket}>
      <label>
        Subject
        <input name="subject" required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      {preview.similar.length ? (
        <div className="ticket-similar" role="status">
          <strong>Possible duplicate{preview.similar.length === 1 ? "" : "s"} for this customer</strong>
          <ul>
            {preview.similar.map((item) => (
              <li key={item.id}>
                <a href={`/tickets/${item.id}`} target="_blank" rel="noopener noreferrer">#{item.id} {item.subject}</a>
                <span> ({item.status})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="ticket-customer">
        <span>Customer</span>
        <input type="search" placeholder="Search customers" value={find} onChange={(event) => search(event.target.value)} aria-label="Search customers" />
        <select name="customerId" required value={customerId} onChange={(event) => pickCustomer(Number(event.target.value))}>
          {shown.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <label>
        Contact
        <select name="contactId" value={contactId} onChange={(event) => setContactId(event.target.value ? Number(event.target.value) : "")}>
          <option value="">No contact</option>
          {contacts.map((item) => (
            <option key={item.id} value={item.id}>{item.primary ? `${item.name} (primary)` : item.name}</option>
          ))}
        </select>
      </label>
      {ccChoices.length ? (
        <fieldset className="ticket-cc">
          <legend>CC contacts</legend>
          {ccChoices.map((item) => (
            <label key={item.id} className="check">
              <input type="checkbox" name="cc" value={item.id} checked={cc.includes(item.id)} onChange={() => toggleCc(item.id)} />
              {item.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <label>
        Affected device
        <select name="deviceId" key={`device-${customerId}-${contactId}`} defaultValue={defaultDevice(devices, customerId, contact)}>
          <DeviceOptions groups={groups} />
        </select>
      </label>
      <label>
        Channel
        <select name="channel" defaultValue="phone">
          {CHANNEL_CHOICES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue="open">
          <StatusOptions statuses={statuses} />
        </select>
      </label>
      <label>
        Priority
        <select name="priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
          {PRIORITY_KEYS.map((key) => (
            <option key={key} value={key}>{priorityLabels[key] || key}</option>
          ))}
        </select>
      </label>
      <div className="ticket-due">
        <span>Due</span>
        <p className="org-name">
          {preview.dueAt
            ? <>From the SLA: <strong>{dueLabel(preview.dueAt)}</strong>{preview.businessHours ? " (business hours)" : ""}</>
            : "No SLA target, so there is no due date unless you set one."}
        </p>
        <label className="check">
          <input type="checkbox" name="dueOverride" checked={override} onChange={(event) => setOverride(event.target.checked)} />
          Set a different due date
        </label>
        {override ? (
          <input type="datetime-local" name="dueAt" required defaultValue={dueInputValue(preview.dueAt)} aria-label="Due date and time" />
        ) : null}
      </div>
      <label>
        Category
        <input name="category" maxLength={60} list="ticket-category-choices" placeholder="None" />
        <datalist id="ticket-category-choices">
          {categories.map((item) => <option key={item} value={item} />)}
        </datalist>
      </label>
      <label>
        Tags
        <input name="tags" maxLength={400} placeholder="Comma separated" list="ticket-tag-choices" />
        <datalist id="ticket-tag-choices">
          {tags.map((item) => <option key={item} value={item} />)}
        </datalist>
      </label>
      <label>
        Ticket owner
        <select name="assigneeUserId" defaultValue={me || ""}>
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.name}</option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea name="comment" maxLength={4000} />
      </label>
      <div className="ticket-attach">
        <span>Attachments</span>
        <FileDrop onBusy={setBusy} />
      </div>
      <button type="submit" disabled={busy}>{busy ? "Uploading…" : "Create Ticket"}</button>
    </form>
  );
}
