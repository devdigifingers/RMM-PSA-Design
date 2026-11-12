// SARS VAT rules (VAT Act s20 and s21), checked November 2026. Dates are YYYY-MM-DD in Africa/Johannesburg.

// Budget 2026 withdrew the proposed increase; 15% confirmed in November 2026.
export const STANDARD_RATES = [
  { rateBp: 1400, from: "1993-04-07", to: "2018-03-31" },
  { rateBp: 1500, from: "2018-04-01", to: null },
];

export const FULL_INVOICE_OVER_CENTS = 500000;
export const ABRIDGED_INVOICE_OVER_CENTS = 5000;
export const TAX_INVOICE_DAYS = 21;
export const RECORD_KEEPING_YEARS = 5;

export const TAX_TREATMENTS = ["standard", "zero_rated", "exempt", "no_vat"];

const VAGUE_DESCRIPTIONS = new Set(["", "services", "service", "goods", "various", "sundries"]);

export function normaliseVatNumber(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

export function isValidVatNumber(value) {
  return /^4\d{9}$/.test(normaliseVatNumber(value));
}

export function standardRateOn(date) {
  const rate = STANDARD_RATES.find((entry) => entry.from <= date && (!entry.to || date <= entry.to));
  if (!rate) throw new RangeError(`No standard VAT rate is recorded for ${date}.`);
  return rate.rateBp;
}

// history: [{ registered, effectiveFrom }]; the latest change on or before the date wins.
export function vatRegisteredOn(history, date) {
  let current = false;
  let since = "";
  for (const entry of history || []) {
    if (entry.effectiveFrom <= date && entry.effectiveFrom >= since) {
      current = entry.registered === true;
      since = entry.effectiveFrom;
    }
  }
  return current;
}

// vatRegistered drives every VAT difference; it and the VAT number must agree.
export function vatSettingsError({ vatRegistered, vatNumber }) {
  const number = normaliseVatNumber(vatNumber);
  if (vatRegistered && !number) return "Enter your VAT number, or set VAT registered to No.";
  if (vatRegistered && !isValidVatNumber(number)) return "A VAT number is 10 digits starting with 4.";
  if (!vatRegistered && number) return "Remove the VAT number, or set VAT registered to Yes.";
  return null;
}

export function allowedTreatments(vatRegistered) {
  return vatRegistered ? ["standard", "zero_rated", "exempt"] : ["no_vat"];
}

export function documentTitle(kind, vatRegistered) {
  if (kind === "invoice") return vatRegistered ? "Tax Invoice" : "Invoice";
  if (kind === "credit_note") return "Credit Note";
  if (kind === "quote") return "Quote";
  if (kind === "statement") return "Statement";
  throw new RangeError(`Unknown document kind: ${kind}`);
}

export function invoiceTier(totalCents) {
  if (totalCents > FULL_INVOICE_OVER_CENTS) return "full";
  if (totalCents > ABRIDGED_INVOICE_OVER_CENTS) return "abridged";
  return "none";
}

// customer.vatStatus: "registered" | "not_registered" | "unknown"
export function issueChecks({ vatRegistered, totalCents, customer = {}, lines = [] }) {
  const blocks = [];
  const warnings = [];
  const full = invoiceTier(totalCents) === "full";
  if (!vatRegistered && lines.some((line) => line.treatment && line.treatment !== "no_vat")) {
    blocks.push({ code: "vat_not_registered", text: "Your organisation is not VAT registered, so no line can charge VAT." });
  }
  if (full && !String(customer.address ?? "").trim()) {
    blocks.push({ code: "customer_address", text: "Invoices over R 5 000 need the customer's address." });
  }
  if (customer.vatStatus === "registered" && !isValidVatNumber(customer.vatNumber)) {
    blocks.push({ code: "customer_vat_number", text: "The customer is a VAT vendor, so enter a valid VAT number for them." });
  }
  if (vatRegistered && full && (customer.vatStatus ?? "unknown") === "unknown") {
    warnings.push({ code: "customer_vat_unknown", text: "Is the customer VAT registered? Invoices over R 5 000 must show their VAT number if they are." });
  }
  if (lines.some((line) => line.kind !== "heading" && line.kind !== "subtotal" && VAGUE_DESCRIPTIONS.has(String(line.description ?? "").trim().toLowerCase()))) {
    warnings.push({ code: "vague_description", text: "Describe what was supplied. SARS needs a full and proper description." });
  }
  return { blocks, warnings };
}

export function creditNoteChecks({ reason, originalInvoice, reducesVat }) {
  const blocks = [];
  if (!String(reason ?? "").trim()) blocks.push({ code: "reason", text: "Give a reason for the credit note." });
  if (reducesVat && !originalInvoice) blocks.push({ code: "original_invoice", text: "Choose the invoice this credit note reduces." });
  return { blocks, warnings: [] };
}
