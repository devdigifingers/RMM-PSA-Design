#!/bin/bash
# Builds the Linux agent (amd64 and arm64) on df-a and publishes it with the remote desktop agents
# and install files to /opt/df-console/agent-bin/linux, where the console packs the download.
#   tar czf /tmp/dfagent-src.tgz -C agent go.mod go.sum main.go os_linux.go os_windows.go patch_helper_linux.go deploy
#   scp /tmp/dfagent-src.tgz agent/deploy/build-linux.sh df-a:/tmp/
#   ssh df-a 'sudo bash /tmp/build-linux.sh'
set -euo pipefail
set -a; . /root/df-api.env; . /root/df-mesh.env; set +a
build=$(mktemp -d /tmp/df-agent-build.XXXXXX)
trap 'rm -rf "$build" /tmp/dfagent-src.tgz /tmp/build-linux.sh' EXIT
tar xzf /tmp/dfagent-src.tgz -C "$build"
ctl() { (cd "$1" && shift && node /opt/meshcentral/node_modules/meshcentral/meshctrl.js "$@" --loginuser "$MESH_USER" --loginpass "$MESH_PASSWORD"); }
mkdir "$build/mesh"
groups=$(ctl "$build/mesh" ListDeviceGroups --json --url ws://127.0.0.1:4430)
mid=$(printf '%s' "$groups" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const g=JSON.parse(d).find(x=>x.name==="Digital Fingers");const id=g?String(g._id).split("/")[2]:"";process.stdout.write(id.length===64?id:"")})')
[ -n "$mid" ] || { echo "staging group not found"; exit 1; }
for pair in amd64:6 arm64:26; do
  arch=${pair%%:*}
  mkdir "$build/mesh/$arch"
  ctl "$build/mesh/$arch" AgentDownload --id "$mid" --type "${pair##*:}" --url wss://mesh.digitalfingers.co.za >/dev/null 2>&1 || true
  files=("$build/mesh/$arch"/*)
  [ "${#files[@]}" -eq 1 ] && [ -f "${files[0]}" ] || { echo "mesh agent download failed for $arch"; exit 1; }
  mv "${files[0]}" "$build/meshagent-$arch"
  echo "mesh-$arch-bytes $(stat -c %s "$build/meshagent-$arch")"
done
curl -fsS "https://mesh.digitalfingers.co.za/meshsettings?id=$mid" -o "$build/meshagent.msh"
grep -q '^MeshID=' "$build/meshagent.msh" && grep -q '^MeshServer=' "$build/meshagent.msh" || { echo "mesh settings download failed"; exit 1; }
echo "mesh-settings-lines $(wc -l < "$build/meshagent.msh")"
version=$(sed -n 's/^const agentVersion = "\([0-9]*\.[0-9]*\.[0-9]*\)"$/\1/p' "$build/main.go")
[ -n "$version" ] || { echo "agent version not found"; exit 1; }
(cd "$build" && go vet . \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o df-agent-amd64 . \
  && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o df-agent-arm64 .)
bin=/opt/df-console/agent-bin/linux
install -d -o dfconsole -g dfconsole -m 755 "$bin"
for file in df-agent-amd64 df-agent-arm64 meshagent-amd64 meshagent-arm64; do
  install -o dfconsole -g dfconsole -m 755 "$build/$file" "$bin/$file"
done
install -o dfconsole -g dfconsole -m 755 "$build/deploy/install-linux.sh" "$bin/install.sh"
install -o dfconsole -g dfconsole -m 644 "$build/deploy/df-agent.service" "$build/deploy/df-patch-helper.service" "$bin/"
install -o dfconsole -g dfconsole -m 600 "$build/meshagent.msh" "$bin/meshagent.msh"
sha=$(sha256sum "$bin/df-agent-amd64" | cut -d' ' -f1)
printf '{"version":"%s","sha256":"%s"}\n' "$version" "$sha" > "$build/linux.json"
install -o dfconsole -g dfconsole -m 644 "$build/linux.json" "$bin/linux.json"
echo "agent-version $version"
ls -l "$bin"
