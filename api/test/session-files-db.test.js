// Tenant isolation and the upload path for Session Panel files. Runs against a throwaway Postgres with schema.sql
// applied; skipped unless BILLING_TEST_DB=1 (PG* variables point at that database).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

const enabled = process.env.BILLING_TEST_DB === "1";

function upload(bytes, length = bytes.length) {
  const req = Readable.from([bytes]);
  req.headers = { "content-length": String(length) };
  return req;
}

describe("session files (database)", { skip: !enabled }, () => {
  let pool, files, dir;
  let orgA, orgB, techA, deviceA, sessionA;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "df-session-files-"));
    process.env.SESSION_FILE_DIR = dir;
    ({ pool } = await import("../src/db.js"));
    files = await import("../src/session-files.js");
    const suffix = Date.now();
    const org = async (name) => Number((await pool.query("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, `${name}-${suffix}`.toLowerCase().replace(/\W+/g, "-")])).rows[0].id);
    orgA = await org("Files Tenant A");
    orgB = await org("Files Tenant B");
    techA = Number((await pool.query("INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, $2, 'Thandi Mokoena', 'x') RETURNING id", [orgA, `files-a-${suffix}@example.test`])).rows[0].id);
    deviceA = Number((await pool.query("INSERT INTO devices (org_id, hostname, os_name) VALUES ($1, 'FILES-A-01', 'Windows 11 Pro') RETURNING id", [orgA])).rows[0].id);
    sessionA = Number((await pool.query(
      "INSERT INTO remote_sessions (org_id, device_id, user_id, device_name, status) VALUES ($1, $2, $3, 'FILES-A-01', 'live') RETURNING id",
      [orgA, deviceA, techA],
    )).rows[0].id);
  });

  after(async () => {
    await pool?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const offer = (name, size) => files.fileOffer({ name, size }, "to_technician", {}).value;

  it("creates files only in the session's own tenant and reads them back only there", async () => {
    assert.equal(await files.createFile(pool, { orgId: orgB, sessionId: sessionA, direction: "to_technician", offer: offer("x.txt", 3) }), null);
    const row = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", senderName: "HNA", offer: offer("x.txt", 3) });
    assert.equal(row.status, "uploading");
    assert.equal(await files.fileRow(pool, { orgId: orgB, fileId: row.id }), null);
    assert.equal(await files.fileRow(pool, { orgId: orgA, sessionId: sessionA + 1, fileId: row.id }), null);
    assert.equal(Number((await files.fileRow(pool, { orgId: orgA, sessionId: sessionA, fileId: row.id })).device_id), deviceA);
    assert.equal((await files.sessionFiles(pool, { orgId: orgB, sessionId: sessionA })).length, 0);
  });

  it("stores an upload with its SHA-256, privately, and only once", async () => {
    const bytes = Buffer.from("Printer error 0x0000011b\n");
    const row = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", senderName: "HNA", offer: offer("error.txt", bytes.length) });
    const saved = await files.receiveUpload(pool, upload(bytes), row);
    assert.equal(saved.status, "delivered");
    assert.equal(saved.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.ok(saved.finished_at);
    const path = files.filePath(saved);
    assert.deepEqual(await readFile(path), bytes);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(files.receiveUpload(pool, upload(bytes), saved), { status: 409 });
  });

  it("fails an upload that doesn't match the offered size and keeps nothing on disk", async () => {
    const row = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", offer: offer("short.bin", 10) });
    await assert.rejects(files.receiveUpload(pool, upload(Buffer.alloc(4)), row), { status: 400 });
    const longer = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", offer: offer("long.bin", 4) });
    await assert.rejects(files.receiveUpload(pool, upload(Buffer.alloc(10), 4), longer), { status: 400 });
    for (const id of [row.id, longer.id]) {
      const after = await files.fileRow(pool, { orgId: orgA, fileId: id });
      assert.equal(after.status, "failed");
      await assert.rejects(stat(files.filePath(after)));
    }
  });

  it("moves a file offered to the customer through scan and accept, within the tenant", async () => {
    const bytes = Buffer.from("driver");
    const offered = files.fileOffer({ name: "driver.zip", size: bytes.length }, "to_customer", {}).value;
    const row = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_customer", userId: techA, senderName: "Thandi", offer: offered });
    assert.equal((await files.receiveUpload(pool, upload(bytes), row)).status, "offered");
    assert.equal(await files.setFileScan(pool, { orgId: orgB, fileId: row.id, scan: "clean" }), null);
    assert.equal((await files.setFileScan(pool, { orgId: orgA, fileId: row.id, scan: "clean" })).scan, "clean");
    assert.equal(await files.setFileStatus(pool, { orgId: orgB, fileId: row.id, from: ["offered"], to: "accepted" }), null);
    assert.equal((await files.setFileStatus(pool, { orgId: orgA, fileId: row.id, from: ["offered"], to: "accepted" })).status, "accepted");
    assert.equal(await files.setFileStatus(pool, { orgId: orgA, fileId: row.id, from: ["offered"], to: "declined" }), null);
  });

  it("logs each finished transfer exactly once, with the session's device and technician", async () => {
    const due = await files.unloggedFiles(pool, 500);
    const mine = (await pool.query("SELECT id FROM remote_session_files WHERE session_id = $1 AND status <> 'uploading'", [sessionA])).rows.map((r) => Number(r.id));
    assert.ok(mine.every((id) => due.includes(id)));
    const claimed = await files.claimFileLog(pool, mine[0]);
    assert.equal(Number(claimed.device_id), deviceA);
    assert.equal(Number(claimed.session_user_id), techA);
    assert.equal(await files.claimFileLog(pool, mine[0]), null);
    assert.equal((await files.unloggedFiles(pool, 500)).includes(mine[0]), false);
  });

  it("deletes stored copies after 30 days, and gives up on transfers left unfinished, keeping the rows", async () => {
    const delivered = (await pool.query("SELECT * FROM remote_session_files WHERE session_id = $1 AND status = 'delivered'", [sessionA])).rows[0];
    const stuck = await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", offer: offer("stuck.txt", 5) });
    await pool.query("UPDATE remote_session_files SET created_at = now() - interval '31 days' WHERE id = $1", [delivered.id]);
    await pool.query("UPDATE remote_session_files SET updated_at = now() - interval '3 hours' WHERE id = $1", [stuck.id]);
    assert.ok(await files.expireFiles(pool) >= 2);
    const gone = await files.fileRow(pool, { orgId: orgA, fileId: delivered.id });
    assert.ok(gone.deleted_at);
    assert.equal(gone.status, "delivered");
    assert.equal(gone.sha256, delivered.sha256);
    await assert.rejects(stat(files.filePath(gone)));
    const failed = await files.fileRow(pool, { orgId: orgA, fileId: stuck.id });
    assert.equal(failed.status, "failed");
    assert.equal(failed.detail, "The transfer did not finish.");
    assert.equal(files.fileView(gone).kept, false);
  });

  it("refuses new files once the customer ends the session", async () => {
    await pool.query("UPDATE remote_sessions SET ended_by = 'customer', status = 'ended', ended_at = now() WHERE id = $1", [sessionA]);
    assert.equal(await files.createFile(pool, { orgId: orgA, sessionId: sessionA, direction: "to_technician", offer: offer("late.txt", 3) }), null);
  });
});
