// Runs against a throwaway Postgres with schema.sql applied. Skipped unless BILLING_TEST_DB=1 (PG* variables point at that database).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const enabled = process.env.BILLING_TEST_DB === "1";
const h = { sealSecret: (text) => Buffer.from(text).toString("base64"), openSecret: (text) => Buffer.from(text, "base64").toString("utf8") };
const license = (limits = {}) => ({ entitlements: { features: ["invoicing"], limits } });

describe("billing documents (database)", { skip: !enabled }, () => {
  let pool, docs, ensureSetup, todayInZa;
  let plain, vat, actor, vatActor, customer, vatCustomer;

  before(async () => {
    ({ pool } = await import("../src/db.js"));
    docs = await import("../src/billing/documents.js");
    ({ ensureSetup } = await import("../src/billing/routes.js"));
    ({ todayInZa } = await import("../src/billing/common.js"));
    const suffix = Date.now();
    const org = async (name) => Number((await pool.query("INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id", [name, `${name}-${suffix}`.toLowerCase().replace(/\W+/g, "-")])).rows[0].id);
    const user = async (orgId, email) => ({ id: Number((await pool.query("INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, $2, 'Tester', 'x') RETURNING id", [orgId, `${email}-${suffix}@example.test`])).rows[0].id) });
    plain = await org("Compu Test");
    vat = await org("Umoya Test");
    actor = await user(plain, "plain");
    vatActor = await user(vat, "vat");
    await ensureSetup(pool, plain);
    await ensureSetup(pool, vat);
    await pool.query("UPDATE billing_settings SET physical_address = '1 Test Road\nCape Town' WHERE org_id IN ($1, $2)", [plain, vat]);
    await pool.query("INSERT INTO billing_vat_registrations (org_id, vat_registered, vat_number, effective_from) VALUES ($1, true, '4870012345', '2020-01-01')", [vat]);
    customer = Number((await pool.query("INSERT INTO customers (org_id, name, address) VALUES ($1, 'Karoo Ridge', '18 Voortrekker Road') RETURNING id", [plain])).rows[0].id);
    vatCustomer = Number((await pool.query("INSERT INTO customers (org_id, name, address, vat_status) VALUES ($1, 'Ridgeview Dental', '44 Sample Avenue', 'unknown') RETURNING id", [vat])).rows[0].id);
  });

  after(async () => {
    await pool?.end();
  });

  const line = (description, quantity, unitPrice, taxType = "standard") => ({ description, quantity, unitPrice, taxType });

  it("issues a non-VAT invoice with no VAT, even when a line asks for it", async () => {
    const id = await docs.saveDraft(plain, actor.id, null, { kind: "invoice", customerId: customer, lines: [line("Managed IT services", "14", "320,00", "standard")] });
    const issued = await docs.issueDocument(plain, actor, id, { license: license(), h });
    assert.equal(issued.number, "INV-000001");
    const row = (await pool.query("SELECT * FROM billing_documents WHERE id = $1", [id])).rows[0];
    assert.equal(Number(row.tax_cents), 0);
    assert.equal(Number(row.total_cents), 448000);
    assert.equal(row.supplier_snapshot.vatRegistered, false);
    const lines = (await pool.query("SELECT tax_type FROM billing_document_lines WHERE document_id = $1", [id])).rows;
    assert.deepEqual(lines.map((l) => l.tax_type), ["no_vat"]);
    const html = await docs.savedPreviewHtml(plain, id, h, "/fonts/");
    assert.match(html, /<h1>INVOICE<\/h1>/);
    assert.match(html, /Not registered for VAT/);
    assert.doesNotMatch(html, /<th class="r">VAT<\/th>/);
  });

  it("refuses to change an issued invoice", async () => {
    const row = (await pool.query("SELECT id FROM billing_documents WHERE org_id = $1 AND number = 'INV-000001'", [plain])).rows[0];
    await assert.rejects(pool.query("UPDATE billing_documents SET notes = 'changed' WHERE id = $1", [row.id]), /cannot be changed/);
    await assert.rejects(pool.query("UPDATE billing_document_lines SET description = 'x' WHERE document_id = $1", [row.id]), /cannot be changed/);
    await assert.rejects(docs.saveDraft(plain, actor.id, Number(row.id), { lines: [] }), /Only a draft can be edited/);
  });

  it("numbers 50 invoices issued at once without gaps or repeats", async () => {
    const ids = [];
    for (let i = 0; i < 50; i += 1) ids.push(await docs.saveDraft(plain, actor.id, null, { kind: "invoice", customerId: customer, lines: [line(`Line ${i}`, "1", "100")] }));
    const results = await Promise.all(ids.map((id) => docs.issueDocument(plain, actor, id, { license: license(), h })));
    const numbers = results.map((r) => Number(r.number.slice(4))).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: 50 }, (_, i) => i + 2));
  });

  it("blocks the 101st invoice of the month on Free, but drafts still save", async () => {
    const used = (await pool.query("SELECT count(*)::int AS n FROM billing_documents WHERE org_id = $1 AND kind = 'invoice' AND issued_at IS NOT NULL", [plain])).rows[0].n;
    const id = await docs.saveDraft(plain, actor.id, null, { kind: "invoice", customerId: customer, lines: [line("Over the limit", "1", "100")] });
    await assert.rejects(docs.issueDocument(plain, actor, id, { license: license({ invoicesPerMonth: used }), h }), (error) => error.status === 402);
    const issued = await docs.issueDocument(plain, actor, id, { license: license({ invoicesPerMonth: used + 1 }), h });
    assert.ok(issued.number);
  });

  it("charges VAT for a VAT vendor and checks the customer", async () => {
    const id = await docs.saveDraft(vat, vatActor.id, null, { kind: "invoice", customerId: vatCustomer, lines: [line("Network installation and configuration", "1", "10 000,00")] });
    const first = await docs.issueDocument(vat, vatActor, id, { license: license(), h });
    assert.deepEqual(first.warnings.map((w) => w.code), ["customer_vat_unknown"]);
    await pool.query("UPDATE customers SET vat_status = 'registered', vat_number = NULL WHERE id = $1", [vatCustomer]);
    const blocked = await docs.issueDocument(vat, vatActor, id, { license: license(), h });
    assert.deepEqual(blocked.blocked.map((b) => b.code), ["customer_vat_number"]);
    await pool.query("UPDATE customers SET vat_number = '4720395518' WHERE id = $1", [vatCustomer]);
    const issued = await docs.issueDocument(vat, vatActor, id, { license: license(), h });
    assert.equal(issued.number, "INV-000001");
    const row = (await pool.query("SELECT * FROM billing_documents WHERE id = $1", [id])).rows[0];
    assert.equal(Number(row.tax_cents), 150000);
    assert.equal(Number(row.total_cents), 1150000);
    assert.equal(row.recipient_snapshot.vatNumber, "4720395518");
    const html = await docs.savedPreviewHtml(vat, id, h, "/fonts/");
    assert.match(html, /TAX INVOICE/);
    assert.match(html, /VAT no\. 4870012345/);
  });

  it("records part and full payments, with any excess held as credit", async () => {
    const row = (await pool.query("SELECT id FROM billing_documents WHERE org_id = $1 AND number = 'INV-000001'", [vat])).rows[0];
    await docs.recordPayment(vat, vatActor, vatCustomer, { amount: "5 000,00", method: "eft", date: todayInZa() });
    let doc = (await pool.query("SELECT status, balance_cents FROM billing_documents WHERE id = $1", [row.id])).rows[0];
    assert.equal(doc.status, "partially_paid");
    assert.equal(Number(doc.balance_cents), 650000);
    const result = await docs.recordPayment(vat, vatActor, vatCustomer, { amount: "7 000,00", method: "eft" });
    assert.equal(result.creditCents, 50000);
    doc = (await pool.query("SELECT status, balance_cents FROM billing_documents WHERE id = $1", [row.id])).rows[0];
    assert.equal(doc.status, "paid");
    assert.equal(Number(doc.balance_cents), 0);
    const copy = docs.stampFor({ ...doc, kind: "invoice" }, todayInZa(), { copy: true });
    assert.equal(copy.stamp, "paid");
    assert.equal(docs.stampFor({ ...doc, kind: "invoice" }, todayInZa()).stamp, null);
  });

  it("credits an unpaid invoice in full and drafts a corrected copy", async () => {
    const id = await docs.saveDraft(vat, vatActor.id, null, { kind: "invoice", customerId: vatCustomer, lines: [line("Wrong item", "2", "500")] });
    await docs.issueDocument(vat, vatActor, id, { license: license(), h });
    const result = await docs.creditAndReissue(vat, vatActor, id, { reason: "Billed the wrong item", reissue: true, license: license(), h });
    assert.equal(result.creditNoteNumber, "CN-000001");
    const invoice = (await pool.query("SELECT status, balance_cents, credited_cents FROM billing_documents WHERE id = $1", [id])).rows[0];
    assert.equal(invoice.status, "credited");
    assert.equal(Number(invoice.balance_cents), 0);
    const cn = (await pool.query("SELECT status, tax_cents, credit_context FROM billing_documents WHERE id = $1", [result.creditNoteId])).rows[0];
    assert.equal(cn.status, "applied");
    assert.equal(Number(cn.tax_cents), 15000);
    assert.equal(cn.credit_context.newBalance, 0);
    const draft = (await pool.query("SELECT status, number FROM billing_documents WHERE id = $1", [result.draftId])).rows[0];
    assert.equal(draft.status, "draft");
    assert.equal(draft.number, null);
  });

  it("voids only an unsent, unpaid invoice", async () => {
    const id = await docs.saveDraft(plain, actor.id, null, { kind: "invoice", customerId: customer, lines: [line("Mistake", "1", "100")] });
    await docs.issueDocument(plain, actor, id, { license: license(), h });
    await assert.rejects(docs.voidDocument(plain, actor, id, ""), /reason/);
    await docs.voidDocument(plain, actor, id, "Duplicate");
    const row = (await pool.query("SELECT status, number FROM billing_documents WHERE id = $1", [id])).rows[0];
    assert.equal(row.status, "void");
    assert.ok(row.number);
  });

  it("sends, accepts and converts a quote", async () => {
    const id = await docs.saveDraft(plain, actor.id, null, { kind: "quote", customerId: customer, lines: [line("Firewall upgrade", "1", "8 950,00")] });
    const sent = await docs.issueDocument(plain, actor, id, { license: license(), h });
    assert.equal(sent.number, "QT-000001");
    await docs.quoteDecision(plain, id, "accepted", { actorId: actor.id });
    const { draftId } = await docs.convertQuote(plain, actor, id);
    const quote = (await pool.query("SELECT status FROM billing_documents WHERE id = $1", [id])).rows[0];
    const invoice = (await pool.query("SELECT kind, status, source_quote_id, total_cents FROM billing_documents WHERE id = $1", [draftId])).rows[0];
    assert.equal(quote.status, "converted");
    assert.equal(invoice.kind, "invoice");
    assert.equal(Number(invoice.source_quote_id), id);
    assert.equal(Number(invoice.total_cents), 895000);
  });

  it("serves the hosted page by token and expires revoked links", async () => {
    const row = (await pool.query("SELECT id FROM billing_documents WHERE org_id = $1 AND number = 'INV-000002'", [plain])).rows[0];
    const { url } = await docs.regenerateLink(plain, actor, Number(row.id), h);
    const token = url.split("/pay/")[1];
    const hh = { ...h, loadLicense: async () => license() };
    const view = await docs.hostedView(token, "pay", hh, "/fonts/");
    assert.equal(view.status, 200);
    assert.equal(view.body.number, "INV-000002");
    assert.equal((await docs.hostedView(token, "q", hh, "/fonts/")).status, 404);
    await docs.regenerateLink(plain, actor, Number(row.id), h);
    assert.equal((await docs.hostedView(token, "pay", hh, "/fonts/")).status, 410);
    const viewed = (await pool.query("SELECT view_count FROM billing_documents WHERE id = $1", [row.id])).rows[0];
    assert.equal(viewed.view_count, 1);
  });
});
