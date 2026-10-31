import assert from "node:assert/strict";
import test from "node:test";
import {
  hashToken,
  newToken,
  parseTokenRequest,
  tokenFromHeader,
  tokenHint,
  tokenProblem,
} from "../src/api-token-rules.js";

const allowAll = (value) => ({ value: Array.isArray(value) ? value : [] });

test("tokens are random, recognisable and stored only as a hash", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^dfk_[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), hashToken(b));
  assert.ok(!tokenHint(a).includes(a.slice(8, -4)));
});

test("only a well-formed bearer token is read from the header", () => {
  const token = newToken();
  assert.equal(tokenFromHeader(`Bearer ${token}`), token);
  assert.equal(tokenFromHeader(token), null);
  assert.equal(tokenFromHeader("Bearer abc"), null);
  assert.equal(tokenFromHeader("Bearer someSessionToken"), null);
});

test("a token needs a name, devices and an allowed expiry", () => {
  assert.match(parseTokenRequest({ deviceIds: [1], expiresInDays: 30 }, allowAll).error, /name/);
  assert.match(parseTokenRequest({ name: "Backup", deviceIds: [], expiresInDays: 30 }, allowAll).error, /device/);
  assert.match(parseTokenRequest({ name: "Backup", deviceIds: [1], expiresInDays: 0 }, allowAll).error, /expires/);
  assert.match(parseTokenRequest({ name: "Backup", deviceIds: [1], expiresInDays: 3650 }, allowAll).error, /expires/);
  const ok = parseTokenRequest({ name: "  Backup   script ", deviceIds: ["6", 6, 2], expiresInDays: 90 }, allowAll);
  assert.deepEqual(ok.value, { name: "Backup script", deviceIds: [6, 2], expiresInDays: 90, allowedIps: [], scopes: ["jobs"] });
});

test("address limits are validated with the shared allow-list parser", () => {
  const parser = (value) => (value.includes("bad") ? { error: "not valid" } : { value });
  assert.equal(parseTokenRequest({ name: "x", deviceIds: [1], expiresInDays: 7, allowedIps: ["bad"] }, parser).error, "not valid");
});

test("revoked, expired, orphaned or wrong-address tokens are refused", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const yes = () => true;
  const no = () => false;
  const good = { expires_at: "2026-11-30T00:00:00Z", revoked_at: null, creator_disabled_at: null, creator_manages: true, allowed_ips: [] };
  assert.equal(tokenProblem(good, { now, address: "1.2.3.4", addressAllowed: yes }), null);
  assert.equal(tokenProblem(null, { now, addressAllowed: yes }).status, 401);
  assert.match(tokenProblem({ ...good, revoked_at: now }, { now, addressAllowed: yes }).error, /revoked/);
  assert.match(tokenProblem({ ...good, expires_at: "2026-10-01T00:00:00Z" }, { now, addressAllowed: yes }).error, /expired/);
  assert.match(tokenProblem({ ...good, creator_disabled_at: now }, { now, addressAllowed: yes }).error, /created this token/);
  assert.match(tokenProblem({ ...good, creator_manages: false }, { now, addressAllowed: yes }).error, /created this token/);
  assert.equal(tokenProblem(good, { now, address: "9.9.9.9", addressAllowed: no }).status, 403);
});
