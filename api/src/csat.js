import { createHmac, timingSafeEqual } from "node:crypto";

export const RATINGS = ["good", "ok", "bad"];
export const RATING_LABELS = { good: "Good", ok: "OK", bad: "Bad" };

// One signature per ticket: anyone holding the resolved email can rate that ticket, and nothing else.
export function csatSignature(key, orgId, ticketId) {
  return createHmac("sha256", key).update(`csat:${orgId}:${ticketId}`).digest("base64url").slice(0, 32);
}

export function csatValid(key, orgId, ticketId, signature) {
  const expected = Buffer.from(csatSignature(key, orgId, ticketId));
  const given = Buffer.from(String(signature || ""));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function csatLinks(baseUrl, key, orgId, ticketId) {
  const sig = csatSignature(key, orgId, ticketId);
  return Object.fromEntries(RATINGS.map((rating) => [rating, `${baseUrl}/rate/${ticketId}?r=${rating}&s=${sig}`]));
}

// Happiness: share of good ratings, with OK counted as half.
export function happiness(counts) {
  const good = Number(counts?.good) || 0;
  const ok = Number(counts?.ok) || 0;
  const bad = Number(counts?.bad) || 0;
  const total = good + ok + bad;
  return { good, ok, bad, total, score: total ? Math.round(((good + ok / 2) / total) * 100) : null };
}
