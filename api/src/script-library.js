// The script library: shells, risk levels, the built-in starter scripts, and turning a script into a job.
import { randomBytes } from "node:crypto";
import { COMMAND_MAX, SCRIPT_MAX, scriptProblem } from "./job-input.js";

export const SHELLS = {
  powershell: { label: "PowerShell", os: "windows" },
  cmd: { label: "CMD", os: "windows" },
  bash: { label: "Bash", os: "linux" },
};

export const RISKS = {
  safe: "Safe",
  approval: "Needs approval",
};

export const FIX_TYPES = {
  cpu: "High CPU",
  memory: "High memory",
  disk: "Low disk space",
  offline: "Device offline",
  patches: "Missing updates",
};

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;
export const PARAMS_MAX = 5;
export const PARAM_VALUE_MAX = 200;
// The Linux agent runs a job through /bin/sh -c; the script travels inside that one argument.
export const BASH_MAX = 16000;

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
// CMD has no safe quoting, so substituted values are limited to characters with no meaning to cmd.exe.
const CMD_VALUE = /^[A-Za-z0-9 ._:\\/-]*$/;

const ps = (lines) => lines.join("\n");

export const BUILTIN_SCRIPTS = [
  {
    ref: "clear-print-spooler",
    name: "Clear print spooler",
    description: "Stops the print spooler, removes stuck print jobs and starts it again.",
    shell: "powershell",
    risk: "safe",
    fixes: [],
    body: ps([
      "Stop-Service -Name Spooler -Force",
      "Get-ChildItem \"$env:SystemRoot\\System32\\spool\\PRINTERS\" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue",
      "Start-Service -Name Spooler",
      "Get-Service -Name Spooler | Format-List Name, Status",
    ]),
  },
  {
    ref: "flush-dns",
    name: "Flush DNS cache",
    description: "Clears the DNS resolver cache so names are looked up again.",
    shell: "powershell",
    risk: "safe",
    fixes: ["offline"],
    body: ps([
      "Clear-DnsClientCache",
      "ipconfig /flushdns",
    ]),
  },
  {
    ref: "restart-service",
    name: "Restart a service",
    description: "Restarts one Windows service by its service name, for example Spooler or wuauserv.",
    shell: "powershell",
    risk: "approval",
    fixes: [],
    parameters: [{ name: "ServiceName", label: "Service name", default: "", required: true }],
    body: ps([
      "$service = Get-Service -Name $ServiceName -ErrorAction Stop",
      "Restart-Service -InputObject $service -Force",
      "Get-Service -Name $ServiceName | Format-List Name, DisplayName, Status",
    ]),
  },
  {
    ref: "clear-temp-files",
    name: "Clear temporary files",
    description: "Removes temporary files older than two days from Windows and every user profile.",
    shell: "powershell",
    risk: "safe",
    fixes: ["disk"],
    body: ps([
      "$cutoff = (Get-Date).AddDays(-2)",
      "$removed = 0",
      "foreach ($path in @(\"$env:SystemRoot\\Temp\", \"C:\\Users\\*\\AppData\\Local\\Temp\")) {",
      "  Get-ChildItem -Path $path -Recurse -Force -File -ErrorAction SilentlyContinue |",
      "    Where-Object { $_.LastWriteTime -lt $cutoff } |",
      "    ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $removed += $_.Length } catch {} }",
      "}",
      "\"Removed {0:N1} MB of temporary files older than two days.\" -f ($removed / 1MB)",
    ]),
  },
  {
    ref: "check-disk",
    name: "Check disk (scan only)",
    description: "Scans each fixed drive for file system errors without repairing or locking it.",
    shell: "powershell",
    risk: "safe",
    fixes: ["disk"],
    body: ps([
      "Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object {",
      "  \"Drive $($_.DriveLetter): $(Repair-Volume -DriveLetter $_.DriveLetter -Scan)\"",
      "}",
    ]),
  },
  {
    ref: "restart-explorer",
    name: "Restart Explorer",
    description: "Restarts the Windows taskbar and desktop when they stop responding.",
    shell: "powershell",
    risk: "safe",
    fixes: [],
    body: ps([
      "Get-Process -Name explorer -ErrorAction SilentlyContinue | Stop-Process -Force",
      "Start-Sleep -Seconds 3",
      "if (Get-Process -Name explorer -ErrorAction SilentlyContinue) { \"Explorer restarted.\" } else { \"Explorer is not running; the user may need to sign in again.\" }",
    ]),
  },
  {
    ref: "sync-time",
    name: "Sync time",
    description: "Makes Windows set its clock from the time server now.",
    shell: "powershell",
    risk: "safe",
    fixes: ["patches"],
    body: ps([
      "Start-Service -Name w32time -ErrorAction SilentlyContinue",
      "w32tm /resync /force",
      "w32tm /query /status",
    ]),
  },
  {
    ref: "gpupdate",
    name: "Refresh group policy",
    description: "Applies computer group policy again (gpupdate /force).",
    shell: "powershell",
    risk: "safe",
    fixes: [],
    body: "gpupdate /target:computer /force",
  },
  {
    ref: "installed-software",
    name: "List installed software",
    description: "Lists installed programs with their version and publisher.",
    shell: "powershell",
    risk: "safe",
    fixes: [],
    body: ps([
      "$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
      "Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | Sort-Object DisplayName -Unique |",
      "  Format-Table DisplayName, DisplayVersion, Publisher -AutoSize | Out-String -Width 200",
    ]),
  },
  {
    ref: "disk-space",
    name: "Disk space report",
    description: "Shows the size and free space of each fixed drive.",
    shell: "powershell",
    risk: "safe",
    fixes: ["disk"],
    body: ps([
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Format-Table DeviceID,",
      "  @{ n = 'Size GB'; e = { [math]::Round($_.Size / 1GB, 1) } },",
      "  @{ n = 'Free GB'; e = { [math]::Round($_.FreeSpace / 1GB, 1) } },",
      "  @{ n = 'Free %'; e = { [math]::Round(100 * $_.FreeSpace / $_.Size) } } -AutoSize | Out-String",
    ]),
  },
  {
    ref: "network-check",
    name: "Network diagnostics",
    description: "Shows the network settings, then tests the gateway, DNS and an HTTPS connection.",
    shell: "powershell",
    risk: "safe",
    fixes: ["offline"],
    body: ps([
      "ipconfig /all",
      "$gateway = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop",
      "if ($gateway) { \"Gateway $gateway answers: $(Test-Connection -ComputerName $gateway -Count 2 -Quiet)\" } else { \"No default gateway.\" }",
      "\"DNS lookup works: $([bool](Resolve-DnsName www.microsoft.com -ErrorAction SilentlyContinue))\"",
      "\"HTTPS connection works: $((Test-NetConnection www.microsoft.com -Port 443 -WarningAction SilentlyContinue).TcpTestSucceeded)\"",
    ]),
  },
  {
    ref: "pending-reboot",
    name: "Pending restart check",
    description: "Reports whether Windows is waiting for a restart, and why.",
    shell: "powershell",
    risk: "safe",
    fixes: ["patches"],
    body: ps([
      "$reasons = @()",
      "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { $reasons += 'Windows component servicing' }",
      "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reasons += 'Windows Update' }",
      "if (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue) { $reasons += 'Pending file renames' }",
      "if ($reasons) { \"A restart is pending: \" + ($reasons -join ', ') } else { \"No restart is pending.\" }",
    ]),
  },
  {
    ref: "top-processes",
    name: "Top processes",
    description: "Lists the ten processes using the most CPU time and the ten using the most memory.",
    shell: "powershell",
    risk: "safe",
    fixes: ["cpu", "memory"],
    body: ps([
      "\"Most CPU time:\"",
      "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id,",
      "  @{ n = 'CPU s'; e = { [math]::Round($_.CPU, 1) } }, @{ n = 'Memory MB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } } | Format-Table -AutoSize | Out-String",
      "\"Most memory:\"",
      "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name, Id,",
      "  @{ n = 'Memory MB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } } | Format-Table -AutoSize | Out-String",
    ]),
  },
  {
    ref: "linux-disk-usage",
    name: "Disk usage (Linux)",
    description: "Shows free space on each file system and the largest folders under /var.",
    shell: "bash",
    risk: "safe",
    fixes: ["disk"],
    body: ps([
      "df -h -x tmpfs -x devtmpfs",
      "echo",
      "echo 'Largest folders under /var:'",
      "du -xh --max-depth=1 /var 2>/dev/null | sort -rh | head -n 10",
    ]),
  },
  {
    ref: "linux-top-processes",
    name: "Top processes (Linux)",
    description: "Shows the load, memory use and the processes using the most CPU.",
    shell: "bash",
    risk: "safe",
    fixes: ["cpu", "memory"],
    body: ps([
      "uptime",
      "echo",
      "free -h",
      "echo",
      "ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 11",
    ]),
  },
].map((script) => ({ parameters: [], ...script, builtin: true }));

const BUILTIN_BY_REF = new Map(BUILTIN_SCRIPTS.map((script) => [script.ref, script]));

export function builtinScript(ref) {
  return BUILTIN_BY_REF.get(String(ref)) || null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseParameters(list, shell, body) {
  if (list == null) return { value: [] };
  if (!Array.isArray(list)) return { error: "Parameters must be a list." };
  const rows = list.filter((item) => text(item?.name) || text(item?.label) || text(item?.default));
  if (rows.length > PARAMS_MAX) return { error: `A script can have up to ${PARAMS_MAX} parameters.` };
  const seen = new Set();
  const value = [];
  for (const item of rows) {
    const name = text(item.name);
    if (!PARAM_NAME.test(name)) return { error: `"${name || "(blank)"}" is not a valid parameter name. Use letters, digits and _, starting with a letter.` };
    if (seen.has(name.toLowerCase())) return { error: `The parameter ${name} is listed twice.` };
    seen.add(name.toLowerCase());
    const label = text(item.label) || name;
    if (label.length > 60) return { error: `The label for ${name} can be up to 60 characters.` };
    const fallback = valueProblem(shell, name, text(item.default));
    if (fallback) return { error: `Default for ${name}: ${fallback}` };
    if (shell === "cmd" && !body.includes(`{{${name}}}`)) return { error: `The CMD script does not use {{${name}}}.` };
    value.push({ name, label, default: text(item.default), required: item.required === true });
  }
  return { value };
}

function valueProblem(shell, name, value) {
  if (value.length > PARAM_VALUE_MAX) return `${name} can be up to ${PARAM_VALUE_MAX} characters.`;
  if (/[\0\r\n]/.test(value)) return `${name} must be one line.`;
  if (shell === "cmd" && !CMD_VALUE.test(value)) return `${name} can only contain letters, digits, spaces and . _ - : \\ /`;
  return null;
}

export function parseScriptInput(body) {
  const name = text(body?.name);
  if (!name || name.length > NAME_MAX) return { error: `Give the script a name of up to ${NAME_MAX} characters.` };
  const description = text(body?.description);
  if (description.length > DESCRIPTION_MAX) return { error: `The description can be up to ${DESCRIPTION_MAX} characters.` };
  const shell = text(body?.shell);
  if (!SHELLS[shell]) return { error: "Choose PowerShell, CMD or Bash." };
  const risk = text(body?.risk) || "safe";
  if (!RISKS[risk]) return { error: "Choose a risk level: safe or needs approval." };
  const script = typeof body?.body === "string" ? body.body.replace(/\r\n/g, "\n").trim() : "";
  if (!script) return { error: "The script is empty." };
  if (script.includes("\0")) return { error: "A script cannot contain NUL characters." };
  if (shell === "powershell" && script.length > SCRIPT_MAX) return { error: `A PowerShell script can be up to ${SCRIPT_MAX} characters.` };
  if (shell === "bash" && script.length > BASH_MAX) return { error: `A Bash script can be up to ${BASH_MAX} characters.` };
  if (shell === "cmd" && (script.includes("\n") || script.length > COMMAND_MAX)) {
    return { error: `A CMD script is one command line of up to ${COMMAND_MAX} characters. Join steps with &&.` };
  }
  const fixes = Array.isArray(body?.fixes) ? [...new Set(body.fixes.map(String))] : [];
  if (fixes.some((fix) => !FIX_TYPES[fix])) return { error: "One of the alert types is not known." };
  const parameters = parseParameters(body?.parameters, shell, script);
  if (parameters.error) return parameters;
  return { value: { name, description, shell, body: script, parameters: parameters.value, risk, fixes } };
}

export function scriptView(row) {
  if (row.builtin) {
    return {
      ref: row.ref, builtin: true, name: row.name, description: row.description, shell: row.shell,
      os: SHELLS[row.shell].os, body: row.body, parameters: row.parameters, risk: row.risk, fixes: row.fixes,
    };
  }
  return {
    ref: String(row.id),
    id: Number(row.id),
    builtin: false,
    name: row.name,
    description: row.description || "",
    shell: row.shell,
    os: SHELLS[row.shell]?.os || "windows",
    body: row.body,
    parameters: Array.isArray(row.parameters) ? row.parameters : [],
    risk: row.risk,
    fixes: row.fixes || [],
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Values for each parameter: what was sent, else the default. Returns { value } or { error }.
export function parameterValues(script, sent = {}) {
  const value = {};
  for (const param of script.parameters || []) {
    const raw = sent?.[param.name];
    const given = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    const chosen = given || param.default || "";
    if (param.required && !chosen) return { error: `Fill in ${param.label || param.name}.` };
    const problem = valueProblem(script.shell, param.label || param.name, chosen);
    if (problem) return { error: problem };
    value[param.name] = chosen;
  }
  return { value };
}

function deviceOs(device) {
  const name = String(device?.os_name || "");
  if (/windows/i.test(name)) return "windows";
  if (/linux|ubuntu|debian|centos|fedora|red hat|rhel|suse|alpine|rocky|alma/i.test(name)) return "linux";
  return "other";
}

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const shQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

// The job to queue for this script on this device: { value: { kind, text } } or { error }.
export function scriptJob(script, device, values) {
  const os = deviceOs(device);
  const shell = SHELLS[script.shell];
  if (!shell) return { error: "This script has an unknown shell." };
  if (os !== shell.os) return { error: `${shell.label} scripts run on ${shell.os === "windows" ? "Windows" : "Linux"} devices only.` };
  const params = script.parameters || [];

  if (script.shell === "powershell") {
    const problem = scriptProblem(device);
    if (problem) return { error: problem };
    const prefix = params.map((param) => `$${param.name} = ${psQuote(values[param.name] ?? "")}\n`).join("");
    const textValue = `${prefix}${script.body}`;
    if (textValue.length > SCRIPT_MAX) return { error: `The script is longer than ${SCRIPT_MAX} characters.` };
    return { value: { kind: "script", text: textValue } };
  }

  if (script.shell === "cmd") {
    let line = script.body;
    for (const param of params) line = line.split(`{{${param.name}}}`).join(values[param.name] ?? "");
    if (line.length > COMMAND_MAX) return { error: `The command is longer than ${COMMAND_MAX} characters.` };
    return { value: { kind: "command", text: line } };
  }

  const prefix = params.map((param) => `${param.name}=${shQuote(values[param.name] ?? "")}\n`).join("");
  const source = `${prefix}${script.body}`;
  let end = "";
  do end = `DF_SCRIPT_END_${randomBytes(4).toString("hex")}`; while (source.split("\n").includes(end));
  const textValue = `/bin/bash -s <<'${end}'\n${source}\n${end}`;
  if (textValue.length > BASH_MAX + 1000) return { error: "The script is too long." };
  return { value: { kind: "command", text: textValue } };
}
