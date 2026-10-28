import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.LICENSE_V2 = "true";
const { effectiveRow, modulesFromFeatures } = await import("../src/license-store.js");

const NOW = new Date("2026-10-28T10:00:00Z");

const suiteRow = (extra = {}) => ({
  plan: "operator",
  seats: 1,
  device_cap: 1,
  support_concurrent: 0,
  expires_at: null,
  modules: { core: true },
  package_id: 3,
  package_code: "SUITE",
  package_name: "Digital Fingers Suite",
  package_features: ["enrollment", "remote_sessions", "remote_support", "monitoring", "patching", "ticketing"],
  package_default_seats: 10,
  package_default_devices: 100,
  package_default_sessions: 2,
  package_is_custom: false,
  seats_override: 25,
  devices_override: null,
  sessions_override: null,
  features_added: ["reporting"],
  features_removed: [],
  no_expiry: true,
  status: "active",
  ...extra,
});

describe("effectiveRow with LICENSE_V2", () => {
  it("replaces the old columns with the package entitlements", () => {
    const row = effectiveRow(suiteRow(), NOW);
    assert.equal(row.seats, 25);
    assert.equal(row.device_cap, 100);
    assert.equal(row.support_concurrent, 2);
    assert.equal(row.modules.reporting, true);
    assert.equal(row.modules.ticketing, true);
    assert.equal(row.modules.remote_desktop, true);
    assert.equal(row.status, "active");
    assert.deepEqual(row.package, { code: "SUITE", name: "Digital Fingers Suite", isCustom: false });
  });

  it("reports a suspended license as inactive", () => {
    const row = effectiveRow(suiteRow({ status: "suspended" }), NOW);
    assert.equal(row.status, "suspended");
    assert.equal(row.entitlements.active, false);
  });

  it("falls back to the old columns when no package is assigned", () => {
    const row = effectiveRow({ seats: 5, device_cap: 12, support_concurrent: 1, expires_at: null, modules: { core: true }, package_id: null }, NOW);
    assert.equal(row.seats, 5);
    assert.deepEqual(row.entitlements.features, ["enrollment"]);
    assert.equal(row.package, null);
  });

  it("maps features back to the old module names", () => {
    assert.deepEqual(modulesFromFeatures(["enrollment", "patching"]), {
      core: true,
      remote_desktop: false,
      remote_support: false,
      monitoring: false,
      patch: true,
      ticketing: false,
      reporting: false,
    });
  });
});
