// Session Panel file transfer (Phase C): files the customer sends to the technician and files the technician offers
// the customer, during a remote session. Every query is scoped by the tenant. Files are written to disk with their
// SHA-256 and kept for 30 days; the row (name, size, hash, outcome) stays with the session for the timeline.
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { wakeSession } from "./session-bus.js";
import { panelOptions } from "./session-panel.js";

export const SESSION_FILE_DIR = process.env.SESSION_FILE_DIR || "/var/lib/df-api/session-files";
export const FILE_KEEP_DAYS = 30;
const MB = 1024 * 1024;

// Programs and scripts: the customer is warned (or the tenant blocks them) before one is saved on their computer.
const EXECUTABLE = new Set([
  "exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys",
  "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "jar", "reg", "lnk", "url", "inf", "application",
  "gadget", "msc", "msp", "mst", "scf", "iso", "img", "vhd", "vhdx",
]);

const FINAL = new Set(["delivered", "accepted", "declined", "cancelled", "failed"]);

export function cleanFileName(raw) {
  const base = String(raw ?? "").split(/[\\/]/).pop();
  const name = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name);
  const safe = reserved ? `_${name}` : name;
  if (!safe) return "file";
  if (safe.length <= 200) return safe;
  const dot = safe.lastIndexOf(".");
  const ext = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : "";
  return safe.slice(0, 200 - ext.length) + ext;
}

export function isExecutable(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && EXECUTABLE.has(name.slice(dot + 1).toLowerCase());
}

function cleanType(raw) {
  const type = String(raw || "").trim().toLowerCase();
  return /^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/.test(type) ? type : "application/octet-stream";
}

export function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= MB) return `${(size / MB).toFixed(size >= 10 * MB ? 0 : 1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} bytes`;
}

// What one side asks to send. The tenant's settings decide whether this direction is allowed, the largest file and
// whether programs may be offered to the customer.
export function fileOffer(body, direction, rawOptions) {
  const options = panelOptions(rawOptions);
  const allowed = direction === "to_technician" ? options.filesToTechnician : options.filesToCustomer;
  if (!allowed) {
    return { error: direction === "to_technician" ? "Sending files to the technician is turned off." : "Sending files to the customer is turned off." };
  }
  const name = cleanFileName(body?.name);
  const size = Number(body?.size);
  if (!Number.isSafeInteger(size) || size <= 0) return { error: "That file is empty." };
  if (size > options.fileMaxMb * MB) return { error: `"${name}" is ${formatSize(size)}. Files can be up to ${options.fileMaxMb} MB.`, tooLarge: true };
  const executable = isExecutable(name);
  if (executable && direction === "to_customer" && options.executables === "block") {
    return { error: "Your organisation doesn't allow sending programs or scripts to customers." };
  }
  return {
    value: {
      name,
      size,
      contentType: cleanType(body?.type),
      executable,
      warn: executable && direction === "to_customer" && options.executables === "warn",
    },
  };
}

export function fileView(row) {
  return {
    id: Number(row.id),
    direction: row.direction,
    name: row.file_name,
    size: Number(row.size_bytes),
    type: row.content_type,
    sha256: row.sha256 || null,
    executable: row.executable === true,
    status: row.status,
    scan: row.scan || null,
    detail: row.detail || "",
    from: row.sender_name || (row.direction === "to_technician" ? "Customer" : "Technician"),
    at: new Date(row.created_at).toISOString(),
    kept: row.deleted_at == null,
  };
}

export async function sessionFiles(db, { orgId, sessionId }) {
  const found = await db.query(
    `SELECT id, direction, sender_name, file_name, content_type, size_bytes, sha256, executable, status, scan, detail,
            created_at, updated_at, deleted_at
     FROM remote_session_files
     WHERE session_id = $1 AND org_id = $2
     ORDER BY id
     LIMIT 200`,
    [sessionId, orgId],
  );
  return found.rows.map((row) => ({ ...fileView(row), rev: new Date(row.updated_at).getTime() }));
}

// Changes when any file of the session changes, so a long-poll knows whether the caller is behind.
export function filesRevision(files) {
  if (!files?.length) return "0";
  const latest = Math.max(...files.map((file) => file.rev || 0));
  return `${files.length}-${latest.toString(36)}`;
}

export async function createFile(db, { orgId, sessionId, direction, userId = null, senderName = "", offer }) {
  const storageKey = randomBytes(24).toString("hex");
  const saved = await db.query(
    `INSERT INTO remote_session_files
       (org_id, session_id, direction, user_id, sender_name, file_name, content_type, size_bytes, executable, storage_key)
     SELECT rs.org_id, rs.id, $3, $4, $5, $6, $7, $8, $9, $10 FROM remote_sessions rs
     WHERE rs.id = $1 AND rs.org_id = $2 AND rs.ended_by IS NULL
     RETURNING *`,
    [sessionId, orgId, direction, userId, String(senderName || "").slice(0, 120), offer.name, offer.contentType, offer.size, offer.executable, storageKey],
  );
  const row = saved.rows[0] || null;
  if (row) wakeSession(sessionId);
  return row;
}

export async function fileRow(db, { orgId, sessionId = null, fileId }) {
  const found = await db.query(
    `SELECT f.*, rs.device_id, rs.ticket_id, rs.user_id AS session_user_id
     FROM remote_session_files f
     JOIN remote_sessions rs ON rs.id = f.session_id AND rs.org_id = f.org_id
     WHERE f.id = $1 AND f.org_id = $2 AND ($3::bigint IS NULL OR f.session_id = $3)`,
    [fileId, orgId, sessionId],
  );
  return found.rows[0] || null;
}

export function filePath(row) {
  if (!/^[0-9a-f]{48}$/.test(String(row?.storage_key || ""))) throw new Error("Bad storage key.");
  return join(SESSION_FILE_DIR, row.storage_key);
}

class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Streams the request body to disk. The body must be exactly the size that was offered; the hash is computed on the
// way. On success the file is "delivered" (to the technician) or "offered" (to the customer).
export async function receiveUpload(db, req, row) {
  if (row.status !== "uploading") throw new UploadError(409, "That file was already sent.");
  const declared = Number(req.headers["content-length"]);
  const expected = Number(row.size_bytes);
  const target = filePath(row);
  const hash = createHash("sha256");
  let received = 0;
  try {
    if (req.headers["content-length"] != null && declared !== expected) throw new UploadError(400, "The file size doesn't match.");
    await mkdir(SESSION_FILE_DIR, { recursive: true, mode: 0o700 });
    await new Promise((resolve, reject) => {
      const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
      const fail = (error) => {
        req.unpipe?.(out);
        out.destroy();
        reject(error);
      };
      req.on("data", (chunk) => {
        received += chunk.length;
        if (received > expected) {
          req.pause();
          fail(new UploadError(400, "The file is larger than offered."));
          return;
        }
        hash.update(chunk);
      });
      req.on("aborted", () => fail(new UploadError(400, "The upload was interrupted.")));
      req.on("error", fail);
      out.on("error", fail);
      out.on("finish", resolve);
      req.pipe(out);
    });
    if (received !== expected) throw new UploadError(400, "The upload was interrupted.");
  } catch (error) {
    await rm(target, { force: true });
    await setFileStatus(db, { orgId: row.org_id, fileId: row.id, from: ["uploading"], to: "failed", detail: error.message });
    throw error;
  }
  const next = row.direction === "to_technician" ? "delivered" : "offered";
  const saved = await db.query(
    `UPDATE remote_session_files SET status = $3, sha256 = $4, updated_at = now(),
            finished_at = CASE WHEN $3 = 'delivered' THEN now() ELSE finished_at END
     WHERE id = $1 AND org_id = $2 AND status = 'uploading'
     RETURNING *`,
    [row.id, row.org_id, next, hash.digest("hex")],
  );
  wakeSession(row.session_id);
  return saved.rows[0] || null;
}

// Moves a file from one of the allowed states to the next; null if it was already elsewhere.
export async function setFileStatus(db, { orgId, fileId, from, to, detail = null, scan = null }) {
  const saved = await db.query(
    `UPDATE remote_session_files
     SET status = $4, updated_at = now(),
         detail = COALESCE($5, detail),
         scan = COALESCE($6, scan),
         finished_at = CASE WHEN $4 = ANY($7::text[]) THEN now() ELSE finished_at END
     WHERE id = $1 AND org_id = $2 AND status = ANY($3::text[])
     RETURNING *`,
    [fileId, orgId, from, to, detail == null ? null : String(detail).slice(0, 240), scan, [...FINAL]],
  );
  const row = saved.rows[0] || null;
  if (row) wakeSession(row.session_id);
  return row;
}

// The scan result for a file offered to the customer, reported by the agent before the customer can accept it.
export async function setFileScan(db, { orgId, fileId, scan }) {
  const saved = await db.query(
    `UPDATE remote_session_files SET scan = $3, updated_at = now()
     WHERE id = $1 AND org_id = $2 AND direction = 'to_customer' AND status = 'offered'
     RETURNING *`,
    [fileId, orgId, scan],
  );
  const row = saved.rows[0] || null;
  if (row) wakeSession(row.session_id);
  return row;
}

// Finished transfers not yet on the timelines; claimed one at a time so each is logged once.
export async function unloggedFiles(db, limit = 100) {
  const found = await db.query(
    `SELECT id FROM remote_session_files
     WHERE logged_at IS NULL AND status = ANY($1::text[])
     ORDER BY id
     LIMIT $2`,
    [[...FINAL], limit],
  );
  return found.rows.map((row) => Number(row.id));
}

export async function claimFileLog(db, fileId) {
  const claimed = await db.query(
    `UPDATE remote_session_files f SET logged_at = now()
     FROM remote_sessions rs
     WHERE f.id = $1 AND f.logged_at IS NULL AND rs.id = f.session_id
     RETURNING f.*, rs.device_id, rs.ticket_id, rs.user_id AS session_user_id`,
    [fileId],
  );
  return claimed.rows[0] || null;
}

export function fileLogDetail(row) {
  return {
    sessionId: Number(row.session_id),
    fileId: Number(row.id),
    name: row.file_name,
    size: Number(row.size_bytes),
    direction: row.direction,
    outcome: row.status,
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.detail ? { detail: String(row.detail).slice(0, 200) } : {}),
  };
}

// Deletes files older than 30 days (the row stays), gives up on uploads and offers left for two hours, and drops the
// copies of transfers that didn't complete.
export async function expireFiles(db) {
  const old = await db.query(
    `SELECT id, org_id, session_id, storage_key FROM remote_session_files
     WHERE deleted_at IS NULL
       AND (created_at < now() - make_interval(days => $1) OR (status IN ('uploading', 'offered', 'failed', 'cancelled', 'declined')
            AND updated_at < now() - interval '2 hours'))
     ORDER BY id
     LIMIT 200`,
    [FILE_KEEP_DAYS],
  );
  for (const row of old.rows) {
    await rm(filePath(row), { force: true });
    await db.query(
      `UPDATE remote_session_files
       SET deleted_at = now(), updated_at = now(),
           status = CASE WHEN status IN ('uploading', 'offered') THEN 'failed' ELSE status END,
           detail = CASE WHEN status IN ('uploading', 'offered') THEN 'The transfer did not finish.' ELSE detail END,
           finished_at = COALESCE(finished_at, now())
       WHERE id = $1`,
      [row.id],
    );
  }
  return old.rows.length;
}
