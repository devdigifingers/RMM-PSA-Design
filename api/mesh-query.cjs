const WebSocket = require("/opt/meshcentral/node_modules/ws");

const nodeId = String(process.argv[2] || "");
const kind = String(process.argv[3] || "");
const extra = String(process.argv[4] || "").trim();
const rename = kind === "rename" ? extra : "";
const listOnly = kind === "processes" && extra === "list";
const killPid = kind === "kill" ? extra : "";
const user = String(process.env.MESH_USER || "");
const pass = String(process.env.MESH_PASSWORD || "");
const sessionId = "df-diag";
let settled = false;
let buffer = "";
let processes = null;
let perfTimer = null;
let perfPass = 0;
let perfSample = null;
let startupItems = null;
let startupTimer = null;
let serviceItems = null;
let serviceTimer = null;

const setHive = kind === "startup-set" ? String(process.argv[4] || "") : "";
const setPath = kind === "startup-set" ? String(process.argv[5] || "") : "";
const setName = kind === "startup-set" ? String(process.argv[6] || "") : "";
const setOn = kind === "startup-set" ? String(process.argv[7] || "") : "";
const serviceAction = kind === "service-set" ? String(process.argv[4] || "") : "";
const serviceName = kind === "service-set" ? String(process.argv[5] || "") : "";

const SERVICE_WMI = 'wmi CIMV2 "SELECT Name,StartMode,StartName,Description FROM Win32_Service" su';
const SERVICE_ACTIONS = new Set(["stop", "start", "restart", "pause", "resume", "manual", "auto", "disabled"]);

const APPROVED_COMMAND = "eval \"(function(){try{var r=require('win-registry');var o={};var users={};function byte(b){if(b==null)return null;if(typeof b=='number')return b&255;try{if(typeof b.readUInt8=='function')return b.readUInt8(0);}catch(e){}try{if(b.length&&typeof b[0]=='number')return b[0];}catch(e){}return null;}function put(k,b){o[k]=byte(b);}function walk(h,p,hive){try{var q=r.QueryKey(h,p);var i;for(i=0;i<q.values.length;i++){try{put(hive+'|'+p+'|'+q.values[i],r.QueryKey(h,p,q.values[i]));}catch(e){}}}catch(e){}}var base='SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Explorer\\\\StartupApproved\\\\';walk(r.HKEY.LocalMachine,base+'Run','HKLM');walk(r.HKEY.LocalMachine,base+'Run32','HKLM');walk(r.HKEY.LocalMachine,base+'StartupFolder','HKLM');try{var u=r.QueryKey(r.HKEY.Users);var j;for(j=0;j<u.subkeys.length;j++){var s=u.subkeys[j];if(s.indexOf('S-1-5-')!=0||s.indexOf('_Classes')>=0)continue;walk(r.HKEY.Users,s+'\\\\'+base+'Run','HKU');walk(r.HKEY.Users,s+'\\\\'+base+'Run32','HKU');walk(r.HKEY.Users,s+'\\\\'+base+'StartupFolder','HKU');}}catch(e){}try{var pl=r.QueryKey(r.HKEY.LocalMachine,'SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\ProfileList');var n;for(n=0;n<pl.subkeys.length;n++){var sid=pl.subkeys[n];if(sid.indexOf('S-1-5-21-')!=0)continue;try{var img=r.QueryKey(r.HKEY.LocalMachine,'SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\ProfileList\\\\'+sid,'ProfileImagePath');var who=String(img).split('\\\\').pop().toLowerCase();if(who)users[who]=sid;}catch(e){}}}catch(e){}return '\\u0001'+JSON.stringify({approved:o,users:users});}catch(e){return '\\u0001'+JSON.stringify({error:String(e)});}})()\"";

function startupSetAllowed(hive, path, name, on) {
  if (hive !== "HKLM" && hive !== "HKU") return false;
  if (!/^(?:S-1-5-[0-9-]+\\)?SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\(?:Run|Run32|StartupFolder)$/.test(path)) return false;
  if (hive === "HKLM" && path.startsWith("S-1-")) return false;
  if (hive === "HKU" && !path.startsWith("S-1-5-")) return false;
  if (on !== "0" && on !== "1") return false;
  if (!name || name.length > 220 || /[\\/\u0000-\u001f]/.test(name)) return false;
  return true;
}

function jsSingle(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function serviceNameAllowed(name) {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$/.test(name) && !/mesh\s*agent/i.test(name);
}

function serviceControlCommand(action, name) {
  if (action === "restart") return `service restart ${name.includes(" ") ? `"${name}"` : name}`;
  const sc = { stop: "stop", start: "start", pause: "pause", resume: "continue" }[action];
  const mode = { manual: "demand", auto: "auto", disabled: "disabled" }[action];
  const args = sc
    ? `[${jsSingle(sc)},${jsSingle(name)}]`
    : `['config',${jsSingle(name)},'start=',${jsSingle(mode)}]`;
  return `eval "(function(){try{var c=require('child_process');c.execFileSync('sc.exe',${args},{encoding:'utf8'});return '\\u0001'+JSON.stringify({ok:true});}catch(e){return '\\u0001'+JSON.stringify({error:String(e&&e.message||e).slice(0,160)});}})()"`;
}

function mergeServices(items, details) {
  const byName = new Map();
  for (const row of Array.isArray(details) ? details : []) {
    if (row && row.Name) byName.set(String(row.Name).toLowerCase(), row);
  }
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const extra = byName.get(String(item.name || "").toLowerCase()) || {};
    return {
      name: item.name,
      displayName: item.displayName,
      status: item.status,
      startMode: extra.StartMode || "",
      startName: extra.StartName || "",
      description: extra.Description || "",
    };
  });
}

function startupSetCommand(hive, path, name, on) {
  const hiveExpr = hive === "HKLM" ? "r.HKEY.LocalMachine" : "r.HKEY.Users";
  const flag = on === "1" ? "2" : "3";
  return `eval "(function(){try{var r=require('win-registry');var hive=${hiveExpr};var path=${jsSingle(path)};var name=${jsSingle(name)};var bytes=[${flag},0,0,0,0,0,0,0,0,0,0,0];try{var cur=r.QueryKey(hive,path,name);var n=cur&&cur.length?cur.length:0;for(var i=1;i<12&&i<n;i++){var x=null;try{x=typeof cur.readUInt8=='function'?cur.readUInt8(i):cur[i];}catch(e){}if(typeof x=='number')bytes[i]=x;}}catch(e){}var b;try{b=Buffer.alloc(12);}catch(e){b=new Buffer(12);}for(var j=0;j<12;j++){if(typeof b.writeUInt8=='function')b.writeUInt8(bytes[j],j);else b[j]=bytes[j];}if(typeof b.copy!='function'){b.copy=function(t){for(var k=0;k<12;k++){if(typeof t.writeUInt8=='function')t.writeUInt8(bytes[k],k);else t[k]=bytes[k];}};}r.WriteKey(hive,path,name,b);return '\\u0001'+JSON.stringify({ok:true});}catch(e){return '\\u0001'+JSON.stringify({error:String(e)});}})()"`;
}

function cleanApproved(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const approved = {};
  for (const [key, value] of Object.entries(parsed.approved || {})) {
    approved[String(key).replace(/\\+/g, "\\")] = value;
  }
  return { approved, users: parsed.users || {}, error: parsed.error, ok: parsed.ok };
}

function takeMarked(text) {
  const raw = String(text || "");
  let at = raw.indexOf("\u0001");
  let skip = 1;
  if (at < 0) {
    at = raw.indexOf("\\u0001");
    skip = 6;
  }
  if (at < 0) return null;
  let body = raw.slice(at + skip).trim();
  if (body.endsWith('"')) body = body.slice(0, -1).trim();
  const candidates = [body, body.replace(/\\"/g, '"'), body.replace(/\\"/g, '"').replace(/\\\\/g, "\\")];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return cleanApproved(parsed);
    } catch {
      // try the next unescape
    }
  }
  return null;
}

const QUERIES = {
  events: 'wmi CIMV2 "SELECT LogfileName,NumberOfRecords,FileSize,MaxFileSize FROM Win32_NTEventlogFile" su',
  users: 'wmi CIMV2 "SELECT Name,FullName,Disabled,Status FROM Win32_UserAccount WHERE LocalAccount=TRUE" su',
  groups: 'wmi CIMV2 "SELECT Name,Description FROM Win32_Group WHERE LocalAccount=TRUE" su',
  shares: 'wmi CIMV2 "SELECT Name,Path,Description FROM Win32_Share" su',
  printers: 'wmi CIMV2 "SELECT Name,PortName,PrinterStatus,Default FROM Win32_Printer" su',
  startup: 'wmi CIMV2 "SELECT Name,Command,Location,User FROM Win32_StartupCommand" su',
};

const PERF_QUERY = 'wmi CIMV2 "SELECT IDProcess,Name,PercentProcessorTime,WorkingSet FROM Win32_PerfFormattedData_PerfProc_Process" su';

const MESSAGES = {
  processes: "ps",
  services: "services",
};

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
if (kind === "kill") {
  if (!/^[1-9]\d{0,9}$/.test(killPid) || Number(killPid) > 2147483647) finish({ error: "That process is not available." });
} else if (kind === "startup-set") {
  if (!startupSetAllowed(setHive, setPath, setName, setOn)) finish({ error: "That startup item cannot be changed." });
} else if (kind === "service-set") {
  if (!SERVICE_ACTIONS.has(serviceAction) || !serviceNameAllowed(serviceName)) finish({ error: "That service cannot be changed." });
} else if (kind === "rename") {
  if (!rename || rename.length > 80 || /[\u0000-\u001f]/.test(rename)) finish({ error: "Enter a device name." });
} else if (!QUERIES[kind] && !MESSAGES[kind]) finish({ error: "Unknown diagnostic." });

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
  if (kind === "rename") {
    ws.send(JSON.stringify({
      action: "changedevice",
      nodeid: nodeId,
      name: rename,
      responseid: "df-rename",
    }));
    return;
  }
  if (kind === "kill") {
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: `kill ${killPid}`,
    }));
    return;
  }
  if (kind === "startup-set") {
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: startupSetCommand(setHive, setPath, setName, setOn),
    }));
    return;
  }
  if (kind === "service-set") {
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: serviceControlCommand(serviceAction, serviceName),
    }));
    return;
  }
  if (QUERIES[kind]) {
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: QUERIES[kind],
    }));
    return;
  }
  ws.send(JSON.stringify({
    action: "msg",
    type: MESSAGES[kind],
    nodeid: nodeId,
    sessionid: sessionId,
  }));
});

function takeJson(text) {
  const start = text.indexOf("[");
  const objectStart = text.indexOf("{");
  const cut = start === -1 ? objectStart : objectStart === -1 ? start : Math.min(start, objectStart);
  if (cut < 0) return null;
  try {
    return JSON.parse(text.slice(cut));
  } catch {
    return null;
  }
}

ws.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (kind === "rename") {
    if (message.action !== "changedevice") return;
    clearTimeout(timer);
    ws.close();
    if (typeof message.result === "string" && !/^ok$/i.test(message.result)) finish({ error: message.result });
    else finish({ ok: true, name: rename });
    return;
  }
  if (kind === "kill") {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value.trim() : "";
    if (!text || text === `kill ${killPid}`) return;
    clearTimeout(timer);
    ws.close();
    if (/error|fail|denied|not found|unable|invalid/i.test(text)) finish({ error: text.slice(0, 200) });
    else finish({ ok: true });
    return;
  }
  if (kind === "service-set") {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : "";
    if (!text || text === serviceControlCommand(serviceAction, serviceName)) return;
    buffer += text;
    const parsed = takeMarked(buffer);
    if (parsed) {
      clearTimeout(timer);
      ws.close();
      if (parsed.error) finish({ error: String(parsed.error).slice(0, 180) });
      else finish({ ok: true });
      return;
    }
    if (/unknown command|not supported|fail|denied|error/i.test(text)) {
      clearTimeout(timer);
      ws.close();
      finish({ error: "MeshCentral did not change this service." });
      return;
    }
    if (serviceAction === "restart") {
      clearTimeout(timer);
      ws.close();
      finish({ ok: true });
    }
    return;
  }
  if (kind === "services" && serviceItems) {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : JSON.stringify(message.value ?? "");
    if (/unknown command|not supported/i.test(text) && text.indexOf("[") === -1) {
      if (serviceTimer) clearTimeout(serviceTimer);
      clearTimeout(timer);
      ws.close();
      finish(serviceItems);
      return;
    }
    buffer += text;
    const parsed = takeJson(buffer);
    if (parsed == null) return;
    if (serviceTimer) clearTimeout(serviceTimer);
    clearTimeout(timer);
    ws.close();
    finish(mergeServices(serviceItems, parsed));
    return;
  }
  if (kind === "startup-set") {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : "";
    buffer += text;
    const parsed = takeMarked(buffer);
    if (!parsed) {
      if (/unknown command|not supported|disabled/i.test(text)) {
        clearTimeout(timer);
        ws.close();
        finish({ error: "MeshCentral did not change this startup item." });
      }
      return;
    }
    clearTimeout(timer);
    ws.close();
    if (parsed.error) finish({ error: String(parsed.error).slice(0, 180) });
    else finish({ ok: true });
    return;
  }
  if (kind === "startup" && startupItems) {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : "";
    if (/unknown command|not supported|disabled/i.test(text) && text.indexOf("\u0001") === -1) {
      if (startupTimer) clearTimeout(startupTimer);
      clearTimeout(timer);
      ws.close();
      finish({ items: startupItems, approved: {}, users: {}, approvedError: "The on/off state could not be read." });
      return;
    }
    buffer += text;
    const parsed = takeMarked(buffer);
    if (!parsed) return;
    if (startupTimer) clearTimeout(startupTimer);
    clearTimeout(timer);
    ws.close();
    if (parsed.error) finish({ items: startupItems, approved: {}, users: {}, approvedError: String(parsed.error).slice(0, 180) });
    else finish({ items: startupItems, approved: parsed.approved || {}, users: parsed.users || {} });
    return;
  }
  if (kind === "processes" && processes) {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : JSON.stringify(message.value ?? "");
    if (/unknown command|not supported|error/i.test(text) && text.indexOf("[") === -1) {
      if (perfPass === 0) {
        if (perfTimer) clearTimeout(perfTimer);
        clearTimeout(timer);
        ws.close();
        finish({ processes, perf: null });
      }
      return;
    }
    buffer += text;
    const parsed = takeJson(buffer);
    if (parsed == null) return;
    perfSample = parsed;
    perfPass += 1;
    if (perfPass === 1) {
      buffer = "";
      setTimeout(() => {
        if (settled) return;
        ws.send(JSON.stringify({
          action: "msg",
          type: "console",
          nodeid: nodeId,
          sessionid: sessionId,
          value: PERF_QUERY,
        }));
      }, 1200);
      return;
    }
    if (perfTimer) clearTimeout(perfTimer);
    clearTimeout(timer);
    ws.close();
    finish({ processes, perf: parsed });
    return;
  }
  if (QUERIES[kind]) {
    if (message.action !== "msg" || message.type !== "console") return;
    const text = typeof message.value === "string" ? message.value : JSON.stringify(message.value ?? "");
    if (/unknown command|not supported/i.test(text) && text.indexOf("[") === -1) {
      clearTimeout(timer);
      ws.close();
      finish({ error: text.slice(0, 240) });
      return;
    }
    buffer += text;
    const parsed = takeJson(buffer);
    if (parsed == null) return;
    if (kind === "startup") {
      startupItems = parsed;
      buffer = "";
      ws.send(JSON.stringify({
        action: "msg",
        type: "console",
        nodeid: nodeId,
        sessionid: sessionId,
        value: APPROVED_COMMAND,
      }));
      startupTimer = setTimeout(() => {
        clearTimeout(timer);
        ws.close();
        finish({ items: startupItems, approved: {}, users: {}, approvedError: "The on/off state could not be read." });
      }, 20000);
      return;
    }
    clearTimeout(timer);
    ws.close();
    finish(parsed);
    return;
  }
  if (message.action !== "msg" || message.type !== MESSAGES[kind]) return;
  if (message.value == null && message.data == null && message.result == null) return;
  let value = message.value != null ? message.value : message.data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      clearTimeout(timer);
      finish({ error: "MeshCentral did not return this list." });
      return;
    }
  }
  if (value && typeof value === "object" && value.error) {
    clearTimeout(timer);
    ws.close();
    finish({ error: String(value.error) });
    return;
  }
  if (typeof message.result === "string" && message.result && !/^ok$/i.test(message.result) && value == null) {
    clearTimeout(timer);
    ws.close();
    finish({ error: message.result });
    return;
  }
  if (kind === "services") {
    serviceItems = Array.isArray(value) ? value : [];
    buffer = "";
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: SERVICE_WMI,
    }));
    serviceTimer = setTimeout(() => {
      clearTimeout(timer);
      ws.close();
      finish(serviceItems);
    }, 20000);
    return;
  }
  if (kind === "processes" && !listOnly) {
    processes = value == null ? {} : value;
    ws.send(JSON.stringify({
      action: "msg",
      type: "console",
      nodeid: nodeId,
      sessionid: sessionId,
      value: PERF_QUERY,
    }));
    perfTimer = setTimeout(() => {
      clearTimeout(timer);
      ws.close();
      finish({ processes, perf: perfSample });
    }, 20000);
    return;
  }
  clearTimeout(timer);
  ws.close();
  finish(value == null ? [] : value);
});
