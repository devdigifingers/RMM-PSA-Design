export function deviceGroups(devices, customerId, contact) {
  const own = contact ? devices.filter((device) => device.customerId === customerId && device.contactId === contact.id) : [];
  const account = devices.filter((device) => device.customerId === customerId && !own.includes(device));
  const loose = devices.filter((device) => device.customerId == null);
  return [
    { label: contact ? `${contact.name}'s devices` : null, items: own },
    { label: contact ? "Other account devices" : "Account devices", items: account },
    { label: "Not linked to an account yet", items: loose },
  ].filter((group) => group.items.length);
}

export function defaultDevice(devices, customerId, contact) {
  if (!contact) return "";
  const own = devices.find((device) => device.customerId === customerId && device.contactId === contact.id);
  return own ? own.id : "";
}

export function DeviceOptions({ groups }) {
  return (
    <>
      <option value="">No specific device</option>
      {groups.map((group) => (
        <optgroup key={group.label || "devices"} label={group.label || "Devices"}>
          {group.items.map((device) => (
            <option key={device.id} value={device.id}>{device.hostname}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
