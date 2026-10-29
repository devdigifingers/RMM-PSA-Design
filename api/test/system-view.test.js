import assert from "node:assert/strict";
import test from "node:test";
import { fleetVersions } from "../src/system-view.js";

test("fleet versions are grouped per platform against that platform's release", () => {
  const rows = [
    { platform: "windows", agent_version: "1.5.2" },
    { platform: "windows", agent_version: "1.5.1" },
    { platform: "windows", agent_version: "1.5.1" },
    { platform: "windows", agent_version: "" },
    { platform: "linux", agent_version: "1.5.2" },
  ];
  const [windows, linux] = fleetVersions(rows, { windows: "1.5.2", linux: "1.5.2" });
  assert.equal(windows.platform, "windows");
  assert.equal(windows.total, 4);
  assert.equal(windows.outdated, 3);
  assert.deepEqual(windows.versions.map((item) => [item.version, item.count, item.state]), [
    ["1.5.2", 1, "current"],
    ["1.5.1", 2, "outdated"],
    ["Unknown", 1, "unknown"],
  ]);
  assert.deepEqual([linux.total, linux.outdated, linux.versions[0].state], [1, 0, "current"]);
});

test("without a published release nothing is outdated except unknown versions", () => {
  const [linux] = fleetVersions([{ platform: "linux", agent_version: "1.4.0" }, { platform: "linux", agent_version: null }], {});
  assert.equal(linux.outdated, 1);
  assert.deepEqual(linux.versions.map((item) => item.state), ["current", "unknown"]);
});
