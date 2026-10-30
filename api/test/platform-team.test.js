import assert from "node:assert/strict";
import test from "node:test";
import { lastSuperGuard, mfaSetupNeeded, parsePlatformInvite, supportBlocked } from "../src/platform-team-rules.js";

const support = { is_platform_admin: true, platform_role: "support" };

test("support accounts can read and look after their own login only", () => {
  assert.equal(supportBlocked(support, "GET", "/v1/platform/tenants"), false);
  assert.equal(supportBlocked(support, "POST", "/v1/platform/tenants"), true);
  assert.equal(supportBlocked(support, "POST", "/v1/platform/tenants/3/impersonate"), true);
  assert.equal(supportBlocked(support, "POST", "/v1/migrations/1/approve"), true);
  assert.equal(supportBlocked(support, "POST", "/v1/account/mfa/enable"), false);
  assert.equal(supportBlocked(support, "POST", "/v1/logout"), false);
  assert.equal(supportBlocked(support, "POST", "/v1/notifications/read"), false);
  assert.equal(supportBlocked({ is_platform_admin: true, platform_role: "admin" }, "POST", "/v1/platform/tenants"), false);
  assert.equal(supportBlocked({ is_platform_admin: false, roles: ["tech"] }, "POST", "/v1/tickets"), false);
});

test("platform accounts need MFA once the grace period ends", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(mfaSetupNeeded({ is_platform_admin: true, platform_mfa_due_at: "2026-11-06T00:00:00Z" }, now), false);
  assert.equal(mfaSetupNeeded({ is_platform_admin: true, platform_mfa_due_at: "2026-10-31T00:00:00Z" }, now), true);
  assert.equal(mfaSetupNeeded({ is_platform_admin: true, platform_mfa_due_at: "2026-10-31T00:00:00Z", mfa_enabled_at: "x" }, now), false);
  assert.equal(mfaSetupNeeded({ is_platform_admin: false, require_mfa: true }, now), true);
  assert.equal(mfaSetupNeeded({ is_platform_admin: false, require_mfa: false }, now), false);
});

test("the last active super admin cannot be demoted or disabled", () => {
  const one = [{ id: "1" }];
  const two = [{ id: "1" }, { id: "6" }];
  assert.match(lastSuperGuard(one, 1, "admin", true), /last active super admin/);
  assert.match(lastSuperGuard(one, 1, "super", false), /last active super admin/);
  assert.equal(lastSuperGuard(two, 1, "admin", true), null);
  assert.equal(lastSuperGuard(one, 6, "support", true), null);
  assert.equal(lastSuperGuard(one, 1, "super", true), null);
});

test("platform invites need a name, an email and a level", () => {
  assert.deepEqual(parsePlatformInvite({ name: " Ann ", email: "Ann@Example.com ", role: "support" }).value, { name: "Ann", email: "ann@example.com", role: "support" });
  assert.ok(parsePlatformInvite({ name: "Ann", email: "ann@example.com", role: "owner" }).error);
  assert.ok(parsePlatformInvite({ name: "", email: "ann@example.com", role: "admin" }).error);
});
