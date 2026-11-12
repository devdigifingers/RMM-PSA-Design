// Seeds an org with the Invoicing sample tenant from spec §4.4: settings, VAT record, bank details, a fictional customer,
// sample items and draft documents. Safe to run again: existing customers, items and VAT records are kept.
// Usage: node scripts/billing-seed.js --org <id> --profile ce|umoya [--drafts]
// Needs the API's database variables and MFA_KEY (bank details are sealed like the server does). Issues nothing and sends no email.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "../src/db.js";
import { tx } from "../src/billing/common.js";
import { saveDraft } from "../src/billing/documents.js";
import { ensureSetup } from "../src/billing/routes.js";

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
};
const orgId = Number(arg("org"));
const profileKey = arg("profile");
const withDrafts = process.argv.includes("--drafts");

function seal(text) {
  if (!process.env.MFA_KEY) throw new Error("MFA_KEY is not set.");
  const key = createHash("sha256").update(process.env.MFA_KEY).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":");
}

const SERVICE_LINES = [
  { name: "Managed IT services — Essentials", description: "Per managed workstation / laptop", type: "device_plan", unit: "device", price: 32000, quantity: "14" },
  { name: "Managed server — Windows Server 2022", description: "Monitoring, patching, backup checks", type: "device_plan", unit: "device", price: 115000, quantity: "1" },
  { name: "Microsoft 365 Business Standard", description: "Monthly licence per user", type: "user_plan", unit: "user", price: 24500, quantity: "12" },
  { name: "Additional support hours", description: "Beyond the included hours", type: "labour", unit: "hour", price: 65000, quantity: "1,5" },
  { name: "After-hours call-out", description: "Outside business hours", type: "service", unit: "each", price: 56000, quantity: "1" },
  { name: "Logitech MK295 Silent keyboard & mouse combo", description: "New · supplied and installed", type: "product", unit: "each", price: 89500, quantity: "1" },
];

const PROFILES = {
  // Compu-Extravaganza: owner-supplied legal, registration, address and bank; phone, email, website and branch code are spec placeholders.
  ce: {
    settings: {
      legal_name: "Compu-Extravaganza Technology cc", trading_name: "Compu-Extravaganza", company_reg_no: "2021/969058/07",
      physical_address: "12 Coetzenburg Street, Westridge\nMitchell's Plain, 7798", email: "billing@compu-e.co.za", phone: "021 000 0000", website: "compu-e.co.za",
      primary_colour: "#6D28D9", secondary_colour: "#0891B2", default_terms_days: 28, default_template: "modern",
      default_notes: "Thank you for your business. Questions about this invoice? Reply to the email.",
      default_terms_text: "Payment due within 28 days of invoice date. E&OE.",
    },
    bank: { bankName: "Capitec Business Account", accountName: "Compu-Extravaganza Technology cc", accountNumber: "1055 8065 04", branchCode: "450105", accountType: "Business", swift: "CABLZAJJ" },
    vat: null,
    customer: {
      name: "Karoo Ridge Logistics (Pty) Ltd", contact: "Thandi Mokoena, Finance Manager", email: "finance@karoo-ridge.example",
      address: "18 Voortrekker Road\nParow Industria, Cape Town, 7493", vatStatus: "registered", vatNumber: "4560281937", terms: 28,
    },
  },
  // Umoya Networks: fictional VAT vendor for TAX INVOICE tests and the re-colour proof.
  umoya: {
    settings: {
      legal_name: "Umoya Networks (Pty) Ltd", trading_name: "Umoya Networks", company_reg_no: "2019/654321/07",
      physical_address: "5 Sample Lane, Morningside\nDurban, 4001", email: "billing@umoya.example", phone: "031 000 0000", website: "umoya.example",
      primary_colour: "#0F766E", secondary_colour: "#65A30D", default_terms_days: 30, default_template: "modern",
      default_notes: "Thank you for your business.",
      default_terms_text: "Payment due within 30 days of invoice date. E&OE.",
    },
    bank: { bankName: "Sample Bank (demo)", accountName: "Umoya Networks (Pty) Ltd", accountNumber: "0000 9876 5432", branchCode: "000 000", accountType: "Business current", swift: "" },
    vat: { number: "4870012345", from: "2020-03-01" },
    customer: {
      name: "Ridgeview Dental Studio", contact: "Dr Naledi Khumalo", email: "accounts@ridgeview-dental.example",
      address: "22 Ridge Road\nBerea, Durban, 4001", vatStatus: "not_registered", vatNumber: null, terms: 30,
    },
  },
};

async function main() {
  const profile = PROFILES[profileKey];
  if (!Number.isSafeInteger(orgId) || orgId <= 0 || !profile) {
    console.error("Usage: node scripts/billing-seed.js --org <id> --profile ce|umoya [--drafts]");
    process.exit(2);
  }
  const org = (await pool.query("SELECT id, name FROM orgs WHERE id = $1", [orgId])).rows[0];
  if (!org) throw new Error(`Org ${orgId} not found.`);
  await ensureSetup(pool, orgId);

  const customerId = await tx(async (client) => {
    const s = profile.settings;
    await client.query(
      `UPDATE billing_settings SET legal_name = $2, trading_name = $3, company_reg_no = $4, physical_address = $5, email = $6, phone = $7, website = $8,
         primary_colour = $9, secondary_colour = $10, default_terms_days = $11, default_template = $12, default_notes = $13, default_terms_text = $14,
         bank_details_enc = $15, updated_at = now()
       WHERE org_id = $1`,
      [orgId, s.legal_name, s.trading_name, s.company_reg_no, s.physical_address, s.email, s.phone, s.website, s.primary_colour, s.secondary_colour,
        s.default_terms_days, s.default_template, s.default_notes, s.default_terms_text, seal(JSON.stringify(profile.bank))],
    );
    if (profile.vat) {
      await client.query(
        `INSERT INTO billing_vat_registrations (org_id, vat_registered, vat_number, effective_from) VALUES ($1, true, $2, $3)
         ON CONFLICT (org_id, effective_from) DO NOTHING`,
        [orgId, profile.vat.number, profile.vat.from],
      );
    }
    for (const item of SERVICE_LINES) {
      const exists = await client.query("SELECT 1 FROM billing_items WHERE org_id = $1 AND lower(name) = lower($2)", [orgId, item.name]);
      if (exists.rows[0]) continue;
      await client.query(
        "INSERT INTO billing_items (org_id, name, description, type, unit, unit_price_cents, tax_type) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [orgId, item.name, item.description, item.type, item.unit, item.price, profile.vat ? "standard" : "no_vat"],
      );
    }
    const c = profile.customer;
    const found = await client.query("SELECT id FROM customers WHERE org_id = $1 AND lower(name) = lower($2)", [orgId, c.name]);
    if (found.rows[0]) return Number(found.rows[0].id);
    const made = await client.query(
      `INSERT INTO customers (org_id, name, email, address, vat_status, vat_number, billing_contact, billing_email, billing_address, payment_terms_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $3, $4, $8) RETURNING id`,
      [orgId, c.name, c.email, c.address, c.vatStatus, c.vatNumber, c.contact, c.terms],
    );
    const id = Number(made.rows[0].id);
    await client.query("INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Primary')", [orgId, id]);
    return id;
  });

  let drafts = 0;
  if (withDrafts) {
    const lines = SERVICE_LINES.map((item) => ({ lineType: "item", description: `${item.name}\n${item.description}`, quantity: item.quantity, unitPrice: { cents: item.price }, taxType: "standard" }));
    const common = { customerId, reference: "Managed IT services — November 2026", poNumber: "PO-26-0412", lines };
    await saveDraft(orgId, null, null, { kind: "invoice", ...common });
    await saveDraft(orgId, null, null, { kind: "quote", ...common, reference: "Managed IT services — proposal" });
    drafts = 2;
  }
  console.log(`Seeded org ${orgId} (${org.name}) as ${profileKey}: settings, bank details${profile.vat ? ", VAT registration" : ""}, ${SERVICE_LINES.length} items, customer ${customerId}${drafts ? `, ${drafts} drafts` : ""}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
