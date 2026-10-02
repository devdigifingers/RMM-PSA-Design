#!/bin/bash
# Dump df_platform onto this host. Does not restore.
set -euo pipefail
umask 077

dest_dir=/var/backups/df-platform
keep=7
env_file=/root/df-platform-db.env

if [[ "$(id -u)" -ne 0 ]]; then
  echo "root required" >&2
  exit 1
fi

if [[ -z "${PGHOST:-}" || -z "${PGDATABASE:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

install -d -m 700 "$dest_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
tmp=$(mktemp "$dest_dir/.df_platform.XXXXXX")
trap 'rm -f "$tmp"' EXIT
pg_dump --format=custom --no-password --file="$tmp" --dbname="$PGDATABASE"
chmod 600 "$tmp"
mv "$tmp" "$dest_dir/df_platform-${stamp}.dump"
trap - EXIT

mapfile -t ranked < <(find "$dest_dir" -maxdepth 1 -type f -name 'df_platform-*.dump' -printf '%T@\t%p\n' | sort -nr | cut -f2-)
if ((${#ranked[@]} > keep)); then
  for ((i = keep; i < ${#ranked[@]}; i++)); do
    rm -f -- "${ranked[$i]}"
  done
fi

echo "dump written; kept ${keep}"
