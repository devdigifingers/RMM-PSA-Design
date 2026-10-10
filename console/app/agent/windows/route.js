import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const agentApiUrl = "https://api.digitalfingers.co.za";

export async function GET() {
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
    return new Response("This login is not in an organisation, so it cannot enroll a computer.", { status: 403 });
  }
  const enroll = await fetch(`${apiUrl}/v1/enroll-tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!enroll.ok) {
    return new Response("A new enrollment could not be created.", { status: enroll.status });
  }
  const invite = await enroll.json();
  const exe = await readAgent();
  if (!exe) return new Response("The Windows agent is not available yet.", { status: 404 });
  const env = Buffer.from(
    `DF_API_URL=${agentApiUrl}\r\nDF_ENROLL_TOKEN=${invite.token}\r\n`,
    "utf8",
  );
  const setup = Buffer.from(
    [
      "@echo off",
      "mkdir \"%ProgramData%\\DigitalFingers\" 2>nul",
      "if not exist \"%ProgramData%\\DigitalFingers\\df-agent.env\" copy /Y \"%~dp0df-agent.env\" \"%ProgramData%\\DigitalFingers\\df-agent.env\" >nul",
      "\"%~dp0DigitalFingersAgent.exe\"",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const zip = zipStore([
    { name: "Install.cmd", data: setup },
    { name: "df-agent.env", data: env },
    { name: "DigitalFingersAgent.exe", data: exe },
  ]);
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="DigitalFingersAgent.zip"',
      "cache-control": "no-store",
    },
  });
}

async function readAgent() {
  const candidates = [
    path.join(process.cwd(), "agent-bin", "DigitalFingersAgent.exe"),
    "/opt/df-console/agent-bin/DigitalFingersAgent.exe",
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

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    parts.push(local, name, file.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + file.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
