const WebSocket = require("/opt/meshcentral/node_modules/ws");

const nodeId = String(process.argv[2] || "");
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");
let settled = false;

function finish(payload) {
  if (settled) return;
  settled = true;
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

process.on("uncaughtException", () => finish({ error: "MeshCentral did not answer." }));

if (!nodeId || nodeId.length > 300 || !user || !pass || !process.env.MESH_URL) {
  finish({ error: "Remote service is not configured." });
}

let url = String(process.env.MESH_URL).replace(/^https:/, "wss:").replace(/^http:/, "ws:");
if (!url.endsWith("/")) url += "/";
if (!url.includes("control.ashx")) url += "control.ashx";

const ws = new WebSocket(url, {
  rejectUnauthorized: false,
  headers: {
    "x-meshauth": `${Buffer.from(user).toString("base64")},${Buffer.from(pass).toString("base64")}`,
  },
});

const timer = setTimeout(() => {
  ws.terminate();
  finish({ error: "MeshCentral did not answer." });
}, 45000);

ws.on("error", () => {
  clearTimeout(timer);
  finish({ error: "MeshCentral did not answer." });
});

ws.on("open", () => {
  ws.send(JSON.stringify({
    action: "software",
    nodeid: nodeId,
    type: "installedapps",
  }));
});

ws.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (message.action !== "software") return;
  if (message.value == null && message.result == null) return;
  clearTimeout(timer);
  let value = message.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      finish({ error: "MeshCentral did not return the software list." });
      return;
    }
  }
  if (Array.isArray(value)) {
    ws.close();
    finish(value);
    return;
  }
  if (value && typeof value === "object" && value.error) {
    ws.close();
    finish({ error: String(value.error) });
    return;
  }
  if (typeof message.result === "string" && !/^ok$/i.test(message.result)) {
    ws.close();
    finish({ error: message.result });
    return;
  }
  ws.close();
  finish(Array.isArray(value) ? value : []);
});
