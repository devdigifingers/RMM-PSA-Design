import { readFileSync, statSync } from "node:fs";

const METADATA_MARKER = Buffer.from("abcdef4d61784d696e642e636f6d", "hex");

export const UNKNOWN = Object.freeze({ country: "", countryName: "", region: "", city: "", lat: null, lon: null });

function ipv4Bytes(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : 256));
  return bytes.every((value) => value <= 255) ? bytes : null;
}

function ipv6Bytes(text) {
  let value = text;
  if (value.includes(".")) {
    const cut = value.lastIndexOf(":");
    const v4 = ipv4Bytes(value.slice(cut + 1));
    if (!v4) return null;
    value = `${value.slice(0, cut + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const words = (part) => (part ? part.split(":") : []).map((word) => (/^[0-9a-f]{1,4}$/i.test(word) ? parseInt(word, 16) : -1));
  const head = words(halves[0]);
  const rest = halves.length === 2 ? words(halves[1]) : [];
  if ([...head, ...rest].some((word) => word < 0)) return null;
  const gap = 8 - head.length - rest.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null;
  return [...head, ...Array(halves.length === 2 ? gap : 0).fill(0), ...rest].flatMap((word) => [word >> 8, word & 255]);
}

export function parseIp(text) {
  const value = String(text || "").trim().replace(/^\[|\]$/g, "");
  if (!value) return null;
  const v4 = ipv4Bytes(value);
  if (v4) return { version: 4, bytes: v4 };
  const v6 = value.includes(":") ? ipv6Bytes(value.split("%")[0]) : null;
  if (!v6) return null;
  const mapped = v6.slice(0, 10).every((byte) => byte === 0) && v6[10] === 255 && v6[11] === 255;
  return mapped ? { version: 4, bytes: v6.slice(12) } : { version: 6, bytes: v6 };
}

export function isPublicIp(text) {
  const ip = parseIp(text);
  if (!ip) return false;
  const b = ip.bytes;
  if (ip.version === 4) {
    if (b[0] === 0 || b[0] === 10 || b[0] === 127 || b[0] >= 224) return false;
    if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return false;
    if (b[0] === 169 && b[1] === 254) return false;
    if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return false;
    if (b[0] === 192 && b[1] === 168) return false;
    if (b[0] === 192 && b[1] === 0 && b[2] === 2) return false;
    if (b[0] === 198 && (b[1] === 18 || b[1] === 19)) return false;
    return true;
  }
  if (b.slice(0, 15).every((byte) => byte === 0)) return false;
  if ((b[0] & 0xfe) === 0xfc) return false;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return false;
  if (b[0] === 0xff) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;
  return true;
}

class Decoder {
  constructor(buffer, base) {
    this.buffer = buffer;
    this.base = base;
  }

  decode(offset) {
    const buffer = this.buffer;
    const control = buffer[offset++];
    let type = control >> 5;
    if (type === 1) {
      const sizeBits = (control >> 3) & 3;
      const low = control & 7;
      let pointer;
      if (sizeBits === 0) pointer = (low << 8) | buffer[offset];
      else if (sizeBits === 1) pointer = ((low << 16) | buffer.readUInt16BE(offset)) + 2048;
      else if (sizeBits === 2) pointer = ((low << 24) | buffer.readUIntBE(offset, 3)) + 526336;
      else pointer = buffer.readUInt32BE(offset);
      const value = this.decode(this.base + pointer).value;
      return { value, next: offset + sizeBits + 1 };
    }
    if (type === 0) type = 7 + buffer[offset++];
    let size = control & 31;
    if (size === 29) size = 29 + buffer[offset++];
    else if (size === 30) { size = 285 + buffer.readUInt16BE(offset); offset += 2; }
    else if (size === 31) { size = 65821 + buffer.readUIntBE(offset, 3); offset += 3; }
    switch (type) {
      case 2:
        return { value: buffer.toString("utf8", offset, offset + size), next: offset + size };
      case 3:
        return { value: buffer.readDoubleBE(offset), next: offset + 8 };
      case 4:
        return { value: buffer.subarray(offset, offset + size), next: offset + size };
      case 5:
      case 6:
      case 8:
      case 9:
      case 10: {
        let value = 0;
        for (let i = 0; i < size; i += 1) value = value * 256 + buffer[offset + i];
        if (type === 8 && size === 4 && value >= 2 ** 31) value -= 2 ** 32;
        return { value, next: offset + size };
      }
      case 7: {
        const value = {};
        let next = offset;
        for (let i = 0; i < size; i += 1) {
          const key = this.decode(next);
          const item = this.decode(key.next);
          value[key.value] = item.value;
          next = item.next;
        }
        return { value, next };
      }
      case 11: {
        const value = [];
        let next = offset;
        for (let i = 0; i < size; i += 1) {
          const item = this.decode(next);
          value.push(item.value);
          next = item.next;
        }
        return { value, next };
      }
      case 14:
        return { value: size !== 0, next: offset };
      case 15:
        return { value: buffer.readFloatBE(offset), next: offset + 4 };
      default:
        throw new Error(`unsupported mmdb data type ${type}`);
    }
  }
}

export class GeoDatabase {
  constructor(buffer) {
    const marker = buffer.lastIndexOf(METADATA_MARKER);
    if (marker < 0) throw new Error("not a MaxMind database");
    const metaStart = marker + METADATA_MARKER.length;
    this.metadata = new Decoder(buffer, metaStart).decode(metaStart).value;
    const { node_count: nodeCount, record_size: recordSize, ip_version: ipVersion } = this.metadata;
    if (![24, 28, 32].includes(recordSize)) throw new Error("unsupported record size");
    this.buffer = buffer;
    this.nodeCount = nodeCount;
    this.recordSize = recordSize;
    this.ipVersion = ipVersion;
    this.nodeBytes = recordSize / 4;
    this.treeSize = this.nodeBytes * nodeCount;
    this.data = new Decoder(buffer, this.treeSize + 16);
    this.ipv4Start = 0;
    if (ipVersion === 6) {
      let node = 0;
      for (let i = 0; i < 96 && node < nodeCount; i += 1) node = this.record(node, 0);
      this.ipv4Start = node;
    }
  }

  record(node, bit) {
    const buffer = this.buffer;
    const at = node * this.nodeBytes;
    if (this.recordSize === 24) return buffer.readUIntBE(at + bit * 3, 3);
    if (this.recordSize === 32) return buffer.readUInt32BE(at + bit * 4);
    if (bit === 0) return ((buffer[at + 3] & 0xf0) << 20) | buffer.readUIntBE(at, 3);
    return ((buffer[at + 3] & 0x0f) << 24) | buffer.readUIntBE(at + 4, 3);
  }

  get(text) {
    const ip = parseIp(text);
    if (!ip) return null;
    if (ip.version === 6 && this.ipVersion === 4) return null;
    let node = ip.version === 4 ? this.ipv4Start : 0;
    const bits = ip.bytes.length * 8;
    for (let i = 0; i < bits && node < this.nodeCount; i += 1) {
      const bit = (ip.bytes[i >> 3] >> (7 - (i & 7))) & 1;
      node = this.record(node, bit);
    }
    if (node <= this.nodeCount) return null;
    return this.data.decode(this.treeSize + node - this.nodeCount).value;
  }
}

function english(names) {
  return (names && (names.en || Object.values(names)[0])) || "";
}

function rounded(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function placeFrom(record) {
  if (!record) return UNKNOWN;
  const country = record.country || record.registered_country || {};
  const region = Array.isArray(record.subdivisions) ? record.subdivisions[0] : null;
  return {
    country: String(country.iso_code || "").slice(0, 2),
    countryName: english(country.names),
    region: english(region?.names),
    city: english(record.city?.names),
    lat: rounded(record.location?.latitude),
    lon: rounded(record.location?.longitude),
  };
}

export function geoLocator(path, { recheckMs = 60 * 60 * 1000 } = {}) {
  let database = null;
  let loadedMtime = 0;
  let checkedAt = 0;
  function current() {
    const now = Date.now();
    if (checkedAt && now - checkedAt < recheckMs) return database;
    checkedAt = now;
    try {
      const mtime = statSync(path).mtimeMs;
      if (!database || mtime !== loadedMtime) {
        database = new GeoDatabase(readFileSync(path));
        loadedMtime = mtime;
      }
    } catch (error) {
      if (database === null && error.code !== "ENOENT") console.error(`geoip: ${error.message}`);
    }
    return database;
  }
  return {
    available: () => current() !== null,
    lookup(ip) {
      if (!isPublicIp(ip)) return UNKNOWN;
      const db = current();
      if (!db) return UNKNOWN;
      try {
        return placeFrom(db.get(ip));
      } catch (error) {
        console.error(`geoip lookup: ${error.message}`);
        return UNKNOWN;
      }
    },
  };
}

export function placeFromIpApi(body) {
  if (!body || body.status !== "success") return null;
  return {
    country: String(body.countryCode || "").slice(0, 2),
    countryName: String(body.country || ""),
    region: String(body.regionName || ""),
    city: String(body.city || ""),
    lat: rounded(body.lat),
    lon: rounded(body.lon),
  };
}

const IP_API_FIELDS = "status,message,countryCode,country,regionName,city,lat,lon";

// Fallback while no local database is installed. The free endpoint is HTTP only,
// limited to 45 requests a minute and non-commercial; a key switches to pro (HTTPS).
// Returns null when the lookup could not be made, so the caller retries later.
export function ipApiLocator({ key = "", fetchImpl = fetch, cacheMs = 24 * 60 * 60 * 1000, failMs = 10 * 60 * 1000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let blockedUntil = 0;
  return {
    lookup(ip) {
      if (!isPublicIp(ip)) return Promise.resolve(UNKNOWN);
      const now = Date.now();
      const hit = cache.get(ip);
      if (hit && hit.until > now) return Promise.resolve(hit.place);
      if (now < blockedUntil) return Promise.resolve(null);
      if (!pending.has(ip)) pending.set(ip, request(ip, now).finally(() => pending.delete(ip)));
      return pending.get(ip);
    },
  };

  async function request(ip, now) {
    const url = key
      ? `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}&key=${encodeURIComponent(key)}`
      : `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      const header = (name) => {
        const value = response.headers.get(name);
        return value === null || value === "" ? NaN : Number(value);
      };
      const remaining = header("x-rl");
      const ttl = header("x-ttl");
      if (response.status === 429 || remaining <= 1) {
        blockedUntil = now + (ttl > 0 ? ttl : 60) * 1000;
      }
      if (!response.ok) return null;
      const body = await response.json();
      const place = placeFromIpApi(body);
      if (!place) {
        if (body?.message === "private range" || body?.message === "reserved range") return UNKNOWN;
        cache.set(ip, { place: null, until: now + failMs });
        return null;
      }
      cache.set(ip, { place, until: now + cacheMs });
      return place;
    } catch (error) {
      console.error(`ip-api lookup: ${error.message}`);
      blockedUntil = now + 60 * 1000;
      return null;
    }
  }
}

// A manual site / branch always wins over the GeoIP location when grouping devices.
export function deviceGroup(device) {
  const site = String(device.site_override || "").trim();
  if (site) return { kind: "site", label: site };
  const place = [device.geo_city, device.geo_region].filter(Boolean).join(", ");
  return { kind: "location", label: place || String(device.geo_country_name || "").trim() || "Unknown" };
}
