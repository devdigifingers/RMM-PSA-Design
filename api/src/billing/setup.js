// Invoicing setup: defaults and input checks for company and tax, numbering, tax rates, items and customer billing fields.
import { toCents } from "./money.js";
import { STANDARD_RATES, isValidVatNumber, normaliseVatNumber, vatSettingsError } from "./sars.js";

export class BillingInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DOCUMENT_KINDS = ["invoice", "quote", "credit_note"];
export const KIND_LABELS = { invoice: "Invoices", quote: "Quotes", credit_note: "Credit notes" };
export const DEFAULT_SEQUENCES = { invoice: "INV-", quote: "QT-", credit_note: "CN-" };
export const ITEM_TYPES = ["service", "product", "labour", "device_plan", "user_plan"];
export const ITEM_UNITS = ["each", "hour", "device", "user", "month"];
export const TAX_TYPES = ["standard", "zero_rated", "exempt", "no_vat"];
export const TAX_LABELS = { standard: "Standard", zero_rated: "Zero-rated", exempt: "Exempt", no_vat: "No VAT" };
export const TEMPLATES = ["modern", "classic", "minimal"];
export const VAT_STATUSES = ["registered", "not_registered", "unknown"];

export const DEFAULT_TAX_RATES = [
  ...STANDARD_RATES.map((rate) => ({
    name: `Standard ${rate.rateBp / 100}%`, type: "standard", rateBp: rate.rateBp, from: rate.from, to: rate.to, sarsCode: "S",
  })),
  { name: "Zero-rated 0%", type: "zero_rated", rateBp: 0, from: "1993-04-07", to: null, sarsCode: "Z" },
  { name: "Exempt", type: "exempt", rateBp: 0, from: "1993-04-07", to: null, sarsCode: "E" },
  { name: "No VAT", type: "no_vat", rateBp: 0, from: "1993-04-07", to: null, sarsCode: "" },
];

// Prices start at zero; the tenant sets their own.
export const STARTER_ITEMS = [
  { name: "Labour – Remote support", type: "labour", unit: "hour" },
  { name: "Labour – On-site", type: "labour", unit: "hour" },
  { name: "Call-out fee", type: "service", unit: "each" },
  { name: "Managed workstation", type: "device_plan", unit: "device" },
  { name: "Managed server", type: "device_plan", unit: "device" },
  { name: "Microsoft 365 seat", type: "user_plan", unit: "user" },
  { name: "Backup per device", type: "device_plan", unit: "device" },
  { name: "Hardware", type: "product", unit: "each" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

function text(value, label, max, { required = false } = {}) {
  const cleaned = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (required && !cleaned) throw new BillingInputError(`Enter ${label}.`);
  if (cleaned.length > max) throw new BillingInputError(`${label[0].toUpperCase()}${label.slice(1)} is too long (${max} characters at most).`);
  return cleaned;
}

function whole(value, label, min, max) {
  const number = Number(value);
  if (value === "" || value == null || !Number.isInteger(number) || number < min || number > max) {
    throw new BillingInputError(`${label[0].toUpperCase()}${label.slice(1)} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function oneOf(value, list, label) {
  if (!list.includes(value)) throw new BillingInputError(`Choose ${label}.`);
  return value;
}

const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp" };
export const LOGO_MAX_BYTES = 512 * 1024;

// Logos arrive as a data URL. SVGs are only ever shown through <img>, where scripts never run.
export function parseLogo(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([a-z/+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !LOGO_TYPES[match[1]]) throw new BillingInputError("Upload a PNG, JPG, WebP or SVG logo.");
  const data = Buffer.from(match[2], "base64");
  if (!data.length) throw new BillingInputError("That logo file is empty.");
  if (data.length > LOGO_MAX_BYTES) throw new BillingInputError("The logo must be 512 KB or smaller.");
  if (match[1] === "image/svg+xml" && !/<svg[\s>]/i.test(data.toString("utf8"))) throw new BillingInputError("That SVG file is not valid.");
  return { contentType: match[1], extension: LOGO_TYPES[match[1]], data };
}

export function validDate(value) {
  if (!DATE.test(String(value ?? ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function email(value, label) {
  const cleaned = text(value, label, 200);
  if (cleaned && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw new BillingInputError(`Enter a valid ${label}.`);
  return cleaned;
}

export function parseCompany(body) {
  return {
    legalName: text(body.legalName, "the registered name", 160, { required: true }),
    tradingName: text(body.tradingName, "the trading name", 160),
    companyRegNo: text(body.companyRegNo, "the registration number", 40),
    physicalAddress: text(body.physicalAddress, "the physical address", 400, { required: true }),
    postalAddress: text(body.postalAddress, "the postal address", 400),
    email: email(body.email, "billing email"),
    phone: text(body.phone, "the phone number", 40),
    website: text(body.website, "the website", 160),
    bbbeeLevel: text(body.bbbeeLevel, "the B-BBEE level", 40),
    csdNumber: text(body.csdNumber, "the CSD number", 40),
    defaultTermsDays: whole(body.defaultTermsDays ?? 30, "payment terms", 0, 365),
    defaultNotes: text(body.defaultNotes, "the default notes", 2000),
    defaultTermsText: text(body.defaultTermsText, "the default terms", 4000),
    priceMode: oneOf(body.priceMode || "excl", ["excl", "incl"], "how prices are entered"),
    defaultTemplate: oneOf(body.defaultTemplate || "modern", TEMPLATES, "a template"),
    primaryColour: COLOUR.test(body.primaryColour || "") ? body.primaryColour.toUpperCase() : "#6D28D9",
    secondaryColour: COLOUR.test(body.secondaryColour || "") ? body.secondaryColour.toUpperCase() : "#0891B2",
    linkExpiryDays: whole(body.linkExpiryDays ?? 90, "link expiry", 1, 3650),
    attachPdf: body.attachPdf !== false,
  };
}

export function parseBank(body) {
  const bank = {
    bankName: text(body.bankName, "the bank", 80),
    accountName: text(body.accountName, "the account holder", 160),
    accountNumber: text(body.accountNumber, "the account number", 30).replace(/\s+/g, " "),
    branchCode: text(body.branchCode, "the branch code", 20),
    accountType: text(body.accountType, "the account type", 40),
    swift: text(body.swift, "the BIC/SWIFT code", 20).toUpperCase(),
  };
  if (bank.accountNumber && !/^[0-9 ]{6,30}$/.test(bank.accountNumber)) throw new BillingInputError("The account number can only contain digits.");
  if (bank.swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bank.swift)) throw new BillingInputError("A BIC/SWIFT code is 8 or 11 letters and digits.");
  const any = Object.values(bank).some(Boolean);
  if (any && (!bank.bankName || !bank.accountName || !bank.accountNumber)) {
    throw new BillingInputError("Enter the bank, the account holder and the account number, or leave all the bank fields empty.");
  }
  return any ? bank : null;
}

export function parseVatRecord(body, today) {
  const vatRegistered = body.vatRegistered === true || body.vatRegistered === "yes";
  const vatNumber = vatRegistered ? normaliseVatNumber(body.vatNumber) : "";
  const error = vatSettingsError({ vatRegistered, vatNumber });
  if (error) throw new BillingInputError(error);
  const effectiveFrom = String(body.effectiveFrom || today);
  if (!validDate(effectiveFrom)) throw new BillingInputError("Enter the date this takes effect.");
  return { vatRegistered, vatNumber: vatRegistered ? vatNumber : null, effectiveFrom };
}

export function parseSequence(body, current) {
  const prefix = text(body.prefix, "the prefix", 12, { required: true });
  if (!/^[A-Za-z0-9/_-]+$/.test(prefix)) throw new BillingInputError("A prefix can only use letters, digits, - / and _.");
  const nextNumber = whole(body.nextNumber, "the next number", 1, 999999999);
  if (current && nextNumber < Number(current.next_number)) {
    throw new BillingInputError(`The next number can only move forward (it is ${current.next_number} now).`);
  }
  return {
    prefix,
    padding: whole(body.padding, "the number of digits", 1, 10),
    nextNumber,
    includeYear: body.includeYear === true,
    resetYearly: body.includeYear === true && body.resetYearly === true,
  };
}

export function formatDocumentNumber({ prefix, padding, includeYear }, number, year) {
  const digits = String(number).padStart(padding, "0");
  return includeYear ? `${prefix}${year}-${digits}` : `${prefix}${digits}`;
}

export function parseItem(body) {
  let unitPriceCents;
  try {
    unitPriceCents = toCents(body.unitPrice ?? "0");
  } catch {
    throw new BillingInputError("Enter the unit price in rand, for example 320 or 320,00.");
  }
  if (unitPriceCents < 0) throw new BillingInputError("A price cannot be negative.");
  let costCents = null;
  if (String(body.cost ?? "").trim()) {
    try {
      costCents = toCents(body.cost);
    } catch {
      throw new BillingInputError("Enter the cost in rand, or leave it empty.");
    }
    if (costCents < 0) throw new BillingInputError("A cost cannot be negative.");
  }
  return {
    name: text(body.name, "a name", 120, { required: true }),
    description: text(body.description, "the description", 1000),
    sku: text(body.sku, "the SKU", 40),
    type: oneOf(body.type || "service", ITEM_TYPES, "a type"),
    unit: oneOf(body.unit || "each", ITEM_UNITS, "a unit"),
    unitPriceCents,
    taxType: oneOf(body.taxType || "standard", TAX_TYPES, "a tax rate"),
    accountCode: text(body.accountCode, "the account code", 40),
    costCents,
    active: body.active !== false,
  };
}

export function parseCustomerBilling(body) {
  const vatStatus = oneOf(body.vatStatus || "unknown", VAT_STATUSES, "the customer's VAT status");
  const vatNumber = normaliseVatNumber(body.vatNumber);
  if (vatStatus === "registered" && !isValidVatNumber(vatNumber)) {
    throw new BillingInputError("A VAT-registered customer needs a valid VAT number (10 digits starting with 4).");
  }
  if (vatStatus !== "registered" && vatNumber && !isValidVatNumber(vatNumber)) {
    throw new BillingInputError("A VAT number is 10 digits starting with 4.");
  }
  const cc = String(body.billingCc ?? "").split(/[,;\s]+/).filter(Boolean);
  for (const address of cc) email(address, "CC address");
  const terms = String(body.paymentTermsDays ?? "").trim();
  return {
    vatStatus,
    vatNumber: vatNumber || null,
    registeredName: text(body.registeredName, "the registered name", 160),
    billingContact: text(body.billingContact, "the billing contact", 120),
    billingEmail: email(body.billingEmail, "billing email"),
    billingCc: cc.join(", ").slice(0, 500),
    billingAddress: text(body.billingAddress, "the billing address", 400),
    paymentTermsDays: terms ? whole(terms, "payment terms", 0, 365) : null,
    billingTemplate: body.billingTemplate ? oneOf(body.billingTemplate, TEMPLATES, "a template") : null,
    billingReminders: body.billingReminders !== false,
  };
}
