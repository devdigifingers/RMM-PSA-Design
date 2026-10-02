#!/usr/bin/env python3
"""Install one allowlisted apt package. The agent talks to this process; it does not become root."""

import grp
import os
import re
import socket
import subprocess

SOCK = "/run/df-patch-helper.sock"
NAME = re.compile(r"^[a-z0-9][a-z0-9+.-]{0,79}$")


def install(name):
    if not NAME.fullmatch(name or ""):
        return False, "That package name cannot be installed."
    try:
        proc = subprocess.run(
            ["apt-get", "install", "-y", "--only-upgrade", name],
            env={"DEBIAN_FRONTEND": "noninteractive", "LANG": "C", "PATH": "/usr/bin:/bin"},
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return False, "The install timed out."
    detail = (proc.stdout + "\n" + proc.stderr).strip()
    if len(detail) > 1500:
        detail = detail[-1500:]
    if proc.returncode == 0:
        return True, detail or "Installed."
    return False, detail or f"apt-get exited {proc.returncode}."


def main():
    if os.path.exists(SOCK):
        os.unlink(SOCK)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCK)
    os.chown(SOCK, 0, grp.getgrnam("dfagent").gr_gid)
    os.chmod(SOCK, 0o660)
    server.listen(1)
    print("df-patch-helper listening", flush=True)
    while True:
        conn, _ = server.accept()
        with conn:
            data = b""
            while b"\n" not in data and len(data) < 120:
                chunk = conn.recv(120)
                if not chunk:
                    break
                data += chunk
            name = data.split(b"\n", 1)[0].decode("utf-8", "replace").strip()
            ok, detail = install(name)
            print(f"{'ok' if ok else 'fail'} {name}", flush=True)
            prefix = b"ok\n" if ok else b"fail\n"
            conn.sendall(prefix + detail.encode("utf-8", "replace"))


if __name__ == "__main__":
    main()
