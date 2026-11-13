import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteBlockedReason, PROTECTED_TEXT } from "../src/file-delete.js";
import { activityFromAudit } from "../src/activity.js";

describe("File Manager delete", () => {
  it("allows ordinary files and folders on Windows", () => {
    assert.equal(deleteBlockedReason("C:/Users/Ann/Desktop", "old.txt"), "");
    assert.equal(deleteBlockedReason("C:/Users/Ann/Downloads", "Digital Fingers"), "");
    assert.equal(deleteBlockedReason("C:/Users/Ann/Documents", "Reports"), "");
    assert.equal(deleteBlockedReason("C:/", "Temp"), "");
    assert.equal(deleteBlockedReason("C:", "HNA"), "");
    assert.equal(deleteBlockedReason("D:/Backups", "2024"), "");
    assert.equal(deleteBlockedReason("C:\\Users\\Public\\Desktop", "shortcut.lnk"), "");
  });

  it("refuses Windows system locations, profiles and the agents' folders", () => {
    for (const [folder, name] of [
      ["C:/", "Windows"],
      ["C:", "Windows"],
      ["C:", "Documents and Settings"],
      ["C:/Documents and Settings", "Ann"],
      ["C:/Windows/System32", "drivers"],
      ["C:/", "Program Files"],
      ["c:/program files", "Digital Fingers"],
      ["C:/Program Files (x86)", "App"],
      ["C:/ProgramData/DigitalFingers", "session-files"],
      ["C:/", "pagefile.sys"],
      ["C:/", "$Recycle.Bin"],
      ["C:/", "Users"],
      ["C:/Users", "Ann"],
      ["C:/Users/Ann", "AppData"],
      ["C:/Users/Ann/AppData/Local", "Temp"],
      ["C:/Users/Ann", "NTUSER.DAT"],
    ]) {
      assert.equal(deleteBlockedReason(folder, name), PROTECTED_TEXT, `${folder}/${name}`);
    }
  });

  it("needs an open folder, so a drive itself is never deleted", () => {
    assert.notEqual(deleteBlockedReason("", "C:"), "");
    assert.notEqual(deleteBlockedReason("C:/", ""), "");
  });

  it("allows home files on Linux and refuses system folders and whole homes", () => {
    assert.equal(deleteBlockedReason("/home/ann/Downloads", "file.iso"), "");
    assert.equal(deleteBlockedReason("/tmp", "build"), "");
    for (const [folder, name] of [["/", "home"], ["/home", "ann"], ["/etc", "hosts"], ["/usr/local/bin", "df-agent"], ["/var/lib", "postgresql"]]) {
      assert.equal(deleteBlockedReason(folder, name), PROTECTED_TEXT, `${folder}/${name}`);
    }
  });

  it("shows deletes on the device timeline", () => {
    const item = activityFromAudit({
      id: 1, action: "file.delete", created_at: new Date(), detail: { path: "C:/Users/Ann/Desktop", name: "old", kind: "folder" },
      target_type: "device", target_id: "17", actor_name: "Ann",
    });
    assert.match(item.summary || item.text || JSON.stringify(item), /deleted the folder old/);
  });
});
