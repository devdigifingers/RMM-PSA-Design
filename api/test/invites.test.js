import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditMeta, enterRequest, setRequestRole } from "../src/audit.js";
import { parseInvite } from "../src/invite-input.js";

describe("parseInvite", () => {
  it("accepts a name, email and role", () => {
    assert.deepEqual(parseInvite({ name: " Ann  Lee ", email: "Ann@Example.com ", role: "tech" }), {
      value: { name: "Ann  Lee", email: "ann@example.com", role: "tech" },
    });
  });

  it("rejects bad input with plain messages", () => {
    assert.equal(parseInvite({ name: "", email: "a@b.co", role: "tech" }).error, "Enter the person's full name.");
    assert.equal(parseInvite({ name: "Ann", email: "not-an-email", role: "tech" }).error, "Enter a valid email address.");
    assert.equal(parseInvite({ name: "Ann", email: "a@b.co", role: "boss" }).error, "Choose a role.");
  });
});

describe("audit request context", () => {
  it("records ip, browser and the highest tenant role", async () => {
    await new Promise((resolve) => {
      setImmediate(() => {
        enterRequest({ headers: { "x-df-user-agent": "Firefox", "user-agent": "node" } }, "196.25.1.1");
        setRequestRole({ roles: ["tech", "admin"] });
        assert.deepEqual(auditMeta(), { role: "admin", ip: "196.25.1.1", userAgent: "Firefox" });
        resolve();
      });
    });
  });

  it("labels platform admins and tenant views", async () => {
    await new Promise((resolve) => {
      setImmediate(() => {
        enterRequest({ headers: {} }, "unknown");
        setRequestRole({ is_platform_admin: true, roles: [] });
        assert.equal(auditMeta().role, "platform_admin");
        setRequestRole({ is_platform_admin: false, impersonating: { orgId: 2 }, roles: ["admin"] });
        assert.deepEqual(auditMeta(), { role: "platform_admin_as_tenant", ip: null, userAgent: null });
        resolve();
      });
    });
  });
});
