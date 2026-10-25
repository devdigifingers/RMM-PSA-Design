#!/bin/bash
# Receive one encrypted backup on this host. Installed as /usr/local/sbin/df-mesh-receive and run as the
# forced command of the df-mesh-backup key; the client names the kind (mesh, platform, config). Does not restore.
set -euo pipefail
umask 077

keep_days=14
keep_min=7

case "${SSH_ORIGINAL_COMMAND:-mesh}" in
  mesh) dest_dir=/var/backups/df-mesh; name=meshcentral; ext=tar.gz.gpg ;;
  platform) dest_dir=/var/backups/df-platform; name=df_platform; ext=dump.gpg ;;
  config) dest_dir=/var/backups/df-config; name=df-config; ext=tar.gz.gpg ;;
  *) echo "unknown backup kind" >&2; exit 1 ;;
esac

if [[ "$(id -u)" -ne 0 ]]; then
  echo "root required" >&2
  exit 1
fi

install -d -m 700 "$dest_dir"
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
tmp=$(mktemp "$dest_dir/.$name.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
if [[ $(stat -c %s "$tmp") -lt 100 ]]; then
  echo "backup too small" >&2
  exit 1
fi
chmod 600 "$tmp"
mv "$tmp" "$dest_dir/$name-${stamp}.${ext}"
trap - EXIT

mapfile -t ranked < <(find "$dest_dir" -maxdepth 1 -type f -name "$name-*" -printf '%T@\t%p\n' | sort -nr | cut -f2-)
for ((i = keep_min; i < ${#ranked[@]}; i++)); do
  if [[ -n "$(find "${ranked[$i]}" -mtime +"$keep_days" -print)" ]]; then
    rm -f -- "${ranked[$i]}"
  fi
done

echo "$name backup written"
