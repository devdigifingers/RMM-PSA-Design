import { agentApiUrl, checkInstallCode, consoleOrigin, readAgentFile } from "../../../agent/package";

// Public: the code in the path is the enrollment key, so PowerShell on a server needs no console login.
// channel=next serves a build staged for testing instead of the published one.
export async function GET(request, { params }) {
  const { code } = await params;
  const valid = await checkInstallCode(code);
  const query = new URL(request.url).searchParams;
  const next = query.get("channel") === "next";
  if (query.get("package") === "1") {
    if (!valid) return new Response("This install command is not valid.", { status: 401 });
    const exe = await readAgentFile(...(next ? ["next", "DigitalFingersAgent.exe"] : ["DigitalFingersAgent.exe"]));
    if (!exe) return new Response("The Windows agent is not available yet.", { status: 404 });
    return new Response(exe, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
  }
  const script = valid
    ? installScript(`${consoleOrigin}/i/${code}/windows?package=1${next ? "&channel=next" : ""}`, code)
    : "throw 'Digital Fingers Agent: this install command has expired, was revoked or has been used up. Create a new one under Downloads in the console.'\r\n";
  return new Response(script, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function installScript(url, code) {
  return [
    "# Digital Fingers Agent command-line installer for Windows.",
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
    "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Digital Fingers Agent: run PowerShell as administrator.' }",
    "$dir = Join-Path $env:TEMP ('DigitalFingersAgent-' + [guid]::NewGuid().ToString('N'))",
    "New-Item -ItemType Directory -Path $dir | Out-Null",
    "try {",
    "  $exe = Join-Path $dir 'DigitalFingersAgent.exe'",
    `  Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile $exe`,
    `  [IO.File]::WriteAllText((Join-Path $dir 'df-agent.env'), "DF_API_URL=${agentApiUrl}\`r\`nDF_ENROLL_TOKEN=${code}\`r\`n")`,
    "  & $exe quiet",
    "  if ($LASTEXITCODE -ne 0) { throw \"Digital Fingers Agent: the install did not finish (exit $LASTEXITCODE).\" }",
    "} finally {",
    "  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue",
    "}",
    "",
  ].join("\r\n");
}
