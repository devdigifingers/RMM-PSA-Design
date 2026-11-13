#!/bin/bash
# Builds the Windows agent and DFSupport.exe (the Session Panel and tray app) on df-a and publishes them with
# windows.json and windows-support.json, which offers them to every outdated device. Run as root with the source
# unpacked from /tmp/dfagent-src.tgz:
#   tar czf /tmp/dfagent-src.tgz -C agent --exclude=support/assets/icon-source.png --exclude=support/assets/mark.png \
#     go.mod go.sum main.go os_linux.go os_windows.go patch_helper_linux.go support_windows.go support_chat_windows.go support_files_windows.go support
#   scp /tmp/dfagent-src.tgz agent/deploy/build-windows.sh df-a:/tmp/
#   ssh df-a 'sudo bash /tmp/build-windows.sh'
# Every build also publishes the remote support (Mesh) agent for the staging group as
# DigitalFingersRemoteSupport.exe with windows-remote.json; device agents 1.6+ download and install it.
# With CHANNEL=next the build is only staged: test install commands and the devices in AGENT_PILOT_DEVICES (API env)
# get it from next/; nothing is published to other devices.
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
  rm -f "$staged" "$bin/next/windows.json" /tmp/build-windows.sh
  sha=$(sha256sum "$live" | cut -d' ' -f1)
  tmp=$(mktemp)
  if [ -f "$bin/next/DFSupport.exe" ]; then
    [ -f "$bin/DFSupport.exe" ] && cp -p "$bin/DFSupport.exe" "$bin/DFSupport.exe.prev-$(date +%Y%m%d%H%M)"
    install -o dfconsole -g dfconsole -m 644 "$bin/next/DFSupport.exe" "$bin/DFSupport.exe"
    install -o dfconsole -g dfconsole -m 644 "$bin/next/windows-support.json" "$bin/windows-support.json"
    rm -f "$bin/next/DFSupport.exe" "$bin/next/windows-support.json"
    echo "published support-sha256 $(sha256sum "$bin/DFSupport.exe" | cut -d' ' -f1)"
  fi
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
remote=$bin/DigitalFingersRemoteSupport.exe
install -o dfconsole -g dfconsole -m 644 "${files[0]}" "$remote.new"
mv -f "$remote.new" "$remote"
printf '{"sha256":"%s"}\n' "$(sha256sum "$remote" | cut -d' ' -f1)" > "$build/windows-remote.json"
install -o dfconsole -g dfconsole -m 644 "$build/windows-remote.json" "$bin/windows-remote.json"
echo "remote-support-bytes $(stat -c %s "$remote")"
version=$(sed -n 's/^const agentVersion = "\([0-9]*\.[0-9]*\.[0-9]*\)"$/\1/p' "$build/main.go")
[ -n "$version" ] || { echo "agent version not found"; exit 1; }
support_version=$(sed -n 's/^const appVersion = "\([0-9]*\.[0-9]*\.[0-9]*\)"$/\1/p' "$build/support/main.go")
[ -n "$support_version" ] || { echo "support app version not found"; exit 1; }
# Windows resources (icon and version details); the agent gets no manifest so its elevation behaviour is unchanged.
winres() { # dir name description file version manifest
  local manifest=""
  [ "$6" = gui ] && manifest='"RT_MANIFEST":{"#1":{"0409":{"identity":{},"execution-level":"as invoker","dpi-awareness":"per monitor v2","use-common-controls-v6":true,"long-path-aware":true}}},'
  mkdir -p "$1/winres"
  printf '{"RT_GROUP_ICON":{"APP":{"0000":"%s"}},%s"RT_VERSION":{"#1":{"0000":{"fixed":{"file_version":"%s.0","product_version":"%s.0"},"info":{"0409":{"CompanyName":"Digital Fingers","FileDescription":"%s","FileVersion":"%s","LegalCopyright":"Digital Fingers","OriginalFilename":"%s","ProductName":"%s","ProductVersion":"%s"}}}}}}\n' \
    "$(realpath --relative-to="$1/winres" "$build/support/assets/app.ico")" "$manifest" "$5" "$5" "$3" "$5" "$4" "$2" "$5" > "$1/winres/winres.json"
  (cd "$1" && go run github.com/tc-hib/go-winres@v0.3.3 make --in winres/winres.json --arch amd64)
}
winres "$build" "Digital Fingers Agent" "Digital Fingers Agent" DigitalFingersAgent.exe "$version" none
winres "$build/support" "Digital Fingers Support" "Digital Fingers Support" DFSupport.exe "$support_version" gui
(cd "$build" && { GOOS=windows go vet . 2>&1 | grep -v 'possible misuse of unsafe.Pointer' || true; } \
  && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -o DigitalFingersAgent.exe . \
  && CGO_ENABLED=0 go build -o /dev/null .)
(cd "$build/support" && { GOOS=windows go vet ./... 2>&1 | grep -v 'possible misuse of unsafe.Pointer' || true; } \
  && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o "$build/DFSupport.exe" .)
support_sha=$(sha256sum "$build/DFSupport.exe" | cut -d' ' -f1)
printf '{"version":"%s","sha256":"%s"}\n' "$support_version" "$support_sha" > "$build/windows-support.json"
if [ "${CHANNEL:-}" = next ]; then
  # Staged for testing: test install commands and the pilot devices use it; no other device is offered it.
  install -d -o dfconsole -g dfconsole -m 755 "$bin/next"
  install -o dfconsole -g dfconsole -m 644 "$build/DigitalFingersAgent.exe" "$bin/next/DigitalFingersAgent.exe"
  install -o dfconsole -g dfconsole -m 644 "$build/DFSupport.exe" "$bin/next/DFSupport.exe"
  install -o dfconsole -g dfconsole -m 644 "$build/windows-support.json" "$bin/next/windows-support.json"
  printf '{"version":"%s","sha256":"%s"}\n' "$version" "$(sha256sum "$build/DigitalFingersAgent.exe" | cut -d' ' -f1)" > "$build/next-windows.json"
  install -o dfconsole -g dfconsole -m 644 "$build/next-windows.json" "$bin/next/windows.json"
  echo "staged agent-version $version bytes $(stat -c %s "$bin/next/DigitalFingersAgent.exe")"
  echo "staged support-version $support_version bytes $(stat -c %s "$bin/next/DFSupport.exe") sha256 $support_sha"
  exit 0
fi
live=$bin/DigitalFingersAgent.exe
cp -p "$live" "$live.prev-$(date +%Y%m%d%H%M)"
rm -f "$bin/next/DigitalFingersAgent.exe" "$bin/next/windows.json" "$bin/next/DFSupport.exe" "$bin/next/windows-support.json"
[ -f "$bin/DFSupport.exe" ] && cp -p "$bin/DFSupport.exe" "$bin/DFSupport.exe.prev-$(date +%Y%m%d%H%M)"
install -o dfconsole -g dfconsole -m 644 "$build/DFSupport.exe" "$bin/DFSupport.exe"
install -o dfconsole -g dfconsole -m 644 "$build/windows-support.json" "$bin/windows-support.json"
install -o dfconsole -g dfconsole -m 644 "$build/DigitalFingersAgent.exe" "$live"
sha=$(sha256sum "$live" | cut -d' ' -f1)
printf '{"version":"%s","sha256":"%s"}\n' "$version" "$sha" > "$build/windows.json"
install -o dfconsole -g dfconsole -m 644 "$build/windows.json" "$bin/windows.json"
echo "agent-version $version"
echo "agent-bytes $(stat -c %s "$live")"
echo "agent-sha256 $sha"
ls -1 "$bin"
