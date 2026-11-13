import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityFromAudit, activityFromTicketEvent, TICKET_ONLY_TYPES } from "../src/activity.js";
import { cleanFileName, fileLogDetail, fileOffer, filePath, filesRevision, fileView, formatSize, isExecutable } from "../src/session-files.js";
import { timelineItem } from "../src/ticket-events.js";

const MB = 1024 * 1024;

describe("session file names", () => {
  it("keeps only the file name, without paths, control characters or Windows-reserved names", () => {
    assert.equal(cleanFileName("C:\\Users\\HNA\\Desktop\\invoice.pdf"), "invoice.pdf");
    assert.equal(cleanFileName("../../etc/passwd"), "passwd");
    assert.equal(cleanFileName("bad<>:\"|?*name\u0007.txt"), "badname.txt");
    assert.equal(cleanFileName("  report .docx. "), "report .docx");
    assert.equal(cleanFileName("CON.txt"), "_CON.txt");
    assert.equal(cleanFileName(""), "file");
    assert.equal(cleanFileName("..."), "file");
    const long = cleanFileName(`${"a".repeat(300)}.xlsx`);
    assert.equal(long.length, 200);
    assert.ok(long.endsWith(".xlsx"));
  });

  it("recognises programs and scripts", () => {
    assert.equal(isExecutable("setup.EXE"), true);
    assert.equal(isExecutable("fix.ps1"), true);
    assert.equal(isExecutable("printer.msi"), true);
    assert.equal(isExecutable("notes.txt"), false);
    assert.equal(isExecutable("exe"), false);
  });

  it("shows sizes the way people read them", () => {
    assert.equal(formatSize(900), "900 bytes");
    assert.equal(formatSize(2048), "2 KB");
    assert.equal(formatSize(1.5 * MB), "1.5 MB");
    assert.equal(formatSize(150 * MB), "150 MB");
  });
});

describe("session file offers", () => {
  it("accepts a file up to the limit and refuses a larger one", () => {
    const ok = fileOffer({ name: "photo.jpg", size: 100 * MB, type: "image/jpeg" }, "to_technician", {});
    assert.deepEqual(ok.value, { name: "photo.jpg", size: 100 * MB, contentType: "image/jpeg", executable: false, warn: false });
    const big = fileOffer({ name: "backup.zip", size: 150 * MB }, "to_technician", {});
    assert.equal(big.tooLarge, true);
    assert.match(big.error, /150 MB.*up to 100 MB/);
    assert.equal(fileOffer({ name: "a.zip", size: 30 * MB }, "to_customer", { fileMaxMb: 25 }).tooLarge, true);
  });

  it("refuses empty files and strange sizes, and cleans the content type", () => {
    assert.ok(fileOffer({ name: "a.txt", size: 0 }, "to_technician", {}).error);
    assert.ok(fileOffer({ name: "a.txt", size: -5 }, "to_technician", {}).error);
    assert.ok(fileOffer({ name: "a.txt", size: "lots" }, "to_technician", {}).error);
    assert.equal(fileOffer({ name: "a.txt", size: 5, type: "text/html; <script>" }, "to_technician", {}).value.contentType, "application/octet-stream");
  });

  it("follows the tenant's direction switches", () => {
    assert.match(fileOffer({ name: "a.txt", size: 5 }, "to_technician", { filesToTechnician: false }).error, /turned off/);
    assert.match(fileOffer({ name: "a.txt", size: 5 }, "to_customer", { filesToCustomer: false }).error, /turned off/);
    assert.ok(fileOffer({ name: "a.txt", size: 5 }, "to_customer", { filesToTechnician: false }).value);
  });

  it("warns about, blocks or allows programs sent to the customer, as the tenant chose", () => {
    assert.equal(fileOffer({ name: "tool.exe", size: 5 }, "to_customer", {}).value.warn, true);
    assert.match(fileOffer({ name: "tool.exe", size: 5 }, "to_customer", { executables: "block" }).error, /doesn't allow/);
    const allowed = fileOffer({ name: "tool.exe", size: 5 }, "to_customer", { executables: "allow" }).value;
    assert.equal(allowed.executable, true);
    assert.equal(allowed.warn, false);
    assert.equal(fileOffer({ name: "tool.exe", size: 5 }, "to_technician", { executables: "block" }).value.executable, true);
  });
});

describe("session file records", () => {
  const row = {
    id: "9", org_id: 2, session_id: "41", direction: "to_technician", user_id: null, sender_name: "HNA", file_name: "error.png",
    content_type: "image/png", size_bytes: "52000", sha256: "ab".repeat(32), executable: false, status: "delivered", scan: null,
    detail: "", storage_key: "0".repeat(48), created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:05Z", deleted_at: null,
  };

  it("shows a file without its storage key or tenant", () => {
    const view = fileView(row);
    assert.equal(view.id, 9);
    assert.equal(view.size, 52000);
    assert.equal(view.from, "HNA");
    assert.equal(view.kept, true);
    assert.equal("storage_key" in view || "storageKey" in view || "org_id" in view, false);
  });

  it("only opens storage keys it generated", () => {
    assert.ok(filePath(row).endsWith("0".repeat(48)));
    assert.throws(() => filePath({ storage_key: "../../etc/passwd" }));
    assert.throws(() => filePath({ storage_key: "" }));
  });

  it("changes the revision whenever a file is added or updated", () => {
    assert.equal(filesRevision([]), "0");
    const one = filesRevision([{ rev: 1000 }]);
    assert.notEqual(filesRevision([{ rev: 1000 }, { rev: 1000 }]), one);
    assert.notEqual(filesRevision([{ rev: 2000 }]), one);
  });

  it("logs the name, size, direction, outcome and hash", () => {
    assert.deepEqual(fileLogDetail(row), {
      sessionId: 41, fileId: 9, name: "error.png", size: 52000, direction: "to_technician", outcome: "delivered", sha256: "ab".repeat(32),
    });
  });
});

describe("session files on the timeline", () => {
  const audit = (detail) => activityFromAudit({ action: "remote.file", targetType: "device", targetId: "16", detail, actorId: 4 });

  it("describes each direction and outcome", () => {
    assert.match(audit({ fileId: 1, name: "error.png", size: 52000, direction: "to_technician", outcome: "delivered" }).summary, /received "error.png" \(51 KB\) from the customer/);
    assert.match(audit({ fileId: 2, name: "setup.exe", size: 3 * MB, direction: "to_customer", outcome: "accepted" }).summary, /sent "setup.exe" \(3.0 MB\) to the customer, who saved it/);
    assert.match(audit({ fileId: 3, name: "a.pdf", size: 10, direction: "to_customer", outcome: "declined" }).summary, /who declined it/);
    assert.match(audit({ fileId: 4, name: "a.pdf", size: 10, direction: "to_customer", outcome: "failed", detail: "Windows Defender found a threat in this file." }).summary, /could not send "a.pdf".*Defender/);
  });

  it("offers a download only for files that arrived, and keeps the hash", () => {
    const delivered = audit({ fileId: 1, name: "a.png", size: 5, direction: "to_technician", outcome: "delivered", sha256: "cd".repeat(32), ticketId: 7 });
    assert.equal(delivered.payload.sessionFileId, 1);
    assert.equal(delivered.payload.fileDownload, true);
    assert.equal(delivered.payload.sha256, "cd".repeat(32));
    assert.equal(delivered.ticketId, 7);
    assert.equal(audit({ fileId: 2, name: "a.png", size: 5, direction: "to_customer", outcome: "declined" }).payload.fileDownload, undefined);
  });

  it("stays on the ticket, not the device timeline twice", () => {
    const event = activityFromTicketEvent("remote_file", { fileId: 1, name: "a.png", size: 5, direction: "to_technician", outcome: "delivered" });
    assert.ok(TICKET_ONLY_TYPES.includes(event.type));
    assert.match(event.summary, /received "a.png" \(5 bytes\)/);
    const item = timelineItem({ id: 1, kind: "remote_file", detail: { fileId: 1, name: "a.png", size: 5, direction: "to_technician", outcome: "delivered", sha256: "ef".repeat(32) }, created_at: "2026-11-12T10:00:00Z" }, {});
    assert.equal(item.fileId, 1);
    assert.equal(item.download, true);
    assert.match(item.summary, /received "a.png"/);
  });
});
