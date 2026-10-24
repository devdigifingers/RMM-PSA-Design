const crypto = require("node:crypto");
const fs = require("node:fs");
const WebSocket = require("/opt/meshcentral/node_modules/ws");

const nodeId = String(process.argv[2] || "");
const action = String(process.argv[3] || "");
const targetPath = String(process.argv[4] || "");
const entryName = String(process.argv[5] || "");
const localFile = String(process.argv[6] || "");
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");
let settled = false;
let idleTimer = null;
let control = null;
let relay = null;
let uploadOffset = 0;
let uploadSize = 0;
let uploadAcked = 0;
let uploadFd = null;
let downloadFd = null;
const uploadPending = [];

function stage(name) {
  if (process.env.DF_FILE_DEBUG === "1") process.stderr.write(`${name}\n`);
}

function finish(payload) {
  if (settled) return;
  settled = true;
  if (idleTimer) clearTimeout(idleTimer);
  try { if (uploadFd != null) fs.closeSync(uploadFd); } catch { /* already closed */ }
  try { if (downloadFd != null) fs.closeSync(downloadFd); } catch { /* already closed */ }
  try { control?.close(); } catch { /* socket already gone */ }
  try { relay?.close(); } catch { /* socket already gone */ }
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

process.on("uncaughtException", () => finish({ error: "MeshCentral did not answer." }));

if (!nodeId || nodeId.length > 300 || !user || !pass || !process.env.MESH_URL) {
  finish({ error: "Remote service is not configured." });
}
if (!["ls", "mkdir", "upload", "download"].includes(action)) finish({ error: "Unknown file action." });
if (targetPath.length > 400 || targetPath.includes("\0") || targetPath.split(/[/\\]/).includes("..")) {
  finish({ error: "That folder is not available." });
}
if ((action === "mkdir" || action === "upload" || action === "download") && (!entryName || entryName.length > 120 || /[\\/\0:*?"<>|]/.test(entryName) || entryName === "." || entryName === "..")) {
  finish({ error: "Enter a file name." });
}
const entryKind = String(process.argv[6] || "");
const savedFile = action === "download" ? String(process.argv[7] || "") : localFile;
let expectedSize = Number(process.argv[8] || 0);
if (action === "download" && !["file", "folder"].includes(entryKind)) finish({ error: "Choose a file." });
if (action === "download" && !savedFile) finish({ error: "The file was not downloaded." });
let downloadBytes = 0;
let packing = false;
let sizing = false;
let sawZip = false;
let zipName = "";
const downloadLimit = 256 * 1024 * 1024;
const downloadWindow = 8;

const source = new URL(String(process.env.MESH_URL).replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
const socketBase = `${source.protocol === "https:" ? "wss:" : "ws:"}//${source.host}${source.pathname.replace(/\/control\.ashx$/, "/")}`;
const authHeader = `${Buffer.from(user).toString("base64")},${Buffer.from(pass).toString("base64")}`;
const startedAt = Date.now();
const idleLimit = action === "download" ? 45000 : action === "upload" ? 180000 : 40000;
const maxLimit = action === "download" ? 20 * 60 * 1000 : action === "upload" ? 6 * 60 * 60 * 1000 : idleLimit;
function stall() {
  if (action !== "download") {
    finish({ error: "MeshCentral did not answer." });
    return;
  }
  if (packing && !sawZip) finishDownload({ error: "That folder could not be packed." });
  else finishDownload({ error: "The download stopped before it finished." });
}
function touch() {
  if (settled) return;
  if (idleTimer) clearTimeout(idleTimer);
  const remain = maxLimit - (Date.now() - startedAt);
  if (remain <= 0) {
    stall();
    return;
  }
  idleTimer = setTimeout(stall, Math.min(idleLimit, remain));
}
touch();

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function listing(message) {
  const dir = Array.isArray(message.dir) ? message.dir : null;
  if (!dir) return { error: "That folder is not available." };
  const entries = dir
    .filter((item) => item && typeof item.n === "string" && item.n !== "." && item.n !== "..")
    .map((item) => ({
      name: item.t === 1 ? item.n.replace(/[\\/]+$/, "") : item.n,
      kind: item.t === 1 ? "drive" : item.t === 2 ? "folder" : "file",
      size: item.t === 3 ? Number(item.s) || 0 : null,
      modified: item.d || null,
    }))
    .sort((a, b) => {
      const rank = (entry) => (entry.kind === "file" ? 1 : 0);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  return { path: typeof message.path === "string" ? message.path.replace(/\\/g, "/") : targetPath, entries };
}

function reportUpload() {
  process.stderr.write(`P ${uploadAcked} ${uploadSize}\n`);
}

function sendUploadChunk() {
  if (uploadOffset >= uploadSize) {
    if (uploadPending.length === 0) sendJson(relay, { action: "uploaddone", reqid: 1 });
    return;
  }
  const length = Math.min(65536, uploadSize - uploadOffset);
  const chunk = Buffer.alloc(length);
  fs.readSync(uploadFd, chunk, 0, length, BigInt(uploadOffset));
  uploadOffset += length;
  uploadPending.push(length);
  const payload = chunk[0] === 0 || chunk[0] === 123 ? Buffer.concat([Buffer.from([0]), chunk]) : chunk;
  relay.send(payload);
}

function noteUploadAck() {
  const length = uploadPending.shift() || 0;
  uploadAcked += length;
  reportUpload();
  sendUploadChunk();
}

function agentPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

let downloadEnding = false;
function finishDownload(payload) {
  if (settled || downloadEnding) return;
  downloadEnding = true;
  if (idleTimer) clearTimeout(idleTimer);
  if (downloadFd != null) {
    try { fs.closeSync(downloadFd); } catch { /* already closed */ }
    downloadFd = null;
  }
  if (zipName && relay && relay.readyState === 1) {
    sendJson(relay, { action: "rm", reqid: 9, path: agentPath(targetPath), delfiles: [zipName], rec: false });
    zipName = "";
    setTimeout(() => finish(payload), 500);
    return;
  }
  finish(payload);
}

function phase(name) {
  process.stderr.write(`S ${name}\n`);
}

function openDownload(fullPath) {
  phase("Downloading");
  process.stderr.write(`P 0 ${expectedSize}\n`);
  downloadFd = fs.openSync(savedFile, "w");
  sendJson(relay, { action: "download", sub: "start", id: 1, path: fullPath });
}

function takeDownload(buf) {
  if (!downloadFd || buf.length < 4) return;
  touch();
  const end = (buf.readUInt32BE(0) & 1) !== 0;
  const payload = buf.subarray(4);
  if (payload.length) fs.writeSync(downloadFd, payload);
  downloadBytes += payload.length;
  process.stderr.write(`P ${downloadBytes} ${expectedSize}\n`);
  if (downloadBytes > downloadLimit) {
    sendJson(relay, { action: "download", sub: "stop", id: 1 });
    finishDownload({ error: "That file is larger than 256 MB." });
    return;
  }
  if (end) finishDownload({ ok: true, name: entryKind === "folder" ? `${entryName}.zip` : entryName, bytes: downloadBytes });
  else sendJson(relay, { action: "download", sub: "ack", id: 1 });
}

function beginFileCommand() {
  const folder = agentPath(targetPath);
  relay.send("5");
  if (action === "ls") sendJson(relay, { action: "ls", reqid: 1, path: folder });
  if (action === "mkdir") {
    const full = folder ? `${folder}/${entryName}` : entryName;
    sendJson(relay, { action: "mkdir", reqid: 1, path: full });
    setTimeout(() => {
      if (!settled) sendJson(relay, { action: "ls", reqid: 2, path: folder });
    }, 600);
  }
  if (action === "upload") {
    try {
      uploadSize = fs.statSync(localFile).size;
      uploadFd = fs.openSync(localFile, "r");
    } catch {
      finish({ error: "The file could not be read." });
      return;
    }
    sendJson(relay, {
      action: "upload",
      reqid: 1,
      path: agentPath(targetPath),
      name: entryName,
      size: uploadSize,
    });
  }
  if (action === "download") {
    const full = folder ? `${folder}/${entryName}` : entryName;
    if (entryKind === "folder") {
      packing = true;
      zipName = `dfdl-${crypto.randomBytes(4).toString("hex")}.zip`;
      phase("Zipping");
      process.stderr.write("Z 0\n");
      sendJson(relay, { action: "zip", path: folder, files: [entryName], output: zipName });
      return;
    }
    openDownload(full);
  }
}

function openRelay(cookie, relayAuth) {
  const tunnel = crypto.randomBytes(6).toString("hex");
  const address = new URL(`${socketBase}meshrelay.ashx`);
  address.searchParams.set("browser", "1");
  address.searchParams.set("p", "5");
  address.searchParams.set("nodeid", nodeId);
  address.searchParams.set("id", tunnel);
  address.searchParams.set("auth", cookie);
  sendJson(control, {
    action: "msg",
    type: "tunnel",
    nodeid: nodeId,
    usage: 5,
    value: `*/meshrelay.ashx?p=5&nodeid=${encodeURIComponent(nodeId)}&id=${tunnel}&rauth=${encodeURIComponent(relayAuth)}`,
    responseid: "df-files",
  });
  stage("relay-open");
  relay = new WebSocket(address, { rejectUnauthorized: false });
  relay.on("error", () => { stage("relay-error"); finish({ error: "MeshCentral did not answer." }); });
  relay.on("close", () => {
    stage("relay-close");
    if (!settled) {
      if (action === "download") finishDownload({ error: "The download stopped before it finished." });
      else finish({ error: "MeshCentral did not answer." });
    }
  });
  relay.on("message", (raw) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (action === "download" && buf.length >= 4 && buf[0] === 1) {
      takeDownload(buf);
      return;
    }
    const text = buf.toString("utf8");
    stage(`relay:${text === "c" || text === "cr" ? text : text.charCodeAt(0) === 123 ? "json" : "data"}`);
    if (text === "c" || text === "cr") {
      touch();
      beginFileCommand();
      return;
    }
    if (!text || text.charCodeAt(0) !== 123) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    touch();
    if (message.ctrlChannel === "102938") {
      if (message.type === "ping") sendJson(relay, { ctrlChannel: "102938", type: "pong" });
      if (message.type === "console" && message.msg) finish({ error: "The person at the computer needs to allow file access." });
      return;
    }
    if (message.action === "close" || message.cause === "noauth") {
      finish({ error: "MeshCentral did not allow the file session." });
      return;
    }
    if (action === "upload") {
      if (message.action === "uploadstart") {
        reportUpload();
        if (uploadSize === 0) sendJson(relay, { action: "uploaddone", reqid: 1 });
        else for (let index = 0; index < 16; index += 1) sendUploadChunk();
        return;
      }
      if (message.action === "uploadack") {
        noteUploadAck();
        return;
      }
      if (message.action === "uploaddone") finish({ ok: true, name: entryName });
      if (message.action === "uploaderror") finish({ error: "The file was not uploaded." });
      return;
    }
    if (action === "download") {
      if (message.action === "download" && message.sub === "start") {
        sendJson(relay, { action: "download", sub: "startack", id: 1 });
        for (let index = 1; index < downloadWindow; index += 1) sendJson(relay, { action: "download", sub: "ack", id: 1 });
        return;
      }
      if (message.action === "download" && message.sub === "cancel") {
        finishDownload({ error: "The file was not downloaded." });
        return;
      }
      if (message.action === "refresh" && packing) {
        packing = false;
        sizing = true;
        sendJson(relay, { action: "ls", reqid: 3, path: agentPath(targetPath) });
        return;
      }
      if (sizing && (message.path != null || Array.isArray(message.dir))) {
        sizing = false;
        const dir = Array.isArray(message.dir) ? message.dir : [];
        const item = dir.find((entry) => entry && entry.n === zipName);
        const size = item ? Number(item.s) || 0 : 0;
        if (!item) {
          finishDownload({ error: "That folder could not be packed." });
          return;
        }
        if (size > downloadLimit) {
          finishDownload({ error: "That file is larger than 256 MB." });
          return;
        }
        expectedSize = size;
        openDownload(`${agentPath(targetPath)}/${zipName}`);
        return;
      }
      if (message.action === "dialogmessage") {
        if (message.msg === "zipping" || message.msg === "zippingFile") {
          sawZip = true;
          const progress = Math.max(0, Math.min(99, Math.round(Number(message.progress) || 0)));
          process.stderr.write(`Z ${progress}\n`);
          return;
        }
        if (message.msg && /error/i.test(String(message.msg))) finishDownload({ error: "That folder could not be packed." });
      }
      return;
    }
    if (message.path != null || Array.isArray(message.dir) || message.dir === null) finish(listing(message));
  });
}

control = new WebSocket(`${socketBase}control.ashx`, {
  rejectUnauthorized: false,
  headers: { "x-meshauth": authHeader },
});
control.on("error", () => { stage("control-error"); finish({ error: "MeshCentral did not answer." }); });
control.on("close", () => stage("control-close"));
control.on("open", () => { stage("control-open"); sendJson(control, { action: "authcookie" }); });
control.on("message", (raw) => {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (!text || text.charCodeAt(0) !== 123) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  stage(`control:${message.action || "none"}:${Object.keys(message).filter((key) => !["cookie", "rcookie"].includes(key)).join(",")}`);
  if (message.action === "close" || message.cause === "noauth") {
    finish({ error: "MeshCentral did not allow the file session." });
    return;
  }
  if (message.action === "msg" && message.responseid === "df-files" && message.result && message.result !== "OK") {
    finish({ error: "MeshCentral did not answer." });
    return;
  }
  if (message.action === "authcookie" && message.cookie && message.rcookie && !relay) {
    openRelay(message.cookie, message.rcookie);
  }
});
