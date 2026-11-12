// Tenant isolation for the Session Panel. Runs against a throwaway Postgres with schema.sql applied; skipped unless
// BILLING_TEST_DB=1 (PG* variables point at that database).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const enabled = process.env.BILLING_TEST_DB === "1";

describe("session panel (database)", { skip: !enabled }, () => {
  let pool, store;
  let orgA, orgB, techA, techB, deviceA, deviceB, sessionA;

  before(async () => {
    ({ pool } = await import("../src/db.js"));
    store = await import("../src/session-panel-store.js");
    const suffix = Date.now();
    const org = async (name) => Number((await pool.query("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, `${name}-${suffix}`.toLowerCase().replace(/\W+/g, "-")])).rows[0].id);
    const user = async (orgId, email, name) => Number((await pool.query("INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id", [orgId, `${email}-${suffix}@example.test`, name])).rows[0].id);
    const device = async (orgId, hostname) => Number((await pool.query("INSERT INTO devices (org_id, hostname, os_name) VALUES ($1, $2, 'Windows 11 Pro') RETURNING id", [orgId, hostname])).rows[0].id);
    orgA = await org("Panel Tenant A");
    orgB = await org("Panel Tenant B");
    techA = await user(orgA, "tech-a", "Thandi Mokoena");
    techB = await user(orgB, "tech-b", "Pieter Botha");
    deviceA = await device(orgA, "PANEL-A-01");
    deviceB = await device(orgB, "PANEL-B-01");
    sessionA = Number((await pool.query(
      "INSERT INTO remote_sessions (org_id, device_id, user_id, device_name, status) VALUES ($1, $2, $3, 'PANEL-A-01', 'live') RETURNING id",
      [orgA, deviceA, techA],
    )).rows[0].id);
  });

  after(async () => {
    await pool?.end();
  });

  it("shows the session to its own device in its own tenant", async () => {
    const live = await store.livePanelSession(pool, deviceA, orgA);
    assert.equal(Number(live.id), sessionA);
    assert.equal(live.technician_name, "Thandi Mokoena");
    assert.equal(live.org_name, "Panel Tenant A");
  });

  it("never shows a session through another tenant or another device", async () => {
    assert.equal(await store.livePanelSession(pool, deviceA, orgB), null);
    assert.equal(await store.livePanelSession(pool, deviceB, orgA), null);
    assert.equal(await store.livePanelSession(pool, deviceB, orgB), null);
  });

  it("only lets the session's own device pause or end it", async () => {
    assert.equal(Number((await store.deviceSession(pool, sessionA, deviceA, orgA)).id), sessionA);
    assert.equal(await store.deviceSession(pool, sessionA, deviceB, orgB), null);
    assert.equal(await store.deviceSession(pool, sessionA, deviceA, orgB), null);
    assert.equal(await store.deviceSession(pool, sessionA, deviceB, orgA), null);
  });

  it("ignores another tenant's technician checking in on the session", async () => {
    const before = (await pool.query("SELECT shell_seen_at, tsid FROM remote_sessions WHERE id = $1", [sessionA])).rows[0];
    assert.deepEqual(await store.pingSession(pool, { deviceId: deviceA, orgId: orgB, userId: techB, tsid: 3 }), { tracked: false });
    assert.deepEqual(await store.pingSession(pool, { deviceId: deviceA, orgId: orgA, userId: techB, tsid: 3 }), { tracked: false });
    assert.deepEqual(await store.pingSession(pool, { deviceId: deviceA, orgId: orgB, userId: techA, tsid: 3 }), { tracked: false });
    const afterPing = (await pool.query("SELECT shell_seen_at, tsid FROM remote_sessions WHERE id = $1", [sessionA])).rows[0];
    assert.deepEqual(afterPing, before);
  });

  it("tracks the technician's own session window and reports a customer pause and end", async () => {
    const ping = await store.pingSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA, tsid: 2 });
    assert.deepEqual(ping, { tracked: true, paused: false, panel: null });
    assert.equal((await pool.query("SELECT tsid FROM remote_sessions WHERE id = $1", [sessionA])).rows[0].tsid, 2);
    await pool.query("UPDATE remote_sessions SET paused_at = now() WHERE id = $1", [sessionA]);
    assert.equal((await store.pingSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA })).paused, true);
    await pool.query("UPDATE remote_sessions SET ended_by = 'customer', status = 'ended', ended_at = now() WHERE id = $1", [sessionA]);
    assert.deepEqual(await store.pingSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA }), { tracked: true, endedBy: "customer" });
    assert.equal(await store.livePanelSession(pool, deviceA, orgA), null);
  });

  it("stops showing the panel once the session window closes", async () => {
    const id = Number((await pool.query(
      "INSERT INTO remote_sessions (org_id, device_id, user_id, device_name, status) VALUES ($1, $2, $3, 'PANEL-A-01', 'live') RETURNING id",
      [orgA, deviceA, techA],
    )).rows[0].id);
    assert.equal(Number((await store.livePanelSession(pool, deviceA, orgA)).id), id);
    assert.deepEqual(await store.pingSession(pool, { deviceId: deviceA, orgId: orgA, userId: techA, closed: true }), { tracked: true });
    assert.equal(await store.livePanelSession(pool, deviceA, orgA), null);
  });
});
