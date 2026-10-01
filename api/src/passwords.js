import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const actual = await scryptAsync(password, parts[1], 64);
  const expected = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
