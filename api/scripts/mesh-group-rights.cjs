// Sets one login's rights on a MeshCentral device group to an exact number. meshctrl's
// AddUserToDeviceGroup has no flag for some rights, such as running remote commands.
// Usage: node mesh-group-rights.cjs <group id> <user id> <rights>, with MESH_URL, MESH_USER and
// MESH_PASSWORD in the environment. Prints "Added user ..." on success, like meshctrl.
const WebSocket = require("/opt/meshcentral/node_modules/ws");

const [groupId, userId, rightsText] = process.argv.slice(2);
const rights = Number(rightsText);
const base = String(process.env.MESH_URL || "").replace(/^https:/, "wss:").replace(/^http:/, "ws:");
if (!groupId || !userId || !Number.isInteger(rights) || rights < 0 || !base) {
  console.log("usage: mesh-group-rights.cjs <group id> <user id> <rights>");
  process.exit(2);
}
const auth = `${Buffer.from(String(process.env.MESH_USER || "")).toString("base64")},${Buffer.from(String(process.env.MESH_PASSWORD || "")).toString("base64")}`;
const socket = new WebSocket(`${base.replace(/\/?$/, "/")}control.ashx`, {
  rejectUnauthorized: false,
  headers: { "x-meshauth": auth },
});
const timer = setTimeout(() => {
  console.log("The remote service did not answer.");
  process.exit(1);
}, 20000);
socket.on("open", () => {
  socket.send(JSON.stringify({ action: "addmeshuser", meshid: groupId, userids: [userId], meshadmin: rights, responseid: "df-rights" }));
});
socket.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (message.action !== "addmeshuser" || message.responseid !== "df-rights") return;
  clearTimeout(timer);
  console.log(String(message.result || ""));
  socket.close();
  process.exit(/Added user /.test(String(message.result || "")) ? 0 : 1);
});
socket.on("error", (error) => {
  clearTimeout(timer);
  console.log(error.message);
  process.exit(1);
});
