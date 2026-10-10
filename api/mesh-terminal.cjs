const crypto = require("node:crypto");
const fs = require("node:fs");
const WebSocket = require("/opt/meshcentral/node_modules/ws");

const nodeId = String(process.argv[2] || "");
const protocol = Number(process.argv[3] || 0);
const cols = Math.min(220, Math.max(40, Number(process.argv[4] || 100)));
const rows = Math.min(80, Math.max(10, Number(process.argv[5] || 30)));
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");
let settled = false;
let started = false;
let control = null;
let relay = null;

function fail(message) {
  if (settled) return;
  settled = true;
  try { control?.close(); } catch { /* already closed */ }
  try { relay?.close(); } catch { /* already closed */ }
  process.stderr.write(`ERR ${message}\n`);
  process.exit(1);
}

if (!nodeId || nodeId.length > 300 || !user || !pass || !process.env.MESH_URL) fail("Remote service is not configured.");
if (![1, 6, 8, 9].includes(protocol)) fail("Choose a shell.");

const source = new URL(String(process.env.MESH_URL).replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
const socketBase = `${source.protocol === "https:" ? "wss:" : "ws:"}//${source.host}${source.pathname.replace(/\/control\.ashx$/, "/")}`;
const authHeader = `${Buffer.from(user).toString("base64")},${Buffer.from(pass).toString("base64")}`;
const timer = setTimeout(() => fail("MeshCentral did not answer."), 25000);

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function beginShell() {
  if (started) return;
  started = true;
  clearTimeout(timer);
  sendJson(relay, { ctrlChannel: "102938", type: "options", cols, rows });
  relay.send(String(protocol));
  process.stderr.write("READY\n");
  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    if (relay && relay.readyState === 1) relay.send(chunk);
  });
  let pending = "";
  let resizeIn;
  try { resizeIn = fs.createReadStream("", { fd: 3, autoClose: false }); } catch { resizeIn = null; }
  resizeIn?.on("error", () => {});
  resizeIn?.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    let split = pending.indexOf("\n");
    while (split >= 0) {
      const line = pending.slice(0, split);
      pending = pending.slice(split + 1);
      try {
        const size = JSON.parse(line);
        const nextCols = Math.min(220, Math.max(40, Number(size.cols) || cols));
        const nextRows = Math.min(80, Math.max(10, Number(size.rows) || rows));
        if (relay && relay.readyState === 1) sendJson(relay, { ctrlChannel: "102938", type: "termsize", cols: nextCols, rows: nextRows });
      } catch { /* ignore a partial size update */ }
      split = pending.indexOf("\n");
    }
  });
}

function openRelay(cookie, relayAuth) {
  const tunnel = crypto.randomBytes(6).toString("hex");
  const address = new URL(`${socketBase}meshrelay.ashx`);
  address.searchParams.set("browser", "1");
  address.searchParams.set("p", "1");
  address.searchParams.set("nodeid", nodeId);
  address.searchParams.set("id", tunnel);
  address.searchParams.set("auth", cookie);
  sendJson(control, {
    action: "msg",
    type: "tunnel",
    nodeid: nodeId,
    usage: 1,
    value: `*/meshrelay.ashx?p=1&nodeid=${encodeURIComponent(nodeId)}&id=${tunnel}&rauth=${encodeURIComponent(relayAuth)}`,
    responseid: "df-terminal",
  });
  relay = new WebSocket(address, { rejectUnauthorized: false });
  relay.on("error", () => fail("MeshCentral did not answer."));
  relay.on("close", () => {
    if (!settled) fail("The shell stopped.");
  });
  relay.on("message", (raw) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const text = buf.toString("utf8");
    if (!started && (text === "c" || text === "cr")) {
      beginShell();
      return;
    }
    if (text.startsWith("{")) {
      let message;
      try { message = JSON.parse(text); } catch { process.stdout.write(buf); return; }
      if (message.ctrlChannel === "102938") {
        if (message.type === "ping") sendJson(relay, { ctrlChannel: "102938", type: "pong" });
        else if (message.type === "console" && message.msg) process.stdout.write(`\r\n${String(message.msg)}\r\n`);
        return;
      }
    }
    process.stdout.write(buf);
  });
}

control = new WebSocket(`${socketBase}control.ashx`, {
  rejectUnauthorized: false,
  headers: { "x-meshauth": authHeader },
});
control.on("error", () => fail("MeshCentral did not answer."));
control.on("open", () => sendJson(control, { action: "authcookie" }));
control.on("message", (raw) => {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (!text || text.charCodeAt(0) !== 123) return;
  let message;
  try { message = JSON.parse(text); } catch { return; }
  if (message.action === "close" || message.cause === "noauth") {
    fail("MeshCentral did not allow the shell.");
    return;
  }
  if (message.action === "msg" && message.responseid === "df-terminal" && message.result && message.result !== "OK") {
    fail("MeshCentral did not answer.");
    return;
  }
  if (message.action === "authcookie" && message.cookie && message.rcookie && !relay) openRelay(message.cookie, message.rcookie);
});
