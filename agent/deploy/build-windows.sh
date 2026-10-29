#!/bin/bash
# Builds the Windows agent on df-a and publishes it with windows.json, which offers it to every
# outdated device. Run as root with the agent source unpacked from /tmp/dfagent-src.tgz:
#   tar czf /tmp/dfagent-src.tgz -C agent go.mod go.sum main.go os_linux.go os_windows.go patch_helper_linux.go
#   scp /tmp/dfagent-src.tgz agent/deploy/build-windows.sh df-a:/tmp/
#   ssh df-a 'sudo bash /tmp/build-windows.sh'
# With CHANNEL=next the build is only staged for test install commands and nothing is published.
# After the staged build passes its test, publish that same file without rebuilding:
#   scp agent/deploy/build-windows.sh df-a:/tmp/ && ssh df-a 'sudo bash /tmp/build-windows.sh promote 1.5.2'
set -euo pipefail
bin=/opt/df-console/agent-bin
if [ "${1:-}" = promote ]; then
  staged=$bin/next/DigitalFingersAgent.exe
  version=${2:-}
  [ -f "$staged" ] || { echo "nothing is staged"; exit 1; }
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: build-windows.sh promote <version of the staged build>"; exit 1; }
  live=$bin/DigitalFingersAgent.exe
  cp -p "$live" "$live.prev-$(date +%Y%m%d%H%M)"
  install -o dfconsole -g dfconsole -m 644 "$staged" "$live"
  rm -f "$staged" /tmp/build-windows.sh
  sha=$(sha256sum "$live" | cut -d' ' -f1)
  tmp=$(mktemp)
  printf '{"version":"%s","sha256":"%s"}\n' "$version" "$sha" > "$tmp"
  install -o dfconsole -g dfconsole -m 644 "$tmp" "$bin/windows.json"
  rm -f "$tmp"
  echo "published agent-version $version"
  echo "agent-sha256 $sha"
  exit 0
fi
set -a; . /root/df-api.env; . /root/df-mesh.env; set +a
build=$(mktemp -d /tmp/df-agent-build.XXXXXX)
trap 'rm -rf "$build" /tmp/dfagent-src.tgz /tmp/build-windows.sh' EXIT
tar xzf /tmp/dfagent-src.tgz -C "$build"
ctl() { (cd "$build/mesh" && node /opt/meshcentral/node_modules/meshcentral/meshctrl.js "$@" --loginuser "$MESH_USER" --loginpass "$MESH_PASSWORD"); }
mkdir "$build/mesh"
groups=$(ctl ListDeviceGroups --json --url ws://127.0.0.1:4430)
mid=$(printf '%s' "$groups" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const g=JSON.parse(d).find(x=>x.name==="Digital Fingers");const id=g?String(g._id).split("/")[2]:"";process.stdout.write(id.length===64?id:"")})')
[ -n "$mid" ] || { echo "staging group not found"; exit 1; }
ctl AgentDownload --id "$mid" --type 4 --url wss://mesh.digitalfingers.co.za >/dev/null 2>&1 || true
files=("$build"/mesh/*)
[ "${#files[@]}" -eq 1 ] && [ -f "${files[0]}" ] || { echo "mesh agent download failed"; exit 1; }
mv "${files[0]}" "$build/meshagent.exe"
echo "mesh-agent-bytes $(stat -c %s "$build/meshagent.exe")"
version=$(sed -n 's/^const agentVersion = "\([0-9]*\.[0-9]*\.[0-9]*\)"$/\1/p' "$build/main.go")
[ -n "$version" ] || { echo "agent version not found"; exit 1; }
(cd "$build" && { GOOS=windows go vet ./... 2>&1 | grep -v 'possible misuse of unsafe.Pointer' || true; } \
  && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o DigitalFingersAgent.exe . \
  && CGO_ENABLED=0 go build -o /dev/null .)
if [ "${CHANNEL:-}" = next ]; then
  # Staged for testing: only install commands created for the test channel use it; no device is offered it.
  install -d -o dfconsole -g dfconsole -m 755 "$bin/next"
  install -o dfconsole -g dfconsole -m 644 "$build/DigitalFingersAgent.exe" "$bin/next/DigitalFingersAgent.exe"
  echo "staged agent-version $version bytes $(stat -c %s "$bin/next/DigitalFingersAgent.exe")"
  exit 0
fi
live=$bin/DigitalFingersAgent.exe
cp -p "$live" "$live.prev-$(date +%Y%m%d%H%M)"
rm -f "$bin/next/DigitalFingersAgent.exe"
install -o dfconsole -g dfconsole -m 644 "$build/DigitalFingersAgent.exe" "$live"
sha=$(sha256sum "$live" | cut -d' ' -f1)
printf '{"version":"%s","sha256":"%s"}\n' "$version" "$sha" > "$build/windows.json"
install -o dfconsole -g dfconsole -m 644 "$build/windows.json" "$bin/windows.json"
echo "agent-version $version"
echo "agent-bytes $(stat -c %s "$live")"
echo "agent-sha256 $sha"
ls -1 "$bin"
