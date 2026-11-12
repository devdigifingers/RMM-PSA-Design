import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedTreatments,
  creditNoteChecks,
  documentTitle,
  invoiceTier,
  isValidVatNumber,
  issueChecks,
  standardRateOn,
  vatRegisteredOn,
  vatSettingsError,
} from "../src/billing/sars.js";

const codes = (list) => list.map((item) => item.code);

describe("VAT numbers", () => {
  it("accepts 10 digits starting with 4, with spaces", () => {
    assert.equal(isValidVatNumber("4123456789"), true);
    assert.equal(isValidVatNumber("4123 456 789"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isValidVatNumber("5123456789"), false);
    assert.equal(isValidVatNumber("412345678"), false);
    assert.equal(isValidVatNumber("41234567890"), false);
    assert.equal(isValidVatNumber(""), false);
    assert.equal(isValidVatNumber(null), false);
  });
});

describe("rates and registration", () => {
  it("uses 15% from 1 April 2018 and 14% before", () => {
    assert.equal(standardRateOn("2026-11-01"), 1500);
    assert.equal(standardRateOn("2018-04-01"), 1500);
    assert.equal(standardRateOn("2018-03-31"), 1400);
    assert.throws(() => standardRateOn("1990-01-01"), RangeError);
  });

  it("follows the VAT registration in force on the issue date", () => {
    const history = [{ registered: true, effectiveFrom: "2026-12-01" }];
    assert.equal(vatRegisteredOn(history, "2026-11-30"), false);
    assert.equal(vatRegisteredOn(history, "2026-12-01"), true);
    const off = [...history, { registered: false, effectiveFrom: "2027-03-01" }];
    assert.equal(vatRegisteredOn(off, "2027-02-28"), true);
    assert.equal(vatRegisteredOn(off, "2027-03-01"), false);
    assert.equal(vatRegisteredOn([], "2026-11-01"), false);
  });

  it("requires the VAT flag and the VAT number to agree", () => {
    assert.equal(vatSettingsError({ vatRegistered: true, vatNumber: "4123456789" }), null);
    assert.equal(vatSettingsError({ vatRegistered: false, vatNumber: "" }), null);
    assert.match(vatSettingsError({ vatRegistered: true, vatNumber: "" }), /Enter your VAT number/);
    assert.match(vatSettingsError({ vatRegistered: true, vatNumber: "5123456789" }), /10 digits/);
    assert.match(vatSettingsError({ vatRegistered: false, vatNumber: "4123456789" }), /Remove the VAT number/);
  });

  it("only allows No VAT for a vendor that is not registered", () => {
    assert.deepEqual(allowedTreatments(false), ["no_vat"]);
    assert.equal(allowedTreatments(true).includes("no_vat"), false);
    assert.equal(allowedTreatments(true).includes("standard"), true);
  });
});

describe("titles and tiers", () => {
  it("titles invoices by VAT registration", () => {
    assert.equal(documentTitle("invoice", true), "Tax Invoice");
    assert.equal(documentTitle("invoice", false), "Invoice");
    assert.equal(documentTitle("quote", true), "Quote");
    assert.equal(documentTitle("credit_note", false), "Credit Note");
    assert.equal(documentTitle("credit_note", true), "Credit Note");
    assert.equal(documentTitle("statement", true), "Statement");
    assert.throws(() => documentTitle("receipt", true), RangeError);
  });

  it("needs a full tax invoice only over R 5 000", () => {
    assert.equal(invoiceTier(500001), "full");
    assert.equal(invoiceTier(500000), "abridged");
    assert.equal(invoiceTier(5001), "abridged");
    assert.equal(invoiceTier(5000), "none");
  });
});

describe("issueChecks", () => {
  const lines = [{ description: "Managed IT services", treatment: "standard" }];

  it("blocks a big invoice to a customer with no address", () => {
    const result = issueChecks({ vatRegistered: true, totalCents: 600000, customer: { vatStatus: "not_registered" }, lines });
    assert.deepEqual(codes(result.blocks), ["customer_address"]);
    assert.deepEqual(codes(issueChecks({ vatRegistered: true, totalCents: 400000, customer: { vatStatus: "not_registered" }, lines }).blocks), []);
  });

  it("blocks a VAT-vendor customer without a valid VAT number", () => {
    const result = issueChecks({ vatRegistered: true, totalCents: 1000, customer: { vatStatus: "registered", vatNumber: "123" }, lines });
    assert.deepEqual(codes(result.blocks), ["customer_vat_number"]);
  });

  it("warns when the customer's VAT status is unknown on a full tax invoice", () => {
    const result = issueChecks({ vatRegistered: true, totalCents: 600000, customer: { address: "1 Main Rd" }, lines });
    assert.deepEqual(codes(result.warnings), ["customer_vat_unknown"]);
    assert.deepEqual(codes(issueChecks({ vatRegistered: false, totalCents: 600000, customer: { address: "1 Main Rd" }, lines: [{ description: "Repairs", treatment: "no_vat" }] }).warnings), []);
  });

  it("blocks VAT lines for a vendor that is not registered", () => {
    const result = issueChecks({ vatRegistered: false, totalCents: 1000, lines });
    assert.deepEqual(codes(result.blocks), ["vat_not_registered"]);
  });

  it("warns about empty or vague descriptions, but not on headings", () => {
    const vague = issueChecks({ vatRegistered: false, totalCents: 1000, lines: [{ description: "Services", treatment: "no_vat" }] });
    assert.deepEqual(codes(vague.warnings), ["vague_description"]);
    const heading = issueChecks({ vatRegistered: false, totalCents: 1000, lines: [{ kind: "heading", description: "" }, { description: "Laptop repair", treatment: "no_vat" }] });
    assert.deepEqual(codes(heading.warnings), []);
  });
});

describe("creditNoteChecks", () => {
  it("needs a reason, and the invoice when VAT is reduced", () => {
    assert.deepEqual(codes(creditNoteChecks({ reason: "", reducesVat: false }).blocks), ["reason"]);
    assert.deepEqual(codes(creditNoteChecks({ reason: "Returned", reducesVat: true }).blocks), ["original_invoice"]);
    assert.deepEqual(codes(creditNoteChecks({ reason: "Returned", reducesVat: true, originalInvoice: { id: 1 } }).blocks), []);
  });
});
