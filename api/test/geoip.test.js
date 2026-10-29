import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GeoDatabase, UNKNOWN, deviceGroup, geoLocator, ipApiLocator, isPublicIp, parseIp } from "../src/geoip.js";

function fakeFetch(body, { status = 200, headers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => body,
    };
  };
  return { calls, fetchImpl };
}

test("ip-api fallback maps the response and caches per address", async () => {
  const { calls, fetchImpl } = fakeFetch({
    status: "success", countryCode: "ZA", country: "South Africa", regionName: "Gauteng",
    city: "Johannesburg", lat: -26.20412, lon: 28.04731,
  });
  const locator = ipApiLocator({ fetchImpl });
  const [first, second] = await Promise.all([locator.lookup("8.8.8.8"), locator.lookup("8.8.8.8")]);
  assert.deepEqual(first, {
    country: "ZA", countryName: "South Africa", region: "Gauteng", city: "Johannesburg", lat: -26.2, lon: 28.05,
  });
  assert.deepEqual(second, first);
  await locator.lookup("8.8.8.8");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^http:\/\/ip-api\.com\/json\/8\.8\.8\.8\?/);
});

test("ip-api fallback skips private addresses and uses pro with a key", async () => {
  const { calls, fetchImpl } = fakeFetch({ status: "success", countryCode: "ZA" });
  const locator = ipApiLocator({ key: "k", fetchImpl });
  assert.equal(await locator.lookup("192.168.1.10"), UNKNOWN);
  await locator.lookup("1.1.1.1");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/pro\.ip-api\.com\/json\/1\.1\.1\.1\?.*&key=k$/);
});

test("ip-api fallback backs off when rate limited and reports failures as null", async () => {
  const { calls, fetchImpl } = fakeFetch({}, { status: 429, headers: { "x-ttl": "30" } });
  const locator = ipApiLocator({ fetchImpl });
  assert.equal(await locator.lookup("8.8.8.8"), null);
  assert.equal(await locator.lookup("1.1.1.1"), null);
  assert.equal(calls.length, 1);
});

function str(text) {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([(2 << 5) | bytes.length]), bytes]);
}
function map(entries) {
  return Buffer.concat([Buffer.from([(7 << 5) | entries.length]), ...entries.flat()]);
}
function array(items) {
  return Buffer.concat([Buffer.from([items.length, 11 - 7]), ...items]);
}
function double(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(value);
  return Buffer.concat([Buffer.from([(3 << 5) | 8]), bytes]);
}
function uint(type, size, value) {
  const bytes = Buffer.alloc(size);
  bytes.writeUIntBE(value, 0, size);
  return Buffer.concat([Buffer.from([(type << 5) | size]), bytes]);
}

// An IPv4 database with one network, 41.0.0.0/8, placed in Johannesburg.
function sampleDatabase() {
  const nodeCount = 8;
  const path = 41;
  const tree = Buffer.alloc(nodeCount * 6);
  for (let depth = 0; depth < nodeCount; depth += 1) {
    const bit = (path >> (7 - depth)) & 1;
    const next = depth === nodeCount - 1 ? nodeCount + 16 : depth + 1;
    tree.writeUIntBE(bit ? nodeCount : next, depth * 6, 3);
    tree.writeUIntBE(bit ? next : nodeCount, depth * 6 + 3, 3);
  }
  const record = map([
    [str("country"), map([[str("iso_code"), str("ZA")], [str("names"), map([[str("en"), str("South Africa")]])]])],
    [str("subdivisions"), array([map([[str("names"), map([[str("en"), str("Gauteng")]])]])])],
    [str("city"), map([[str("names"), map([[str("en"), str("Johannesburg")]])]])],
    [str("location"), map([[str("latitude"), double(-26.2041)], [str("longitude"), double(28.0473)]])],
  ]);
  const metadata = map([
    [str("node_count"), uint(6, 4, nodeCount)],
    [str("record_size"), uint(5, 2, 24)],
    [str("ip_version"), uint(5, 2, 4)],
  ]);
  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    record,
    Buffer.from("abcdef4d61784d696e642e636f6d", "hex"),
    metadata,
  ]);
}

test("parseIp reads IPv4, IPv6 and IPv4-mapped addresses", () => {
  assert.deepEqual(parseIp("41.1.2.3"), { version: 4, bytes: [41, 1, 2, 3] });
  assert.deepEqual(parseIp("::ffff:41.1.2.3"), { version: 4, bytes: [41, 1, 2, 3] });
  assert.equal(parseIp("2c0f:f4c0::1").version, 6);
  assert.equal(parseIp("not-an-ip"), null);
  assert.equal(parseIp("300.1.1.1"), null);
});

test("private and reserved addresses are not public", () => {
  for (const ip of ["10.0.0.5", "172.16.4.1", "192.168.1.10", "127.0.0.1", "100.64.0.1", "169.254.1.1", "fd00::1", "fe80::1", "::1", ""]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  assert.equal(isPublicIp("41.1.2.3"), true);
  assert.equal(isPublicIp("2c0f:f4c0::1"), true);
});

test("a South African IP resolves to province and city", () => {
  const db = new GeoDatabase(sampleDatabase());
  const dir = mkdtempSync(join(tmpdir(), "geoip-"));
  const file = join(dir, "City.mmdb");
  writeFileSync(file, sampleDatabase());
  assert.ok(db.get("41.20.30.40"));
  const place = geoLocator(file).lookup("41.20.30.40");
  assert.deepEqual(place, {
    country: "ZA",
    countryName: "South Africa",
    region: "Gauteng",
    city: "Johannesburg",
    lat: -26.2,
    lon: 28.05,
  });
});

test("private, unmatched and missing-database lookups are Unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "geoip-"));
  const file = join(dir, "City.mmdb");
  writeFileSync(file, sampleDatabase());
  const locator = geoLocator(file);
  assert.deepEqual(locator.lookup("192.168.1.10"), UNKNOWN);
  assert.deepEqual(locator.lookup("8.8.8.8"), UNKNOWN);
  assert.deepEqual(geoLocator(join(dir, "missing.mmdb")).lookup("41.20.30.40"), UNKNOWN);
});

test("site override beats GeoIP for grouping", () => {
  const located = { geo_city: "Johannesburg", geo_region: "Gauteng" };
  assert.deepEqual(deviceGroup(located), { kind: "location", label: "Johannesburg, Gauteng" });
  assert.deepEqual(deviceGroup({ ...located, site_override: "Durban branch" }), { kind: "site", label: "Durban branch" });
  assert.deepEqual(deviceGroup({ site_override: "  " }), { kind: "location", label: "Unknown" });
  assert.deepEqual(deviceGroup({ geo_country_name: "United States" }), { kind: "location", label: "United States" });
});
