// State of the remote support (Mesh) agent as the device agent reports it with each heartbeat.
export const REMOTE_STATES = ["running", "stopped", "missing", "repairing", "blocked"];
const NEEDS_FILE = new Set(["missing", "blocked"]);

export function remoteAgentFrom(body) {
  const raw = body?.remoteAgent;
  if (!raw || typeof raw !== "object" || !REMOTE_STATES.includes(raw.state)) return null;
  const detail = typeof raw.detail === "string" ? raw.detail.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240) : "";
  const repairedAt = typeof raw.repairedAt === "string" && !Number.isNaN(Date.parse(raw.repairedAt)) ? new Date(raw.repairedAt).toISOString() : null;
  return { state: raw.state, ...(detail ? { detail } : {}), ...(repairedAt ? { repairedAt } : {}) };
}

// The agent only needs the published hash when it has to (re)install the remote agent.
export function remoteAgentOffer(report, release) {
  return report && NEEDS_FILE.has(report.state) && release?.sha256 ? { sha256: release.sha256 } : null;
}

// Audit only the changes a technician cares about, not every heartbeat.
export function remoteAgentChange(before, after) {
  if (!after) return null;
  const was = before?.state || null;
  if (was === after.state) return null;
  if (after.state === "running") return was && was !== "running" ? "device.remote_agent_ok" : null;
  if (after.state === "repairing") return null;
  return `device.remote_agent_${after.state}`;
}

const VIEW_TEXT = {
  stopped: "Remote support is stopped on this device. The agent is trying to start it.",
  missing: "Remote support is not installed on this device. The agent will reinstall it.",
  repairing: "Remote support is being reinstalled.",
  blocked: "Remote support was removed or blocked on this device, most likely by antivirus. Allow it in the antivirus, then it reinstalls within the hour.",
};

export function remoteAgentView(value) {
  if (!value || !REMOTE_STATES.includes(value.state)) return null;
  return {
    state: value.state,
    ok: value.state === "running",
    message: VIEW_TEXT[value.state] || null,
    detail: value.detail || null,
    repairedAt: value.repairedAt || null,
  };
}
