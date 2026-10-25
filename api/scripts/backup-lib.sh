#!/bin/bash
# Shared helpers for the Digital Fingers backup scripts. Sourced, not run.

backup_pass=/root/df-backup.pass
backup_key=/root/.ssh/df-mesh-backup
backup_target=root@169.58.10.76
keep_days=14
keep_min=7

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "root required" >&2
    exit 1
  fi
}

require_pass() {
  if [[ ! -s "$backup_pass" ]]; then
    echo "backup passphrase missing: $backup_pass" >&2
    exit 1
  fi
}

gpg_home() {
  GNUPGHOME=$(mktemp -d)
  export GNUPGHOME
}

gpg_done() {
  gpgconf --homedir "$GNUPGHOME" --kill gpg-agent 2>/dev/null || true
  rm -rf "$GNUPGHOME"
}

encrypt_to() {
  gpg --batch --yes --quiet --no-symkey-cache --pinentry-mode loopback \
    --passphrase-file "$backup_pass" --symmetric --cipher-algo AES256 --output "$1"
}

decrypt_from() {
  gpg --batch --quiet --no-symkey-cache --pinentry-mode loopback \
    --passphrase-file "$backup_pass" --decrypt "$1"
}

send_copy() {
  ssh -T -i "$backup_key" -o BatchMode=yes -o IdentitiesOnly=yes "$backup_target" "$1" < "$2"
}

# Keep everything newer than keep_days, and never fewer than the newest keep_min files.
prune() {
  local dir=$1 pattern=$2 i
  mapfile -t ranked < <(find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@\t%p\n' | sort -nr | cut -f2-)
  for ((i = keep_min; i < ${#ranked[@]}; i++)); do
    if [[ -n "$(find "${ranked[$i]}" -mtime +"$keep_days" -print)" ]]; then
      rm -f -- "${ranked[$i]}"
    fi
  done
}
