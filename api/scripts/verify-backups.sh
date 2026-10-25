#!/bin/bash
# Check that the newest local backups exist, are recent and decrypt cleanly. Does not restore.
set -euo pipefail
umask 077
# shellcheck source=backup-lib.sh
source "$(dirname "$0")/backup-lib.sh"

require_root
require_pass
gpg_home
trap gpg_done EXIT

problems=0
newest() {
  find "$1" -maxdepth 1 -type f -name "$2" -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -1 | cut -f2-
}
recent() {
  [[ -n "$(find "$1" -mmin -$((26 * 60)) -print)" ]]
}

db=$(newest /var/backups/df-platform 'df_platform-*.dump.gpg')
if [[ -z "$db" ]]; then
  echo "FAIL no encrypted database dump"; problems=$((problems + 1))
else
  tables=$(decrypt_from "$db" | pg_restore --list | grep -c "TABLE DATA" || true)
  if ! recent "$db"; then echo "FAIL database dump older than 26 hours: $db"; problems=$((problems + 1)); fi
  if [[ "$tables" -lt 10 ]]; then echo "FAIL database dump has only $tables tables: $db"; problems=$((problems + 1)); fi
  echo "database dump ok: $(basename "$db"), $tables tables"
fi

cfg=$(newest /var/backups/df-config 'df-config-*.tar.gz.gpg')
if [[ -z "$cfg" ]]; then
  echo "FAIL no config archive"; problems=$((problems + 1))
else
  files=$(decrypt_from "$cfg" | tar -tzf - | wc -l)
  if ! recent "$cfg"; then echo "FAIL config archive older than 26 hours: $cfg"; problems=$((problems + 1)); fi
  echo "config archive ok: $(basename "$cfg"), $files entries"
fi

if ((problems > 0)); then
  echo "$problems backup problem(s)"
  exit 1
fi
echo "backups verified"
