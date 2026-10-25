#!/bin/bash
# Encrypt the server configuration and secrets on this host, keep it here and send a copy to Contabo B.
# The backup passphrase itself is not included; keep it in a password manager.
set -euo pipefail
umask 077
# shellcheck source=backup-lib.sh
source "$(dirname "$0")/backup-lib.sh"

dest_dir=/var/backups/df-config

require_root
require_pass

paths=()
for item in /root/df-*.env /root/.ssh/df-mesh-backup /root/.ssh/df-mesh-backup.pub /etc/caddy \
  /etc/systemd/system/df-*.service /etc/systemd/system/df-*.timer /etc/systemd/system/df-*.d \
  /etc/systemd/system/meshcentral.service /opt/meshcentral/meshcentral-data/config.json; do
  [[ -e "$item" ]] && paths+=("${item#/}")
done

install -d -m 700 "$dest_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
tmp=$(mktemp "$dest_dir/.df-config.XXXXXX")
gpg_home
trap 'rm -f "$tmp"; gpg_done' EXIT
tar -C / -czf - "${paths[@]}" | encrypt_to "$tmp"
decrypt_from "$tmp" | tar -tzf - >/dev/null
final="$dest_dir/df-config-${stamp}.tar.gz.gpg"
mv "$tmp" "$final"
chmod 600 "$final"

prune "$dest_dir" 'df-config-*.tar.gz.gpg'
send_copy config "$final"
echo "config archive written, encrypted and copied (${#paths[@]} items)"
