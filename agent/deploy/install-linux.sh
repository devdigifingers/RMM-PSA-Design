#!/bin/sh
# Installs or updates the Digital Fingers agent and the remote desktop agent.
# Run it from the extracted folder:  sudo ./install.sh
# Remove both agents again with:     sudo ./install.sh --uninstall
set -eu

here=$(cd "$(dirname "$0")" && pwd)
state=/var/lib/df-agent/state.json
envfile=/etc/df-agent.env
mesh=/usr/local/mesh_services/meshagent/meshagent

say() { echo "Digital Fingers Agent: $*"; }
fail() { echo "Digital Fingers Agent: $*" >&2; exit 1; }
enrolled() { grep -q '"deviceToken":"[^"]' "$state" 2>/dev/null; }
mesh_present() { [ -x "$mesh" ] || systemctl cat meshagent.service >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || fail "run this as root, for example: sudo ./install.sh"
[ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1 || fail "this computer does not use systemd, which the agent needs."

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now df-agent df-patch-helper >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/df-agent.service /etc/systemd/system/df-patch-helper.service
  rm -f /usr/local/bin/df-agent /usr/local/sbin/df-patch-helper.py "$envfile"
  rm -rf /var/lib/df-agent
  systemctl daemon-reload
  if [ -x "$mesh" ]; then "$mesh" -fulluninstall >/dev/null 2>&1 || true; fi
  userdel dfagent >/dev/null 2>&1 || true
  getent group dfagent >/dev/null 2>&1 && groupdel dfagent >/dev/null 2>&1 || true
  say "removed. The computer stays listed under Devices until you delete it there."
  exit 0
fi

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "this processor ($(uname -m)) is not supported. Use a 64-bit Intel, AMD or ARM computer." ;;
esac
[ -f "$here/bin/df-agent-$arch" ] || fail "the package is incomplete. Download it again."

if [ -x /usr/bin/apt-get ]; then
  :
elif [ -x /usr/bin/dnf ] || [ -x /usr/bin/yum ]; then
  :
else
  fail "only Debian, Ubuntu, Fedora, CentOS Stream, Rocky Linux and AlmaLinux are supported."
fi
name=$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}" || echo Linux)

was_enrolled=no
enrolled && was_enrolled=yes
if [ "$was_enrolled" = no ] && [ ! -f "$here/df-agent.env" ]; then
  fail "this is the update package and this computer has no agent yet. Download the installer from Downloads in the console."
fi

say "installing on $name ($arch)"
getent group dfagent >/dev/null 2>&1 || groupadd --system dfagent
if ! id dfagent >/dev/null 2>&1; then
  nologin=$(command -v nologin 2>/dev/null || echo /usr/sbin/nologin)
  useradd --system --gid dfagent --no-create-home --home-dir /var/lib/df-agent --shell "$nologin" dfagent
fi

systemctl stop df-agent >/dev/null 2>&1 || true
install -d -m 700 -o dfagent -g dfagent /var/lib/df-agent
install -m 755 -o root -g root "$here/bin/df-agent-$arch" /usr/local/bin/df-agent
if [ "$was_enrolled" = no ]; then
  install -m 640 -o root -g dfagent "$here/df-agent.env" "$envfile"
elif [ ! -f "$envfile" ]; then
  printf 'DF_API_URL=https://api.digitalfingers.co.za\n' > "$envfile"
  chown root:dfagent "$envfile"
  chmod 640 "$envfile"
fi
install -m 644 "$here/units/df-agent.service" /etc/systemd/system/df-agent.service
install -m 644 "$here/units/df-patch-helper.service" /etc/systemd/system/df-patch-helper.service
rm -f /usr/local/sbin/df-patch-helper.py
if command -v restorecon >/dev/null 2>&1; then
  restorecon -F /usr/local/bin/df-agent "$envfile" /etc/systemd/system/df-agent.service /etc/systemd/system/df-patch-helper.service >/dev/null 2>&1 || true
fi
systemctl daemon-reload
systemctl enable df-patch-helper df-agent >/dev/null 2>&1
systemctl restart df-patch-helper
systemctl restart df-agent

if mesh_present; then
  say "the remote desktop agent is already installed."
elif [ -f "$here/mesh/meshagent-$arch" ] && [ -f "$here/mesh/meshagent.msh" ]; then
  work=$(mktemp -d)
  cp "$here/mesh/meshagent-$arch" "$work/meshagent"
  cp "$here/mesh/meshagent.msh" "$work/meshagent.msh"
  chmod 755 "$work/meshagent"
  if (cd "$work" && ./meshagent -fullinstall --copy-msh=1) >"$work/log" 2>&1 && mesh_present; then
    say "the remote desktop agent is installed."
  else
    say "warning: the remote desktop agent did not install. Details:"
    tail -n 20 "$work/log" >&2 || true
  fi
  rm -rf "$work"
fi

if [ "$was_enrolled" = yes ]; then
  say "updated to $(/usr/local/bin/df-agent version 2>/dev/null || echo 'the new version'). This computer stays enrolled."
  exit 0
fi
i=0
while [ "$i" -lt 30 ] && ! enrolled; do
  sleep 1
  i=$((i + 1))
done
if enrolled; then
  say "installed. This computer now appears under Devices."
else
  say "installed, but it has not checked in yet. See why with: journalctl -u df-agent -n 20"
  exit 1
fi
