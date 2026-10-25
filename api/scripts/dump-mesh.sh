#!/bin/bash
# Encrypt MeshCentral data and copy it to Contabo B. Does not restore and does not stop Mesh.
set -euo pipefail
umask 077
# shellcheck source=backup-lib.sh
source "$(dirname "$0")/backup-lib.sh"

src=/opt/meshcentral/meshcentral-data

require_root
require_pass
if [[ ! -d "$src" || ! -f "$backup_key" ]]; then
  echo "mesh data or backup key missing" >&2
  exit 1
fi

tmp=$(mktemp /var/tmp/.meshcentral.XXXXXX)
gpg_home
trap 'rm -f "$tmp"; gpg_done' EXIT
tar -C /opt/meshcentral -czf - meshcentral-data | encrypt_to "$tmp"
decrypt_from "$tmp" | tar -tzf - >/dev/null
send_copy mesh "$tmp"
echo "mesh archive encrypted and sent"
