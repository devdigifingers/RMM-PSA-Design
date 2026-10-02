#!/bin/bash
# Copy MeshCentral data to Contabo B. Does not restore and does not stop Mesh.
set -euo pipefail
umask 077

src=/opt/meshcentral/meshcentral-data
key=/root/.ssh/df-mesh-backup
target=root@169.58.10.76

if [[ "$(id -u)" -ne 0 ]]; then
  echo "root required" >&2
  exit 1
fi
if [[ ! -d "$src" || ! -f "$key" ]]; then
  echo "mesh data or backup key missing" >&2
  exit 1
fi

tar -C /opt/meshcentral -czf - meshcentral-data | ssh -T -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes "$target"
echo "mesh archive sent"
