import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveDiff,
  hasApp,
  hasFeature,
  legacyEffective,
  planBackfill,
  resolve,
} from "../src/licensing.js";

const NOW = new Date("2026-10-28T10:00:00Z");

const REMOTE = {
  id: 1,
  code: "REMOTE",
  features: ["enrollment", "remote_sessions", "remote_support", "monitoring", "patching"],
  defaultSeats: 5,
  defaultDevices: 50,
  defaultSessions: 1,
  isCustom: false,
};
const SERVICE = { id: 2, code: "SERVICE", features: ["ticketing"], defaultSeats: 5, defaultDevices: 0, defaultSessions: 0, isCustom: false };
const SUITE = {
  id: 3,
  code: "SUITE",
  features: [...REMOTE.features, "ticketing"],
  defaultSeats: 10,
  defaultDevices: 100,
  defaultSessions: 2,
  isCustom: false,
};
const SEEDS = [REMOTE, SERVICE, SUITE];

const lic = (extra = {}) => ({ featuresAdded: [], featuresRemoved: [], noExpiry: true, expiresAt: null, status: "active", ...extra });

describe("resolve", () => {
  it("uses the package alone when there are no overrides", () => {
    const result = resolve(REMOTE, lic(), NOW);
    assert.deepEqual(result.features, REMOTE.features);
    assert.deepEqual(result.apps, ["remote"]);
    assert.equal(result.seats, 5);
    assert.equal(result.devices, 50);
    assert.equal(result.sessions, 1);
    assert.equal(result.active, true);
    assert.equal(result.status, "active");
  });

  it("applies seat, device and session overrides, including zero", () => {
    const result = resolve(REMOTE, lic({ seatsOverride: 12, devicesOverride: 0, sessionsOverride: 3 }), NOW);
    assert.equal(result.seats, 12);
    assert.equal(result.devices, 0);
    assert.equal(result.sessions, 3);
  });

  it("adds and removes features, and derives apps from what is left", () => {
    const result = resolve(SERVICE, lic({ featuresAdded: ["reporting", "enrollment"], featuresRemoved: ["ticketing"] }), NOW);
    assert.deepEqual(result.features, ["enrollment", "reporting"]);
    assert.deepEqual(result.apps, ["remote", "reporting"]);
  });

  it("lets a removal win over an addition of the same feature", () => {
    const result = resolve(REMOTE, lic({ featuresAdded: ["ticketing"], featuresRemoved: ["ticketing"] }), NOW);
    assert.equal(result.features.includes("ticketing"), false);
  });

  it("ignores unknown feature keys", () => {
    const result = resolve({ ...SERVICE, features: ["ticketing", "bogus"] }, lic({ featuresAdded: ["nope"] }), NOW);
    assert.deepEqual(result.features, ["ticketing"]);
  });

  it("stays active with no expiry", () => {
    assert.equal(resolve(SUITE, lic({ noExpiry: true }), NOW).active, true);
  });

  it("expires once the expiry has passed", () => {
    const past = resolve(SUITE, lic({ noExpiry: false, expiresAt: "2026-10-27T21:59:59Z" }), NOW);
    assert.equal(past.status, "expired");
    assert.equal(past.active, false);
    const future = resolve(SUITE, lic({ noExpiry: false, expiresAt: "2026-10-28T21:59:59Z" }), NOW);
    assert.equal(future.active, true);
  });

  it("is inactive when suspended, even with no expiry", () => {
    const result = resolve(SUITE, lic({ status: "suspended" }), NOW);
    assert.equal(result.status, "suspended");
    assert.equal(result.active, false);
  });

  it("turns every feature and app check off when inactive", () => {
    const active = resolve(SUITE, lic(), NOW);
    const suspended = resolve(SUITE, lic({ status: "suspended" }), NOW);
    assert.equal(hasFeature(active, "ticketing"), true);
    assert.equal(hasApp(active, "remote"), true);
    assert.equal(hasFeature(suspended, "ticketing"), false);
    assert.equal(hasApp(suspended, "remote"), false);
    assert.deepEqual(suspended.features, active.features);
  });
});

describe("planBackfill", () => {
  const allModules = {
    core: true,
    remote_desktop: true,
    remote_support: true,
    monitoring: true,
    patch: true,
    ticketing: true,
    reporting: true,
  };

  it("assigns SUITE with Reporting as an add-on for the full operator license", () => {
    const row = { name: "Digital Fingers", slug: "digital-fingers", plan: "operator", seats: 25, device_cap: 500, support_concurrent: 1, expires_at: null, modules: allModules };
    const plan = planBackfill(row, SEEDS);
    assert.equal(plan.package.code, "SUITE");
    assert.equal(plan.customPackage, null);
    assert.deepEqual(plan.license.featuresAdded, ["reporting"]);
    assert.equal(plan.license.seatsOverride, 25);
    assert.equal(plan.license.devicesOverride, 500);
    assert.equal(plan.license.sessionsOverride, 1);
    assert.equal(plan.license.noExpiry, true);
    assert.deepEqual(effectiveDiff(legacyEffective(row, NOW), resolve(plan.package, plan.license, NOW)), []);
  });

  it("leaves overrides empty when limits equal the package defaults", () => {
    const row = { name: "A", slug: "a", seats: 5, device_cap: 0, support_concurrent: 0, expires_at: null, modules: { ticketing: true } };
    const plan = planBackfill(row, SEEDS);
    assert.equal(plan.package.code, "SERVICE");
    assert.equal(plan.license.seatsOverride, null);
    assert.equal(plan.license.devicesOverride, null);
    assert.equal(plan.license.sessionsOverride, null);
  });

  it("creates a custom package when no seed package matches", () => {
    const row = { name: "Second Test Org", slug: "second-test-org", seats: 5, device_cap: 12, support_concurrent: 1, expires_at: null, modules: { core: true, patch: false } };
    const plan = planBackfill(row, SEEDS);
    assert.equal(plan.package.code, "CUSTOM-SECOND-TEST-ORG");
    assert.equal(plan.customPackage.isCustom, true);
    assert.deepEqual(plan.customPackage.features, ["enrollment"]);
    assert.equal(plan.license.seatsOverride, null);
    assert.deepEqual(effectiveDiff(legacyEffective(row, NOW), resolve(plan.package, plan.license, NOW)), []);
  });

  it("makes a Reporting-only license custom rather than an empty seed match", () => {
    const row = { name: "R", slug: "r", seats: 1, device_cap: 0, support_concurrent: 0, expires_at: null, modules: { reporting: true } };
    assert.equal(planBackfill(row, SEEDS).package.code, "CUSTOM-R");
  });

  it("copies an expiry date and keeps an expired license expired", () => {
    const row = { name: "E", slug: "e", seats: 5, device_cap: 50, support_concurrent: 1, expires_at: "2026-01-31T21:59:59Z", modules: { core: true, remote_desktop: true, remote_support: true, monitoring: true, patch: true } };
    const plan = planBackfill(row, SEEDS);
    assert.equal(plan.package.code, "REMOTE");
    assert.equal(plan.license.noExpiry, false);
    assert.equal(plan.license.expiresAt, row.expires_at);
    const after = resolve(plan.package, plan.license, NOW);
    assert.equal(after.active, false);
    assert.deepEqual(effectiveDiff(legacyEffective(row, NOW), after), []);
  });
});
