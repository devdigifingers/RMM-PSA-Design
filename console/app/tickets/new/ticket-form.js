"use client";

import { useState } from "react";
import { createTicket } from "../../actions";
import { defaultDevice, DeviceOptions, deviceGroups } from "../device-options";

export function NewTicketForm({ customers, devices, users, me, initialCustomer }) {
  const start = customers.some((customer) => customer.id === initialCustomer) ? initialCustomer : customers[0].id;
  const [customerId, setCustomerId] = useState(start);
  const customer = customers.find((item) => item.id === customerId) || customers[0];
  const contacts = customer.contacts || [];
  const [contactId, setContactId] = useState(() => contacts.find((item) => item.primary)?.id || "");
  const contact = contacts.find((item) => item.id === contactId) || null;
  const groups = deviceGroups(devices, customerId, contact);

  function pickCustomer(value) {
    const next = customers.find((item) => item.id === value);
    setCustomerId(value);
    setContactId(next?.contacts?.find((item) => item.primary)?.id || "");
  }

  return (
    <form className="stack" action={createTicket}>
      <label>
        Subject
        <input name="subject" required maxLength={200} />
      </label>
      <label>
        Account
        <select name="customerId" required value={customerId} onChange={(event) => pickCustomer(Number(event.target.value))}>
          {customers.map((item) => (
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
      <label>
        Affected device
        <select name="deviceId" key={`device-${customerId}-${contactId}`} defaultValue={defaultDevice(devices, customerId, contact)}>
          <DeviceOptions groups={groups} />
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue="open">
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      <label>
        Priority
        <select name="priority" defaultValue="normal">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
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
      <button type="submit">Create Ticket</button>
    </form>
  );
}
