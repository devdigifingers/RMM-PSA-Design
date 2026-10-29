import { checkInstallCode, consoleOrigin, linuxPackage } from "../../../agent/package";

// Public: the code in the path is the enrollment key, so curl on a server needs no console login.
export async function GET(request, { params }) {
  const { code } = await params;
  const valid = await checkInstallCode(code);
  const wantsPackage = new URL(request.url).searchParams.get("package") === "1";
  if (wantsPackage) {
    if (!valid) return new Response("This install command is not valid.", { status: 401 });
    const archive = await linuxPackage(code);
    if (!archive) return new Response("The Linux agent is not available yet.", { status: 404 });
    return new Response(archive, {
      headers: { "content-type": "application/gzip", "cache-control": "no-store" },
    });
  }
  const script = valid
    ? installScript(`${consoleOrigin}/i/${code}/linux?package=1`)
    : [
        "#!/bin/sh",
        "echo 'Digital Fingers Agent: this install command has expired, was revoked or has been used up.' >&2",
        "echo 'Create a new one under Downloads in the console.' >&2",
        "exit 1",
        "",
      ].join("\n");
  return new Response(script, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function installScript(url) {
  return [
    "#!/bin/sh",
    "# Digital Fingers Agent command-line installer for Linux.",
    "set -eu",
    `url='${url}'`,
    `[ "$(id -u)" -eq 0 ] || { echo 'Digital Fingers Agent: run this with sudo.' >&2; exit 1; }`,
    "work=$(mktemp -d)",
    `trap 'rm -rf "$work"' EXIT`,
    "if command -v curl >/dev/null 2>&1; then",
    `  curl -fsSL "$url" -o "$work/agent.tar.gz"`,
    "elif command -v wget >/dev/null 2>&1; then",
    `  wget -qO "$work/agent.tar.gz" "$url"`,
    "else",
    "  echo 'Digital Fingers Agent: curl or wget is needed.' >&2",
    "  exit 1",
    "fi",
    `tar xzf "$work/agent.tar.gz" -C "$work"`,
    `sh "$work/DigitalFingersAgent/install.sh"`,
    "",
  ].join("\n");
}
