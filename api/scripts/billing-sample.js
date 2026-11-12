// Renders the mockup sample documents through the live renderer, for checking against design/invoicing/.
// Usage: node scripts/billing-sample.js <outdir> [--pdf]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeLines } from "../src/billing/calc.js";
import { htmlToPdf } from "../src/billing/pdf.js";
import { qrSvg, renderDocument } from "../src/billing/render.js";

const out = process.argv[2] || "/tmp/df-billing-sample";
const wantPdf = process.argv.includes("--pdf");
mkdirSync(out, { recursive: true });

const ce = {
  legalName: "Compu-Extravaganza Technology cc", tradingName: "Compu-Extravaganza", regNo: "2021/969058/07", vatNumber: null,
  physicalAddress: "12 Coetzenburg Street, Westridge\nMitchell’s Plain, 7798", email: "billing@compu-e.co.za", phone: "021 000 0000", website: "compu-e.co.za",
  bank: { bankName: "Capitec Business Account", accountName: "Compu-Extravaganza Technology cc", accountNumber: "1055 8065 04", swift: "CABLZAJJ" },
  logo: null, primaryColour: "#6D28D9", secondaryColour: "#0891B2",
};
const umoya = {
  legalName: "Umoya Networks (Pty) Ltd", tradingName: "Umoya Networks", regNo: "2019/654321/07", vatNumber: "4870012345",
  physicalAddress: "5 Sample Lane, Morningside\nDurban, 4001", email: "billing@umoya.example", phone: "031 000 0000", website: "umoya.example",
  bank: { bankName: "Sample Bank (demo)", accountName: "Umoya Networks (Pty) Ltd", accountNumber: "0000 9876 5432", branchCode: "000 000", accountType: "Business current" },
  logo: null, primaryColour: "#0F766E", secondaryColour: "#65A30D",
};
const krl = { name: "Karoo Ridge Logistics (Pty) Ltd", contact: "Thandi Mokoena, Finance Manager", address: "18 Voortrekker Road\nParow Industria, Cape Town, 7493", vatNumber: "4560281937" };
const LINES = [
  ["Managed IT services — Essentials\nPer managed workstation / laptop · 1–30 Nov 2026", 14000, 32000],
  ["Managed server — Windows Server 2022\nKRL-FS01 · monitoring, patching, backup checks · 1–30 Nov 2026", 1000, 115000],
  ["Microsoft 365 Business Standard\nMonthly licence per user · 1–30 Nov 2026", 12000, 24500],
  ["Additional support hours\n1,5 h beyond 10 included hours · usage 1–31 Oct 2026", 1500, 65000],
  ["After-hours call-out\n17 Oct 2026 · firewall failover, Parow Industria site", 1000, 56000],
  ["Logitech MK295 Silent keyboard & mouse combo\nNew · supplied and installed at reception", 1000, 89500],
];
const lines = (rows, vat) => rows.map(([description, quantity, unitPriceCents]) => ({ lineType: "item", description, quantity, unit: "", unitPriceCents, discountBp: 0, taxType: vat ? "standard" : "no_vat" }));

async function view(supplier, vatRegistered, template, { lines: rawLines, ...extra } = {}) {
  const computed = computeLines(rawLines || lines(LINES, vatRegistered), { date: "2026-11-02", priceMode: "excl", vatRegistered });
  const link = "https://rmm.digitalfingers.co.za/pay/k3VxQ9mTzL8wq2Rb7NcYpA";
  return {
    kind: "invoice", number: "INV-000123", status: "issued", issueDate: "2026-11-02", dueDate: "2026-11-30", termsDays: 28, poNumber: "PO-KRL-26-0412",
    reference: "Managed IT services — November 2026", template, priceMode: "excl", vatRegistered, supplier, recipient: krl,
    notes: "Thank you for choosing managed IT services. Questions about this invoice? Use “Query this invoice” on the online copy or reply to the email.",
    termsText: "Payment due within 28 days of invoice date. Services are supplied under your Managed IT Services agreement; E&OE.",
    lines: computed.lines, totals: computed.totals, payments: [], credits: [], balanceCents: computed.totals.total,
    link, qrSvg: await qrSvg(link), ...extra,
  };
}

const jobs = [];
for (const template of ["modern", "classic", "minimal"]) {
  jobs.push([`${template}-ce`, await view(ce, false, template), {}]);
  jobs.push([`${template}-umoya`, await view(umoya, true, template), {}]);
}
const many = [];
for (let i = 0; i < 34; i += 1) many.push([`Project line ${i + 1} — network equipment and installation work\nDetail for line ${i + 1}`, 1000 + (i % 3) * 1000, 45000 + i * 1000]);
jobs.push(["modern-long", await view(ce, false, "modern", { lines: lines(many, false) }), {}]);
jobs.push(["classic-long", await view(umoya, true, "classic", { lines: lines(many, true) }), {}]);
const paid = await view(ce, false, "modern");
paid.payments = [{ date: "2026-11-14", amountCents: paid.totals.total, method: "eft" }];
paid.balanceCents = 0;
jobs.push(["modern-paid-copy", paid, { stamp: "paid", pill: { status: "paid", text: "Paid · 14 Nov 2026" }, copy: true }]);
const cnLines = lines([["Microsoft 365 Business Standard — 1 seat\nUser left on 31 Oct 2026 · licence removed · Nov 2026", 1000, 24500], ["After-hours call-out — goodwill credit (50%)\n17 Oct 2026 · ISP fault, not a customer-side issue", 1000, 28000]], false);
const cn = await view(ce, false, "modern", { kind: "credit_note", number: "CN-000014", issueDate: "2026-11-09", lines: undefined });
const cnComputed = computeLines(cnLines, { date: "2026-11-09", vatRegistered: false });
Object.assign(cn, { lines: cnComputed.lines, totals: cnComputed.totals, notes: "", termsText: "Issued against INV-000123 dated 2 Nov 2026. Amounts are shown as positive credits.",
  credit: { reason: "One Microsoft 365 seat was billed after the user left on 31 Oct 2026, and the 17 Oct call-out was caused by an ISP fault, so half of it is credited as goodwill.", originalNumber: "INV-000123", originalDate: "2026-11-02", originalTotal: 1100000, newBalance: 1047500 } });
jobs.push(["modern-credit-note", cn, {}]);

for (const [name, data, options] of jobs) {
  const html = renderDocument(data, { mode: "preview", ...options });
  writeFileSync(path.join(out, `${name}.html`), html);
  if (wantPdf) writeFileSync(path.join(out, `${name}.pdf`), await htmlToPdf(renderDocument(data, { mode: "pdf", ...options })));
}
console.log(`wrote ${jobs.length} documents to ${out}`);
