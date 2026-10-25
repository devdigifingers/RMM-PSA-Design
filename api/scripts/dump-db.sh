#!/bin/bash
# Dump df_platform, encrypt it, keep it here and send a copy to Contabo B. Does not restore.
set -euo pipefail
umask 077
# shellcheck source=backup-lib.sh
source "$(dirname "$0")/backup-lib.sh"

dest_dir=/var/backups/df-platform
env_file=/root/df-platform-db.env

require_root
require_pass

if [[ -z "${PGHOST:-}" || -z "${PGDATABASE:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

install -d -m 700 "$dest_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
tmp=$(mktemp "$dest_dir/.df_platform.XXXXXX")
gpg_home
trap 'rm -f "$tmp" "$tmp.gpg"; gpg_done' EXIT
pg_dump --format=custom --no-password --file="$tmp" --dbname="$PGDATABASE"
pg_restore --list "$tmp" >/dev/null
encrypt_to "$tmp.gpg" < "$tmp"
rm -f "$tmp"
final="$dest_dir/df_platform-${stamp}.dump.gpg"
mv "$tmp.gpg" "$final"
chmod 600 "$final"

prune "$dest_dir" 'df_platform-*.dump*'
send_copy platform "$final"
echo "dump written, encrypted and copied"
