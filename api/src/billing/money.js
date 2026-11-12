// Money is integer cents; quantities are integer thousandths (3 decimals).
// Rounding is half away from zero, so a credit note mirrors the invoice it reverses.

const NBSP = "\u00a0";

function roundDiv(numerator, denominator) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (2n * n + d) / (2n * d);
  return negative ? -rounded : rounded;
}

function decimalToUnits(value, places, label) {
  const text = String(value ?? "").trim().replace(/[\s\u00a0]/g, "").replace(/^R/i, "").replace(",", ".");
  const match = text.match(/^(-?)(\d+)(?:\.(\d*))?$/);
  if (!match || (match[3] || "").length > places) throw new RangeError(`${label} must be a number with at most ${places} decimals.`);
  const units = BigInt(match[2]) * 10n ** BigInt(places) + BigInt((match[3] || "").padEnd(places, "0") || "0");
  const result = Number(match[1] ? -units : units);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is too large.`);
  return result;
}

export function toCents(value) {
  return decimalToUnits(value, 2, "An amount");
}

export function toQuantity(value) {
  return decimalToUnits(value, 3, "A quantity");
}

// rateBp and percent discounts are basis points: 15% = 1500.
export function lineAmounts({ quantity, unitCents, rateBp = 0, inclusive = false, discountBp = 0, discountCents = 0 }) {
  for (const [label, value] of Object.entries({ quantity, unitCents, rateBp, discountBp, discountCents })) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a whole number.`);
  }
  if (rateBp < 0 || discountBp < 0 || discountBp > 10000 || discountCents < 0) throw new RangeError("Rates and discounts cannot be negative.");
  const gross = roundDiv(BigInt(quantity) * BigInt(unitCents), 1000n);
  let discount = discountBp ? roundDiv(gross * BigInt(discountBp), 10000n) : BigInt(discountCents);
  const size = gross < 0n ? -gross : gross;
  if (discount > size) discount = size;
  if (gross < 0n) discount = -discount;
  const amount = gross - discount;
  const rate = BigInt(rateBp);
  if (inclusive) {
    const vat = roundDiv(amount * rate, 10000n + rate);
    return { gross: Number(gross), discount: Number(discount), net: Number(amount - vat), vat: Number(vat), total: Number(amount) };
  }
  const vat = roundDiv(amount * rate, 10000n);
  return { gross: Number(gross), discount: Number(discount), net: Number(amount), vat: Number(vat), total: Number(amount + vat) };
}

// Spreads a document discount over line amounts in proportion (largest remainder), so per-line VAT stays right.
export function spreadDiscount(amounts, discountCents) {
  const total = amounts.reduce((sum, value) => sum + value, 0);
  if (!discountCents || total <= 0) return amounts.map(() => 0);
  const target = Math.min(discountCents, total);
  const shares = amounts.map((value, index) => {
    const exact = BigInt(value) * BigInt(target);
    return { index, floor: Number(exact / BigInt(total)), rest: Number(exact % BigInt(total)) };
  });
  let left = target - shares.reduce((sum, share) => sum + share.floor, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.index - b.index)) {
    if (left <= 0) break;
    share.floor += 1;
    left -= 1;
  }
  return shares.map((share) => share.floor);
}

export function documentTotals(lines) {
  const byRate = new Map();
  let discount = 0;
  let net = 0;
  let vat = 0;
  for (const line of lines) {
    discount += line.discount || 0;
    net += line.net;
    vat += line.vat;
    const key = line.rateKey ?? String(line.rateBp ?? 0);
    const entry = byRate.get(key) || { rateKey: key, rateBp: line.rateBp ?? 0, net: 0, vat: 0 };
    entry.net += line.net;
    entry.vat += line.vat;
    byRate.set(key, entry);
  }
  return { subtotal: net, discount, vat, total: net + vat, vatByRate: [...byRate.values()] };
}

export function formatRand(cents, { symbol = true } = {}) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("An amount must be whole cents.");
  const size = Math.abs(cents);
  const whole = String(Math.floor(size / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const text = `${whole},${String(size % 100).padStart(2, "0")}`;
  return `${cents < 0 ? "-" : ""}${symbol ? `R${NBSP}` : ""}${text}`;
}

export function formatQuantity(quantity) {
  const sign = quantity < 0 ? "-" : "";
  const size = Math.abs(quantity);
  const fraction = String(size % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${Math.floor(size / 1000)}${fraction ? `,${fraction}` : ""}`;
}
