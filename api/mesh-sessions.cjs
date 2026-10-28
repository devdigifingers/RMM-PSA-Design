const WebSocket = require("/opt/meshcentral/node_modules/ws");

const kind = String(process.argv[2] || "");
const nodeId = String(process.argv[3] || "");
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");
const TUNNELS = ["kvm", "terminal", "files", "tcp", "udp"];
let settled = false;
let step = "";
let ended = 0;

function finish(payload) {
  if (settled) return;
  settled = true;
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

process.on("uncaughtException", () => finish({ error: "MeshCentral did not answer." }));

if (!user || !pass || !process.env.MESH_URL) finish({ error: "Remote service is not configured." });
if (kind !== "list" && kind !== "end" && kind !== "restart") finish({ error: "Unknown session action." });
if ((kind === "end" || kind === "restart") && (!nodeId || nodeId.length > 300)) {
  finish({ error: "That device has no remote agent." });
}

function count(map) {
  let total = 0;
  for (const [key, value] of Object.entries(map || {})) {
    if (key.startsWith("user/")) total += Number(value) || 0;
  }
  return total;
}

function summary(sessions) {
  const s = sessions || {};
  const desktop = count(s.multidesk || s.kvm);
  const terminal = count(s.terminal);
  const files = count(s.files);
  const other = count(s.tcp) + count(s.udp) + count(s.registry);
  return { desktop, terminal, files, other, total: desktop + terminal + files + other };
}

function viewer(key) {
  const part = key.split("/");
  const out = { xuserid: part.slice(0, 3).join("/") };
  if (part.length === 4 && part[3].startsWith("guest:")) {
    out.guestname = Buffer.from(part[3].slice(6), "base64").toString("utf8");
  }
  return out;
}

function allNodes(message) {
  const list = [];
  for (const group of Object.values(message.nodes || {})) {
    if (Array.isArray(group)) list.push(...group);
  }
  return list;
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
  if (kind === "restart" && step !== "find") finish({ restarted: true, back: false, remaining: lastSeen });
  finish({ error: "MeshCentral did not answer." });
}, kind === "restart" ? 80000 : 30000);
let dropped = false;
let polls = 0;
let lastSeen = { desktop: 0, terminal: 0, files: 0, other: 0, total: 0 };

function done(payload) {
  clearTimeout(timer);
  try { ws.close(); } catch {}
  finish(payload);
}

ws.on("error", () => done({ error: "MeshCentral did not answer." }));

ws.on("open", () => {
  if (kind === "list") {
    step = "list";
    ws.send(JSON.stringify({ action: "nodes" }));
    return;
  }
  step = "find";
  ws.send(JSON.stringify({ action: "nodes" }));
});

function endTunnels(sessions) {
  const s = sessions || {};
  for (const key of Object.keys(s.multidesk || {})) {
    if (!key.startsWith("user/")) continue;
    ws.send(JSON.stringify({ action: "endDesktopMultiplex", nodeid: nodeId, ...viewer(key) }));
    ended += Number(s.multidesk[key]) || 1;
  }
  for (const protocol of TUNNELS) {
    for (const key of Object.keys(s[protocol] || {})) {
      if (!key.startsWith("user/")) continue;
      const who = viewer(key);
      if (protocol === "kvm") ws.send(JSON.stringify({ action: "endDesktopMultiplex", nodeid: nodeId, ...who }));
      ws.send(JSON.stringify({ action: "msg", type: "endtunnel", nodeid: nodeId, protocol, ...who }));
      if (protocol !== "kvm" || !s.multidesk) ended += Number(s[protocol][key]) || 1;
    }
  }
}

ws.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (step === "list" && message.action === "nodes") {
    const out = {};
    for (const node of allNodes(message)) {
      const view = summary(node.sessions);
      if (node._id && view.total) out[node._id] = view;
    }
    done({ sessions: out });
    return;
  }
  if (step === "find" && message.action === "nodes") {
    const node = allNodes(message).find((item) => item._id === nodeId);
    if (!node) {
      done({ error: "This device is not in MeshCentral." });
      return;
    }
    if (kind === "restart") {
      if (!((node.conn || 0) & 1)) {
        done({ error: "The agent is offline, so it can't be restarted remotely." });
        return;
      }
      ws.send(JSON.stringify({ action: "msg", type: "console", nodeid: nodeId, value: "service restart" }));
      step = "restart";
      setTimeout(() => ws.send(JSON.stringify({ action: "nodes" })), 3000);
      return;
    }
    endTunnels(node.sessions);
    step = "check";
    setTimeout(() => {
      if (!settled) ws.send(JSON.stringify({ action: "nodes" }));
    }, ended ? 4000 : 0);
    return;
  }
  if (step === "restart" && message.action === "nodes") {
    const node = allNodes(message).find((item) => item._id === nodeId);
    const online = Boolean(node && ((node.conn || 0) & 1));
    lastSeen = summary(node && node.sessions);
    if (!online) dropped = true;
    polls += 1;
    if (online && !lastSeen.total && (dropped || polls >= 2)) {
      done({ restarted: true, back: true, remaining: lastSeen });
      return;
    }
    setTimeout(() => { if (!settled) ws.send(JSON.stringify({ action: "nodes" })); }, 3000);
    return;
  }
  if (step === "check" && message.action === "nodes") {
    const node = allNodes(message).find((item) => item._id === nodeId);
    done({ ended, remaining: summary(node && node.sessions) });
  }
});
