import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BillingInputError,
  DEFAULT_TAX_RATES,
  formatDocumentNumber,
  parseBank,
  parseCompany,
  parseCustomerBilling,
  parseItem,
  parseSequence,
  parseVatRecord,
  validDate,
} from "../src/billing/setup.js";

describe("company and tax", () => {
  it("needs a registered name and a physical address", () => {
    assert.throws(() => parseCompany({ physicalAddress: "1 Main Rd" }), BillingInputError);
    assert.throws(() => parseCompany({ legalName: "Acme" }), BillingInputError);
    const company = parseCompany({ legalName: "Acme cc", physicalAddress: "1 Main Rd" });
    assert.equal(company.priceMode, "excl");
    assert.equal(company.defaultTermsDays, 30);
    assert.equal(company.defaultTemplate, "modern");
  });

  it("makes the VAT flag and number agree on each dated record", () => {
    assert.deepEqual(parseVatRecord({ vatRegistered: "yes", vatNumber: "4123 456 789", effectiveFrom: "2026-12-01" }, "2026-11-09"),
      { vatRegistered: true, vatNumber: "4123456789", effectiveFrom: "2026-12-01" });
    assert.deepEqual(parseVatRecord({ vatRegistered: "no" }, "2026-11-09"), { vatRegistered: false, vatNumber: null, effectiveFrom: "2026-11-09" });
    assert.throws(() => parseVatRecord({ vatRegistered: "yes", vatNumber: "" }, "2026-11-09"), /Enter your VAT number/);
    assert.throws(() => parseVatRecord({ vatRegistered: "yes", vatNumber: "4123456789", effectiveFrom: "2026-02-30" }, "2026-11-09"), /date/);
  });

  it("keeps bank details all or nothing", () => {
    assert.equal(parseBank({}), null);
    assert.throws(() => parseBank({ bankName: "Capitec" }), /account holder/);
    const bank = parseBank({ bankName: "Capitec", accountName: "Compu-Extravaganza Technology cc", accountNumber: "1055 8065 04", swift: "cablzajj" });
    assert.equal(bank.swift, "CABLZAJJ");
    assert.throws(() => parseBank({ bankName: "X", accountName: "Y", accountNumber: "12AB34" }), /digits/);
  });
});

describe("numbering", () => {
  it("formats numbers with padding and an optional year", () => {
    assert.equal(formatDocumentNumber({ prefix: "INV-", padding: 6, includeYear: false }, 123, 2026), "INV-000123");
    assert.equal(formatDocumentNumber({ prefix: "INV-", padding: 4, includeYear: true }, 42, 2026), "INV-2026-0042");
  });

  it("only lets the next number move forward", () => {
    const current = { next_number: 124 };
    assert.throws(() => parseSequence({ prefix: "INV-", padding: 6, nextNumber: 100 }, current), /forward/);
    assert.equal(parseSequence({ prefix: "INV-", padding: 6, nextNumber: 500 }, current).nextNumber, 500);
    assert.throws(() => parseSequence({ prefix: "IN V", padding: 6, nextNumber: 500 }, current), /prefix/);
  });
});

describe("tax rates", () => {
  it("seeds standard rates with effective dates plus zero, exempt and no VAT", () => {
    const standard = DEFAULT_TAX_RATES.filter((rate) => rate.type === "standard");
    assert.deepEqual(standard.map((rate) => rate.rateBp), [1400, 1500]);
    assert.deepEqual(DEFAULT_TAX_RATES.map((rate) => rate.type).slice(2), ["zero_rated", "exempt", "no_vat"]);
  });
});

describe("items", () => {
  it("reads prices in rand", () => {
    const item = parseItem({ name: "Managed server", unitPrice: "1 150,00", unit: "device", type: "device_plan" });
    assert.equal(item.unitPriceCents, 115000);
    assert.equal(item.costCents, null);
    assert.throws(() => parseItem({ name: "X", unitPrice: "abc" }), /unit price/);
    assert.throws(() => parseItem({ name: "", unitPrice: "1" }), /name/);
  });
});

describe("customer billing fields", () => {
  it("needs a valid VAT number for a VAT-registered customer", () => {
    assert.throws(() => parseCustomerBilling({ vatStatus: "registered", vatNumber: "" }), /VAT number/);
    assert.equal(parseCustomerBilling({ vatStatus: "registered", vatNumber: "4987654321" }).vatNumber, "4987654321");
    assert.equal(parseCustomerBilling({}).vatStatus, "unknown");
  });

  it("cleans CC lists and checks each address", () => {
    assert.equal(parseCustomerBilling({ billingCc: "a@x.co.za; b@y.co.za" }).billingCc, "a@x.co.za, b@y.co.za");
    assert.throws(() => parseCustomerBilling({ billingCc: "nope" }), /CC address/);
  });
});

describe("dates", () => {
  it("accepts real calendar dates only", () => {
    assert.equal(validDate("2026-11-09"), true);
    assert.equal(validDate("2026-02-29"), false);
    assert.equal(validDate("09/11/2026"), false);
  });
});
