// Scripts the server runs through MeshCentral for the session window's Switch User menu. The tenant technician
// Mesh login has no right to run commands, so these go through the server after the role check.

export const SWITCH_DONE = "DF-SWITCH-OK";

const WTS_TYPES = [
  '[DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSDisconnectSession(IntPtr server, int sessionId, bool wait);',
  '[DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSLogoffSession(IntPtr server, int sessionId, bool wait);',
  '[DllImport("wtsapi32.dll", EntryPoint="WTSQuerySessionInformationW", CharSet=CharSet.Unicode)] public static extern bool WTSQuerySessionInformation(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);',
  '[DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr memory);',
  '[DllImport("kernel32.dll")] public static extern int WTSGetActiveConsoleSessionId();',
].join(" ");

const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -Namespace DF -Name SwitchUser -MemberDefinition '${WTS_TYPES}'`,
  "function Refused { Write-Output ('Windows refused: ' + (New-Object ComponentModel.Win32Exception([Runtime.InteropServices.Marshal]::GetLastWin32Error())).Message); exit 1 }",
];

export function signinScript() {
  return [
    ...PRELUDE,
    "$id = [DF.SwitchUser]::WTSGetActiveConsoleSessionId()",
    "if ($id -lt 1) { Write-Output 'Nobody is at the screen.'; exit 1 }",
    `if ([DF.SwitchUser]::WTSDisconnectSession([IntPtr]::Zero, $id, $false)) { Write-Output '${SWITCH_DONE}' } else { Refused }`,
  ].join("\n");
}

// The session is checked against the user the technician picked, so a session id reused by someone else after a
// sign-out is not signed out by mistake.
export function signoutScript(sessionId, user) {
  const expected = Buffer.from(user, "utf8").toString("base64");
  return [
    ...PRELUDE,
    `$id = ${sessionId}`,
    `$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${expected}'))`,
    "function Info($class) { $p = [IntPtr]::Zero; $n = 0; if (-not [DF.SwitchUser]::WTSQuerySessionInformation([IntPtr]::Zero, $id, $class, [ref]$p, [ref]$n)) { return '' }; $s = [Runtime.InteropServices.Marshal]::PtrToStringUni($p); [DF.SwitchUser]::WTSFreeMemory($p); return $s }",
    "$name = Info 5",
    "$domain = Info 7",
    "if (-not $name) { Write-Output 'Nobody is signed in to that session any more.'; exit 1 }",
    "$who = if ($domain) { $domain + '\\' + $name } else { $name }",
    "if (-not ($who -ieq $expected -or $name -ieq $expected)) { Write-Output ('That session now belongs to ' + $who + '. Open Switch User again.'); exit 1 }",
    `if ([DF.SwitchUser]::WTSLogoffSession([IntPtr]::Zero, $id, $false)) { Write-Output '${SWITCH_DONE}' } else { Refused }`,
  ].join("\n");
}

export function powershellLine(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));Invoke-Expression $s`;
}

export function signoutTarget(body) {
  const sessionId = body?.sessionId;
  const user = typeof body?.user === "string" ? body.user.trim() : "";
  if (!Number.isInteger(sessionId) || sessionId < 1 || sessionId > 65535) return null;
  if (!user || user.length > 120 || /[\u0000-\u001f]/.test(user)) return null;
  return { sessionId, user };
}

export function switchOutcome(output) {
  const text = String(output || "").trim();
  if (text.includes(SWITCH_DONE)) return { ok: true };
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
  return { ok: false, error: line.slice(0, 200) || "Windows did not answer." };
}
