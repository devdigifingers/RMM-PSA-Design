$root = "C:\ProgramData\DigitalFingers"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item (Join-Path $here "df-agent.exe") (Join-Path $root "df-agent.exe") -Force
$envFile = Join-Path $here "df-agent.env"
if (Test-Path $envFile) {
  Copy-Item $envFile (Join-Path $root "df-agent.env") -Force
  icacls (Join-Path $root "df-agent.env") /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)" | Out-Null
}
sc.exe stop df-agent | Out-Null
sc.exe delete df-agent | Out-Null
Start-Sleep -Seconds 2
sc.exe create df-agent binPath= "C:\ProgramData\DigitalFingers\df-agent.exe" start= auto DisplayName= "Digital Fingers Agent"
sc.exe description df-agent "Digital Fingers device agent"
sc.exe failure df-agent reset= 86400 actions= restart/5000
sc.exe start df-agent
$mesh = Join-Path $here "MeshService64.exe"
if (Test-Path $mesh) {
  Copy-Item $mesh (Join-Path $root "MeshService64.exe") -Force
  Start-Process -FilePath (Join-Path $root "MeshService64.exe") -ArgumentList "-fullinstall" -Wait
}
