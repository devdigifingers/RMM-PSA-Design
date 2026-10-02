#!/bin/bash
# Receive one MeshCentral archive on this host. Does not restore.
set -euo pipefail
umask 077

dest_dir=/var/backups/df-mesh
keep=7

if [[ "$(id -u)" -ne 0 ]]; then
  echo "root required" >&2
  exit 1
fi

install -d -m 700 "$dest_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
tmp=$(mktemp "$dest_dir/.meshcentral.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
gzip -t "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$dest_dir/meshcentral-${stamp}.tar.gz"
trap - EXIT

mapfile -t ranked < <(find "$dest_dir" -maxdepth 1 -type f -name 'meshcentral-*.tar.gz' -printf '%T@\t%p\n' | sort -nr | cut -f2-)
if ((${#ranked[@]} > keep)); then
  for ((i = keep; i < ${#ranked[@]}; i++)); do
    rm -f -- "${ranked[$i]}"
  done
fi

echo "mesh archive written"
