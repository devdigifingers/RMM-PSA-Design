import { documentTotals, lineAmounts, toCents, toQuantity } from "./money.js";
import { allowedTreatments, standardRateOn } from "./sars.js";
import { BillingInputError, validDate } from "./setup.js";

export const LINE_TYPES = ["item", "heading", "subtotal"];
export const MAX_LINES = 200;

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

function dateField(value, label) {
  if (!validDate(value)) throw new BillingInputError(`${label} must be a date (YYYY-MM-DD).`);
  return value;
}

export function rateFor(taxType, date) {
  return taxType === "standard" ? standardRateOn(date) : 0;
}

function quantityOf(value) {
  if (Number.isSafeInteger(value?.milli)) return value.milli;
  try {
    return toQuantity(value ?? "1");
  } catch {
    throw new BillingInputError("A quantity must be a number with at most 3 decimals.");
  }
}

function centsOf(value, label) {
  if (Number.isSafeInteger(value?.cents)) return value.cents;
  if (value === "" || value == null) return 0;
  try {
    return toCents(value);
  } catch {
    throw new BillingInputError(`${label} must be a rand amount, for example 1 250,00.`);
  }
}

// Turns editor input into stored line fields. Tax types follow the VAT status on the document date.
export function parseLines(rawLines, { vatRegistered }) {
  const list = Array.isArray(rawLines) ? rawLines : [];
  if (list.length > MAX_LINES) throw new BillingInputError(`A document can have at most ${MAX_LINES} lines.`);
  const allowed = allowedTreatments(vatRegistered);
  return list
    .map((raw) => {
      const lineType = LINE_TYPES.includes(raw?.lineType) ? raw.lineType : "item";
      const description = clip(raw?.description, 2000);
      if (lineType === "subtotal") return { lineType, description: description || "Subtotal" };
      if (lineType === "heading") return description ? { lineType, description } : null;
      const quantity = quantityOf(raw?.quantity);
      const unitPriceCents = centsOf(raw?.unitPrice ?? raw?.unitPriceCents, "A unit price");
      if (!description && !unitPriceCents) return null;
      const discountBp = Math.round(Number(String(raw?.discountPercent ?? "0").replace(",", ".")) * 100);
      if (!Number.isSafeInteger(discountBp) || discountBp < 0 || discountBp > 10000) throw new BillingInputError("A line discount must be between 0% and 100%.");
      let taxType = String(raw?.taxType || "");
      if (!vatRegistered) taxType = "no_vat";
      else if (!allowed.includes(taxType)) taxType = "standard";
      const itemId = /^\d+$/.test(String(raw?.itemId ?? "")) ? Number(raw.itemId) : null;
      return { lineType, itemId, description, quantity, unit: clip(raw?.unit, 20), unitPriceCents, discountBp, taxType };
    })
    .filter(Boolean);
}

// Recomputes amounts for the given date: the standard rate is the one in force that day.
export function computeLines(lines, { date, priceMode = "excl", vatRegistered }) {
  const inclusive = priceMode === "incl" && vatRegistered;
  const computed = lines.map((line) => {
    if (line.lineType !== "item") return { ...line, rateBp: 0, net: 0, tax: 0, total: 0, discount: 0 };
    const taxType = vatRegistered ? line.taxType : "no_vat";
    const rateBp = rateFor(taxType, date);
    const amounts = lineAmounts({ quantity: line.quantity, unitCents: line.unitPriceCents, rateBp, inclusive, discountBp: line.discountBp || 0 });
    return { ...line, taxType, rateBp, net: amounts.net, tax: amounts.vat, total: amounts.total, discount: amounts.discount };
  });
  const items = computed.filter((line) => line.lineType === "item");
  const totals = documentTotals(items.map((line) => ({ net: line.net, vat: line.tax, discount: line.discount, rateBp: line.rateBp, rateKey: `${line.taxType}:${line.rateBp}` })));
  return { lines: computed, totals };
}

export function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
}

export function isOverdue(doc, today) {
  return doc.kind === "invoice" && ["issued", "partially_paid"].includes(doc.status) && Boolean(doc.dueDate) && doc.dueDate < today && doc.balanceCents > 0;
}

export function parseDraftHeader(body, { today, kind, defaultTermsDays }) {
  const issueDate = body.issueDate ? dateField(body.issueDate, "The date") : today;
  const out = {
    issueDate,
    poNumber: clip(body.poNumber, 60),
    reference: clip(body.reference, 200),
    notes: clip(body.notes, 4000),
    terms: clip(body.terms, 4000),
    template: ["modern", "classic", "minimal"].includes(body.template) ? body.template : null,
    priceMode: body.priceMode === "incl" ? "incl" : "excl",
    creditReason: clip(body.creditReason, 2000),
  };
  if (kind === "invoice") {
    const days = body.termsDays === "" || body.termsDays == null ? defaultTermsDays : Number(body.termsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new BillingInputError("Payment terms must be 0 to 365 days.");
    out.dueDate = body.dueDate ? dateField(body.dueDate, "The due date") : addDays(issueDate, days);
    if (out.dueDate < issueDate) throw new BillingInputError("The due date cannot be before the invoice date.");
  }
  if (kind === "quote") {
    out.validUntil = body.validUntil ? dateField(body.validUntil, "Valid until") : addDays(issueDate, 30);
    if (out.validUntil < issueDate) throw new BillingInputError("Valid until cannot be before the quote date.");
  }
  return out;
}
