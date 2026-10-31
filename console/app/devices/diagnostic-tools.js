export const DIAGNOSTIC_TOOLS = [
  { id: "overview", label: "Device Overview", kind: "details" },
  { id: "timeline", label: "Timeline", kind: "timeline" },
  { id: "command", label: "Command Prompt", kind: "terminal" },
  { id: "tasks", label: "Task Manager", kind: "list" },
  { id: "services", label: "Services", kind: "list" },
  { id: "files", label: "File Manager", kind: "files" },
  { id: "events", label: "Event Viewer", kind: "list" },
  { id: "registry", label: "Registry Editor", kind: "live" },
  { id: "devmgr", label: "Device Manager", kind: "live" },
  { id: "scheduler", label: "Task Scheduler", kind: "live" },
  { id: "software", label: "Software", kind: "software" },
  { id: "updates", label: "Updates", kind: "updates" },
  { id: "hardware", label: "Hardware", kind: "hardware" },
  { id: "accounts", label: "Users", kind: "list" },
  { id: "printers", label: "Printers", kind: "list" },
  { id: "groups", label: "Groups", kind: "list" },
  { id: "shares", label: "Shares", kind: "list" },
];

export function diagnosticTool(id) {
  return DIAGNOSTIC_TOOLS.find((item) => item.id === id) || DIAGNOSTIC_TOOLS[0];
}
