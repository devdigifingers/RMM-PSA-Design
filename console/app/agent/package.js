import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
export const agentApiUrl = "https://api.digitalfingers.co.za";

// An install package carries a single-use enrollment token; an update package carries none, so the
// computer keeps the enrollment it already has.
export async function packageAccess(request) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const check = await fetch(`${apiUrl}/v1/account`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!check.ok) redirect("/");
  const account = await check.json();
  if (!account.org) {
    return { error: new Response("This login is not in an organisation, so it cannot enroll a computer.", { status: 403 }) };
  }
  const params = new URL(request.url).searchParams;
  if (params.get("update") === "1") return { update: true };
  const customerId = Number(params.get("customer")) || null;
  const enroll = await fetch(`${apiUrl}/v1/enroll-tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(customerId ? { customerId } : {}),
    cache: "no-store",
  });
  if (!enroll.ok) {
    return { error: new Response("A new enrollment could not be created.", { status: enroll.status }) };
  }
  const invite = await enroll.json();
  return { update: false, enrollToken: invite.token };
}

export async function readAgentFile(...parts) {
  const candidates = [
    path.join(process.cwd(), "agent-bin", ...parts),
    path.join("/opt/df-console/agent-bin", ...parts),
  ];
  for (const file of candidates) {
    try {
      return await readFile(file);
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export const consoleOrigin = process.env.CONSOLE_ORIGIN || "https://rmm.digitalfingers.co.za";

export async function checkInstallCode(code) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code || "")) return false;
  const response = await fetch(`${apiUrl}/v1/agent/install-check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: code }),
    cache: "no-store",
  });
  return response.ok;
}

const LINUX_ROOT = "DigitalFingersAgent";

// Without an enrollment token this is the update package: no key and no remote desktop agent.
export async function linuxPackage(enrollToken) {
  const update = !enrollToken;
  const files = [
    ["install.sh", 0o755],
    ["bin/df-agent-amd64", 0o755, "df-agent-amd64"],
    ["bin/df-agent-arm64", 0o755, "df-agent-arm64"],
    ["units/df-agent.service", 0o644, "df-agent.service"],
    ["units/df-patch-helper.service", 0o644, "df-patch-helper.service"],
  ];
  if (!update) {
    files.push(
      ["mesh/meshagent-amd64", 0o755, "meshagent-amd64"],
      ["mesh/meshagent-arm64", 0o755, "meshagent-arm64"],
      ["mesh/meshagent.msh", 0o600, "meshagent.msh"],
    );
  }
  const dirs = [LINUX_ROOT, `${LINUX_ROOT}/bin`, `${LINUX_ROOT}/units`, ...(update ? [] : [`${LINUX_ROOT}/mesh`])];
  const entries = dirs.map((name) => ({ name: `${name}/`, mode: 0o755 }));
  for (const [name, mode, source] of files) {
    const data = await readAgentFile("linux", source || name);
    if (!data) return null;
    entries.push({ name: `${LINUX_ROOT}/${name}`, mode, data });
  }
  entries.push({ name: `${LINUX_ROOT}/README.txt`, mode: 0o644, data: Buffer.from(linuxReadme(update)) });
  if (!update) {
    entries.push({
      name: `${LINUX_ROOT}/df-agent.env`,
      mode: 0o600,
      data: Buffer.from(`DF_API_URL=${agentApiUrl}\nDF_ENROLL_TOKEN=${enrollToken}\n`),
    });
  }
  return tarGz(entries);
}

function linuxReadme(update) {
  const file = update ? "DigitalFingersAgentUpdate-linux.tar.gz" : "DigitalFingersAgent-linux.tar.gz";
  return [
    update ? "Digital Fingers Agent update for Linux" : "Digital Fingers Agent for Linux",
    "",
    "Works on Ubuntu, Debian, Fedora, CentOS Stream, Rocky Linux and AlmaLinux (64-bit Intel, AMD or ARM).",
    "",
    "In a terminal, in the folder you downloaded to:",
    `  tar xzf ${file}`,
    `  cd ${LINUX_ROOT}`,
    "  sudo ./install.sh",
    "",
    update
      ? "The computer keeps its enrollment. This package cannot install the agent on a new computer."
      : "The computer appears under Devices within a minute. The enrollment key inside works once.",
    "",
    "Servers without a desktop: under Downloads in the console, choose Create install command and paste",
    "the Linux command into an SSH session. It downloads this package and runs install.sh for you.",
    "",
    "To remove the agent:  sudo ./install.sh --uninstall",
    "",
  ].join("\n");
}

export function tarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = entry.data || Buffer.alloc(0);
    blocks.push(tarHeader(entry.name, entry.data ? data.length : 0, entry.mode, entry.data ? "0" : "5"));
    if (data.length) {
      blocks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 6 });
}

function tarHeader(name, size, mode, type) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 7), 100, "ascii");
  header.write(octal(0, 7), 108, "ascii");
  header.write(octal(0, 7), 116, "ascii");
  header.write(octal(size, 11), 124, "ascii");
  header.write(octal(Math.floor(Date.now() / 1000), 11), 136, "ascii");
  header.fill(" ", 148, 156);
  header.write(type, 156, "ascii");
  header.write("ustar\u000000", 257, "ascii");
  header.write("root", 265, "ascii");
  header.write("root", 297, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\u0000 `, 148, "ascii");
  return header;
}

function octal(value, width) {
  return `${value.toString(8).padStart(width, "0")}\u0000`;
}
