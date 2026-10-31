// What a job may contain: one command line, or a multi-line PowerShell script for Windows agents that can run one.

// cmd.exe refuses lines longer than 8191 characters, including its own "/d /s /c" wrapper.
export const COMMAND_MAX = 8000;
export const SCRIPT_MAX = 65536;
export const SCRIPT_AGENT = "1.6.1";
// A script body is JSON-escaped in the request, so the body limit is well above SCRIPT_MAX.
export const JOB_BODY_LIMIT = 512 * 1024;

export function parseJobInput(body) {
  const hasScript = typeof body?.script === "string" && body.script.trim() !== "";
  const hasCommand = typeof body?.command === "string" && body.command.trim() !== "";
  if (hasScript && hasCommand) return { error: "Send either a command or a script, not both." };
  if (hasScript) {
    const script = body.script.replace(/\r\n/g, "\n");
    if (script.length > SCRIPT_MAX) return { error: `A script can be up to ${SCRIPT_MAX} characters.` };
    if (script.includes("\0")) return { error: "A script cannot contain NUL characters." };
    return { value: { kind: "script", text: script } };
  }
  const command = hasCommand ? body.command.trim() : "";
  if (!command || command.length > COMMAND_MAX || /[\n\r\0]/.test(command)) {
    return { error: `Send one command line of up to ${COMMAND_MAX} characters, or a "script".` };
  }
  return { value: { kind: "command", text: command } };
}

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value || ""));
  return match ? match.slice(1).map(Number) : null;
}

function atLeast(current, wanted) {
  const have = versionParts(current);
  const want = versionParts(wanted);
  if (!have) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
}

// Why a script job cannot go to this device, or null when it can.
export function scriptProblem(device) {
  if (!/windows/i.test(String(device?.os_name || ""))) return "Scripts run on Windows devices only; send a command instead.";
  if (!atLeast(device?.agent_version, SCRIPT_AGENT)) return `Scripts need agent ${SCRIPT_AGENT} or newer on the device; send a command instead.`;
  return null;
}
