#!/bin/bash
# Builds the Windows agent on df-a and publishes it with windows.json, which offers it to every
# outdated device. Run as root with the agent source unpacked from /tmp/dfagent-src.tgz:
#   tar czf /tmp/dfagent-src.tgz -C agent go.mod go.sum main.go os_linux.go os_windows.go
#   scp /tmp/dfagent-src.tgz agent/deploy/build-windows.sh df-a:/tmp/
#   ssh df-a 'sudo bash -lc "PATH=\$PATH:/usr/local/go/bin bash /tmp/build-windows.sh"'
set -euo pipefail
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
bin=/opt/df-console/agent-bin
live=$bin/DigitalFingersAgent.exe
cp -p "$live" "$live.prev-$(date +%Y%m%d%H%M)"
install -o dfconsole -g dfconsole -m 644 "$build/DigitalFingersAgent.exe" "$live"
sha=$(sha256sum "$live" | cut -d' ' -f1)
printf '{"version":"%s","sha256":"%s"}\n' "$version" "$sha" > "$build/windows.json"
install -o dfconsole -g dfconsole -m 644 "$build/windows.json" "$bin/windows.json"
echo "agent-version $version"
echo "agent-bytes $(stat -c %s "$live")"
echo "agent-sha256 $sha"
ls -1 "$bin"
