// Sets Mesh user consent flags on one device (node) or one device group, then reads them back.
// Usage: node mesh-consent.cjs node <nodeId> <flags> | node mesh-consent.cjs group <meshId> <flags>
// Mesh ORs server, group, device and user flags for each session, so the strip (64) can be added per device.
const WebSocket = require("/opt/meshcentral/node_modules/ws");

const kind = String(process.argv[2] || "");
const id = String(process.argv[3] || "");
const flags = Number(process.argv[4]);
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

if (kind !== "node" && kind !== "group") finish({ error: "Unknown consent target." });
if (!id || id.length > 300) finish({ error: "Missing Mesh id." });
if (!Number.isInteger(flags) || flags < 0 || flags > 127) finish({ error: "Consent flags must be 0 to 127." });
if (!user || !pass || !process.env.MESH_URL) finish({ error: "Remote service is not configured." });

let url = String(process.env.MESH_URL).replace(/^https:/, "wss:").replace(/^http:/, "ws:");
if (!url.endsWith("/")) url += "/";
if (!url.includes("control.ashx")) url += "control.ashx";

const ws = new WebSocket(url, {
  rejectUnauthorized: false,
  headers: { "x-meshauth": `${Buffer.from(user).toString("base64")},${Buffer.from(pass).toString("base64")}` },
});
setTimeout(() => finish({ error: "MeshCentral did not answer." }), 20000);
ws.on("error", () => finish({ error: "MeshCentral did not answer." }));

let step = "set";
ws.on("open", () => {
  if (kind === "node") ws.send(JSON.stringify({ action: "changedevice", nodeid: id, consent: flags }));
  else ws.send(JSON.stringify({ action: "editmesh", meshid: id, consent: flags }));
  setTimeout(() => {
    step = "check";
    ws.send(JSON.stringify({ action: kind === "node" ? "nodes" : "meshes" }));
  }, 1500);
});

ws.on("message", (raw) => {
  if (step !== "check") return;
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return; }
  if (kind === "group" && message.action === "meshes") {
    const group = (message.meshes || []).find((item) => item._id === id);
    if (!group) finish({ error: "Device group not found." });
    finish({ consent: Number(group.consent) || 0 });
  }
  if (kind === "node" && message.action === "nodes") {
    for (const list of Object.values(message.nodes || {})) {
      const node = Array.isArray(list) ? list.find((item) => item._id === id) : null;
      if (node) finish({ consent: Number(node.consent) || 0 });
    }
    finish({ error: "This device is not in MeshCentral." });
  }
});
