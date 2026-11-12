import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentTotals, formatQuantity, formatRand, lineAmounts, spreadDiscount, toCents, toQuantity } from "../src/billing/money.js";

describe("parsing", () => {
  it("reads rand amounts with a comma or a point, spaces and the R sign", () => {
    assert.equal(toCents("1 234,56"), 123456);
    assert.equal(toCents("R\u00a012\u00a0650,00"), 1265000);
    assert.equal(toCents("320"), 32000);
    assert.equal(toCents("0.5"), 50);
    assert.equal(toCents("-12,30"), -1230);
  });

  it("rejects more than two decimals and junk", () => {
    assert.throws(() => toCents("1,234"), RangeError);
    assert.throws(() => toCents("abc"), RangeError);
    assert.throws(() => toCents(""), RangeError);
  });

  it("reads quantities to three decimals", () => {
    assert.equal(toQuantity("1,5"), 1500);
    assert.equal(toQuantity("14"), 14000);
    assert.equal(toQuantity("0.125"), 125);
    assert.throws(() => toQuantity("0.1255"), RangeError);
  });
});

describe("lineAmounts", () => {
  it("calculates VAT per line in cents, rounding half up", () => {
    assert.deepEqual(lineAmounts({ quantity: 1000, unitCents: 115000, rateBp: 1500 }), { gross: 115000, discount: 0, net: 115000, vat: 17250, total: 132250 });
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 1, rateBp: 1500 }).vat, 0);
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 10, rateBp: 1500 }).vat, 2);
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 3, rateBp: 1500 }).vat, 0);
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 330, rateBp: 1500 }).vat, 50);
  });

  it("rounds a credit note the same way as the invoice, mirrored", () => {
    const invoice = lineAmounts({ quantity: 1000, unitCents: 330, rateBp: 1500 });
    const credit = lineAmounts({ quantity: -1000, unitCents: 330, rateBp: 1500 });
    assert.equal(credit.vat, -invoice.vat);
    assert.equal(credit.total, -invoice.total);
  });

  it("handles fractional quantities", () => {
    assert.equal(lineAmounts({ quantity: 1500, unitCents: 65000, rateBp: 0 }).net, 97500);
    assert.equal(lineAmounts({ quantity: 333, unitCents: 100, rateBp: 0 }).net, 33);
    assert.equal(lineAmounts({ quantity: 335, unitCents: 10, rateBp: 0 }).net, 3);
  });

  it("backs VAT out of VAT-inclusive prices", () => {
    const line = lineAmounts({ quantity: 1000, unitCents: 115000, rateBp: 1500, inclusive: true });
    assert.deepEqual(line, { gross: 115000, discount: 0, net: 100000, vat: 15000, total: 115000 });
  });

  it("applies percentage and amount discounts before VAT, never below zero", () => {
    assert.deepEqual(lineAmounts({ quantity: 2000, unitCents: 10000, rateBp: 1500, discountBp: 1000 }), { gross: 20000, discount: 2000, net: 18000, vat: 2700, total: 20700 });
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 10000, discountCents: 50000 }).net, 0);
  });

  it("charges no VAT at a zero rate", () => {
    assert.equal(lineAmounts({ quantity: 1000, unitCents: 99999 }).vat, 0);
  });

  it("rejects non-integer inputs", () => {
    assert.throws(() => lineAmounts({ quantity: 1.5, unitCents: 100 }), RangeError);
    assert.throws(() => lineAmounts({ quantity: 1000, unitCents: 100, rateBp: -1 }), RangeError);
  });
});

describe("documentTotals", () => {
  it("adds up the mockup invoice to R 12 650,00", () => {
    const rows = [[14000, 32000], [1000, 115000], [12000, 24500], [1500, 65000], [1000, 56000], [1000, 89500]];
    const lines = rows.map(([quantity, unitCents]) => ({ ...lineAmounts({ quantity, unitCents, rateBp: 1500 }), rateBp: 1500 }));
    const totals = documentTotals(lines);
    assert.equal(totals.subtotal, 1100000);
    assert.equal(totals.vat, 165000);
    assert.equal(totals.total, 1265000);
    assert.deepEqual(totals.vatByRate, [{ rateKey: "1500", rateBp: 1500, net: 1100000, vat: 165000 }]);
  });

  it("groups VAT by rate", () => {
    const totals = documentTotals([
      { ...lineAmounts({ quantity: 1000, unitCents: 10000, rateBp: 1500 }), rateKey: "standard", rateBp: 1500 },
      { ...lineAmounts({ quantity: 1000, unitCents: 5000 }), rateKey: "zero_rated", rateBp: 0 },
    ]);
    assert.equal(totals.vatByRate.length, 2);
    assert.equal(totals.total, 16500);
  });
});

describe("spreadDiscount", () => {
  it("spreads a document discount in proportion and adds up exactly", () => {
    const shares = spreadDiscount([10000, 20000, 30001], 1000);
    assert.equal(shares.reduce((a, b) => a + b, 0), 1000);
    assert.deepEqual(shares, [167, 333, 500]);
  });

  it("never discounts more than the lines are worth", () => {
    assert.deepEqual(spreadDiscount([100, 200], 1000), [100, 200]);
    assert.deepEqual(spreadDiscount([100, 200], 0), [0, 0]);
  });
});

describe("formatting", () => {
  it("uses non-breaking spaces after R and between thousands", () => {
    assert.equal(formatRand(1265000), "R\u00a012\u00a0650,00");
    assert.equal(formatRand(5), "R\u00a00,05");
    assert.equal(formatRand(-123456789), "-R\u00a01\u00a0234\u00a0567,89");
    assert.equal(formatRand(100000, { symbol: false }), "1\u00a0000,00");
  });

  it("formats quantities with a decimal comma and no trailing zeros", () => {
    assert.equal(formatQuantity(1500), "1,5");
    assert.equal(formatQuantity(14000), "14");
    assert.equal(formatQuantity(125), "0,125");
  });
});
