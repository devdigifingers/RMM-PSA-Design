// Sets the user consent flags on a MeshCentral device group.
// Usage: node set-consent.cjs "<group name>" <flags>
// Flags: 1/2/4 notify desktop/terminal/files, 8/16/32 prompt, 64 privacy bar.
const WebSocket = require("/opt/meshcentral/node_modules/ws");

const groupName = String(process.argv[2] || "");
const flags = Number(process.argv[3]);
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(payload.error ? 1 : 0);
}

if (!groupName || !Number.isInteger(flags) || flags < 0 || flags > 127) out({ error: "Usage: set-consent.cjs <group> <flags>" });
if (!user || !pass || !process.env.MESH_URL) out({ error: "Mesh is not configured." });

let url = String(process.env.MESH_URL).replace(/^https:/, "wss:").replace(/^http:/, "ws:");
if (!url.endsWith("/")) url += "/";
if (!url.includes("control.ashx")) url += "control.ashx";

const ws = new WebSocket(url, {
  rejectUnauthorized: false,
  headers: { "x-meshauth": `${Buffer.from(user).toString("base64")},${Buffer.from(pass).toString("base64")}` },
});
setTimeout(() => out({ error: "MeshCentral did not answer." }), 20000);
ws.on("error", () => out({ error: "MeshCentral did not answer." }));

let step = "find";
ws.on("open", () => ws.send(JSON.stringify({ action: "meshes" })));
ws.on("message", (raw) => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.action !== "meshes") return;
  const group = (m.meshes || []).find((g) => g.name === groupName);
  if (!group) out({ error: "Group not found." });
  if (step === "find") {
    step = "check";
    ws.send(JSON.stringify({ action: "editmesh", meshid: group._id, consent: flags }));
    setTimeout(() => ws.send(JSON.stringify({ action: "meshes" })), 2000);
    return;
  }
  out({ group: group.name, consent: group.consent });
});
