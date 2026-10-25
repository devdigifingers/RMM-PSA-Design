$root = "C:\ProgramData\DigitalFingers"
New-Item -ItemType Directory -Force -Path $root | Out-Null
icacls $root /setowner "*S-1-5-32-544" /T /C | Out-Null
icacls $root /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /C | Out-Null
icacls "$root\*" /reset /T /C | Out-Null
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item (Join-Path $here "df-agent.exe") (Join-Path $root "df-agent.exe") -Force
$envFile = Join-Path $here "df-agent.env"
if (Test-Path $envFile) {
  Copy-Item $envFile (Join-Path $root "df-agent.env") -Force
}
sc.exe stop df-agent | Out-Null
sc.exe delete df-agent | Out-Null
Start-Sleep -Seconds 2
sc.exe create df-agent binPath= "C:\ProgramData\DigitalFingers\df-agent.exe" start= auto DisplayName= "Digital Fingers Agent"
sc.exe description df-agent "Digital Fingers device agent"
sc.exe failure df-agent reset= 86400 actions= restart/5000
sc.exe failureflag df-agent 1
sc.exe start df-agent
$mesh = Join-Path $here "MeshService64.exe"
if (Test-Path $mesh) {
  Copy-Item $mesh (Join-Path $root "MeshService64.exe") -Force
  Start-Process -FilePath (Join-Path $root "MeshService64.exe") -ArgumentList "-fullinstall" -Wait
}
