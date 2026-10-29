import { fromConsole, refused } from "../../request-guard";
import { agentApiUrl, packageAccess, readAgentFile } from "../package";

export async function GET(request) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const access = await packageAccess(request);
  if (access.error) return access.error;
  const exe = await readAgentFile("DigitalFingersAgent.exe");
  if (!exe) return new Response("The Windows agent is not available yet.", { status: 404 });
  const setup = Buffer.from(
    [
      "@echo off",
      "\"%~dp0DigitalFingersAgent.exe\"",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const files = [{ name: "Install.cmd", data: setup }];
  if (!access.update) {
    files.push({
      name: "df-agent.env",
      data: Buffer.from(`DF_API_URL=${agentApiUrl}\r\nDF_ENROLL_TOKEN=${access.enrollToken}\r\n`, "utf8"),
    });
  }
  files.push({ name: "DigitalFingersAgent.exe", data: exe });
  const name = access.update ? "DigitalFingersAgentUpdate.zip" : "DigitalFingersAgent.zip";
  return new Response(zipStore(files), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
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
