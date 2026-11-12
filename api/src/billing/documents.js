import { createHash, randomBytes } from "node:crypto";
import { insertAudit } from "../audit.js";
import { pool } from "../db.js";
import { hasFeature } from "../licensing.js";
import { addressSafe, sendMail } from "../mail.js";
import { addDays, computeLines, daysBetween, isOverdue, parseDraftHeader, parseLines } from "./calc.js";
import { dateText, monthlyUsage, todayInZa, tx, vatHistory, vatOn } from "./common.js";
import { documentTotals, formatRand, toCents } from "./money.js";
import { htmlToPdf, sha256 } from "./pdf.js";
import { esc, longDate, qrSvg, renderDocument, tokensFor } from "./render.js";
import { creditNoteChecks, documentTitle, issueChecks } from "./sars.js";
import { BillingInputError, formatDocumentNumber } from "./setup.js";

export const PUBLIC_BASE = (process.env.BILLING_PUBLIC_URL || "https://rmm.digitalfingers.co.za").replace(/\/$/, "");
const KINDS = ["quote", "invoice", "credit_note"];
const OPEN_INVOICE = ["issued", "partially_paid"];
const METHODS = ["eft", "cash", "card", "other"];
const KIND_WORD = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" };

export const STATUS_LABELS = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired", converted: "Invoiced",
  pending_approval: "Waiting for approval", issued: "Awaiting payment", partially_paid: "Partly paid", paid: "Paid",
  credited: "Credited", void: "Void", written_off: "Written off", applied: "Applied", refunded: "Refunded",
};

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const linkPath = (kind) => (kind === "quote" ? "q" : "pay");

// ---------------------------------------------------------------- row views
function lineFromRow(row) {
  return {
    id: Number(row.id),
    lineType: row.line_type,
    itemId: row.item_id == null ? null : Number(row.item_id),
    description: row.description,
    quantity: Number(row.quantity_milli),
    unit: row.unit,
    unitPriceCents: Number(row.unit_price_cents),
    discountBp: row.discount_bp,
    taxType: row.tax_type,
    rateBp: row.rate_bp,
    net: Number(row.net_cents),
    tax: Number(row.tax_cents),
    total: Number(row.total_cents),
  };
}

function displayStatus(doc, today) {
  if (doc.kind === "invoice" && isOverdue(doc, today)) return "Overdue";
  if (doc.kind === "quote" && doc.status === "sent" && doc.validUntil && doc.validUntil < today) return "Expired";
  if (doc.kind === "credit_note" && doc.status === "issued") return "Open credit";
  return STATUS_LABELS[doc.status] || doc.status;
}

export function docSummary(row, today = todayInZa()) {
  const doc = {
    id: Number(row.id),
    kind: row.kind,
    number: row.number,
    status: row.status,
    customerId: Number(row.customer_id),
    customerName: row.recipient_snapshot?.name || row.customer_name || "",
    issueDate: dateText(row.issue_date),
    dueDate: dateText(row.due_date),
    validUntil: dateText(row.valid_until),
    subtotalCents: Number(row.subtotal_cents),
    taxCents: Number(row.tax_cents),
    totalCents: Number(row.total_cents),
    paidCents: Number(row.paid_cents),
    creditedCents: Number(row.credited_cents),
    balanceCents: Number(row.balance_cents),
    reference: row.reference,
    poNumber: row.po_number,
    template: row.template,
    sentAt: row.sent_at,
    issuedAt: row.issued_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
    sourceQuoteId: row.source_quote_id == null ? null : Number(row.source_quote_id),
    creditsDocumentId: row.credits_document_id == null ? null : Number(row.credits_document_id),
  };
  doc.overdue = isOverdue(doc, today);
  doc.statusLabel = displayStatus(doc, today);
  return doc;
}

// ---------------------------------------------------------------- snapshots
async function settingsRow(db, orgId) {
  return (await db.query("SELECT * FROM billing_settings WHERE org_id = $1", [orgId])).rows[0];
}

function supplierSnapshot(settings, bank, vat) {
  return {
    legalName: settings.legal_name,
    tradingName: settings.trading_name,
    regNo: settings.company_reg_no,
    vatRegistered: vat.registered,
    vatNumber: vat.registered ? vat.vatNumber : null,
    physicalAddress: settings.physical_address,
    postalAddress: settings.postal_address,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    bbbeeLevel: settings.bbbee_level,
    csdNumber: settings.csd_number,
    bank,
    logoFileId: settings.logo_file_id == null ? null : Number(settings.logo_file_id),
    primaryColour: settings.primary_colour,
    secondaryColour: settings.secondary_colour,
  };
}

function recipientSnapshot(customer) {
  return {
    name: customer.registered_name || customer.name,
    contact: customer.billing_contact || customer.contact_name || "",
    address: customer.billing_address || customer.address || "",
    email: customer.billing_email || customer.email || customer.contact_email || "",
    cc: customer.billing_cc || "",
    vatStatus: customer.vat_status,
    vatNumber: customer.vat_status === "registered" ? customer.vat_number || "" : "",
  };
}

function bankFrom(settings, h) {
  return settings.bank_details_enc ? JSON.parse(h.openSecret(settings.bank_details_enc)) : null;
}

async function logoDataUrl(db, orgId, fileId) {
  if (!fileId) return null;
  const file = (await db.query("SELECT content_type, data FROM billing_files WHERE id = $1 AND org_id = $2 AND purpose = 'logo'", [fileId, orgId])).rows[0];
  return file ? `data:${file.content_type};base64,${file.data.toString("base64")}` : null;
}

// ---------------------------------------------------------------- render view
async function linkFor(db, doc, h, { earliest = false } = {}) {
  const row = (await db.query(
    `SELECT token_enc FROM billing_document_links WHERE document_id = $1
       ${earliest ? "" : "AND revoked_at IS NULL AND expires_at > now()"}
     ORDER BY created_at ${earliest ? "ASC" : "DESC"} LIMIT 1`,
    [doc.id],
  )).rows[0];
  return row ? `${PUBLIC_BASE}/${linkPath(doc.kind)}/${h.openSecret(row.token_enc)}` : null;
}

async function paymentsFor(db, docId) {
  const rows = await db.query(
    `SELECT p.date, a.amount_cents, p.method FROM billing_payment_allocations a JOIN billing_payments p ON p.id = a.payment_id
     WHERE a.document_id = $1 AND p.status = 'confirmed' ORDER BY p.date, p.id`,
    [docId],
  );
  return rows.rows.map((row) => ({ date: dateText(row.date), amountCents: Number(row.amount_cents), method: row.method }));
}

async function creditsFor(db, docId) {
  const rows = await db.query(
    `SELECT number, credited_cents FROM billing_documents
     WHERE credits_document_id = $1 AND kind = 'credit_note' AND status IN ('issued', 'applied') AND credited_cents > 0 ORDER BY issued_at`,
    [docId],
  );
  return rows.rows.map((row) => ({ number: row.number, amountCents: Number(row.credited_cents) }));
}

// Builds what the renderer needs. Issued documents use their frozen snapshots; drafts use today's settings.
export async function buildView(db, orgId, row, lineRows, h, { link = null, live = null } = {}) {
  const issued = Boolean(row.supplier_snapshot);
  let supplier = row.supplier_snapshot;
  let recipient = row.recipient_snapshot;
  let lines = lineRows.map(lineFromRow);
  let totals;
  const date = dateText(row.issue_date) || todayInZa();
  if (!issued) {
    const settings = live?.settings || (await settingsRow(db, orgId));
    const history = live?.history || (await vatHistory(db, orgId));
    const rateContext = live?.rateContext || (await rateContextFor(db, orgId, { kind: row.kind, issueDate: date, creditsDocumentId: row.credits_document_id, history }));
    supplier = supplierSnapshot(settings, bankFrom(settings, h), vatOn(history, date));
    supplier.vatRegistered = rateContext.vat.registered;
    supplier.vatNumber = rateContext.vat.registered ? rateContext.vat.vatNumber : null;
    if (!recipient) {
      const customer = live?.customer || (await db.query("SELECT * FROM customers WHERE id = $1 AND org_id = $2", [row.customer_id, orgId])).rows[0];
      recipient = customer ? recipientSnapshot(customer) : { name: "Choose a customer", address: "" };
    }
    const computed = computeLines(lines, { date: rateContext.date, priceMode: row.price_mode, vatRegistered: rateContext.vat.registered });
    lines = computed.lines;
    totals = computed.totals;
  } else {
    const items = lines.filter((line) => line.lineType === "item");
    totals = documentTotals(items.map((line) => ({ net: line.net, vat: line.tax, rateBp: line.rateBp, rateKey: `${line.taxType}:${line.rateBp}` })));
  }
  const kind = row.kind;
  const payments = kind === "invoice" && row.id ? await paymentsFor(db, row.id) : [];
  const credits = kind === "invoice" && row.id ? await creditsFor(db, row.id) : [];
  const termsDays = kind === "invoice" && row.due_date ? daysBetween(date, dateText(row.due_date)) : null;
  let context = row.credit_context || null;
  if (kind === "credit_note" && !context && row.credits_document_id) {
    const original = (await db.query("SELECT number, issue_date, total_cents, balance_cents FROM billing_documents WHERE id = $1 AND org_id = $2", [row.credits_document_id, orgId])).rows[0];
    if (original) {
      const newBalance = Math.max(0, Number(original.balance_cents) - totals.total);
      context = { originalNumber: original.number, originalDate: dateText(original.issue_date), originalTotal: Number(original.total_cents), newBalance };
    }
  }
  return {
    kind,
    number: row.number,
    status: row.status,
    issueDate: date,
    dueDate: dateText(row.due_date),
    validUntil: dateText(row.valid_until),
    termsDays,
    poNumber: row.po_number,
    reference: row.reference,
    notes: row.notes,
    termsText: row.terms,
    template: row.template,
    priceMode: row.price_mode,
    vatRegistered: supplier.vatRegistered === true,
    supplier: { ...supplier, logo: await logoDataUrl(db, orgId, supplier.logoFileId) },
    recipient,
    lines,
    totals,
    payments,
    credits,
    balanceCents: issued ? Number(row.balance_cents) : totals.total,
    credit: kind === "credit_note" ? { reason: row.credit_reason || "", ...(context || {}) } : null,
    link,
    payUrl: link ? `${link}#pay` : null,
    qrSvg: await qrSvg(link),
  };
}

// Stamps: never on the original; PAID / PARTIALLY PAID / VOID on the copy and hosted page; OVERDUE hosted only; DRAFT everywhere.
export function stampFor(doc, today, { hosted = false, copy = false } = {}) {
  if (doc.status === "draft") return { stamp: "draft", pill: { status: "draft" } };
  if (!hosted && !copy) return { stamp: null, pill: null };
  if (doc.status === "void") return { stamp: "void", pill: { status: "void" } };
  if (doc.kind !== "invoice") return { stamp: null, pill: null };
  if (doc.status === "paid") return { stamp: "paid", pill: { status: "paid" } };
  if (hosted && isOverdue(docSummary(doc, today), today)) return { stamp: "overdue", pill: { status: "overdue" } };
  if (doc.status === "partially_paid") return { stamp: "partial", pill: { status: "partial", text: "Partly paid" } };
  return { stamp: null, pill: null };
}

// ---------------------------------------------------------------- drafts
async function loadDoc(db, orgId, id, { lock = false } = {}) {
  const row = (await db.query(
    `SELECT d.*, c.name AS customer_name FROM billing_documents d JOIN customers c ON c.id = d.customer_id
     WHERE d.id = $1 AND d.org_id = $2 ${lock ? "FOR UPDATE OF d" : ""}`,
    [id, orgId],
  )).rows[0];
  if (!row) throw new BillingInputError("That document was not found.", 404);
  return row;
}

async function loadLines(db, docId) {
  return (await db.query("SELECT * FROM billing_document_lines WHERE document_id = $1 ORDER BY position", [docId])).rows;
}

async function customerRow(db, orgId, customerId) {
  const row = (await db.query("SELECT * FROM customers WHERE id = $1 AND org_id = $2", [customerId, orgId])).rows[0];
  if (!row) throw new BillingInputError("Choose a customer.");
  return row;
}

// Rates for a credit note follow the invoice it reverses; everything else uses its own date.
async function rateContextFor(db, orgId, { kind, issueDate, creditsDocumentId, history }) {
  if (kind === "credit_note" && creditsDocumentId) {
    const original = (await db.query("SELECT issue_date, supplier_snapshot FROM billing_documents WHERE id = $1 AND org_id = $2", [creditsDocumentId, orgId])).rows[0];
    if (original?.supplier_snapshot) {
      const snap = original.supplier_snapshot;
      return { date: dateText(original.issue_date), vat: { registered: snap.vatRegistered === true, vatNumber: snap.vatNumber } };
    }
  }
  return { date: issueDate, vat: vatOn(history, issueDate) };
}

async function writeLines(db, docId, lines) {
  await db.query("DELETE FROM billing_document_lines WHERE document_id = $1", [docId]);
  let position = 0;
  for (const line of lines) {
    position += 1;
    await db.query(
      `INSERT INTO billing_document_lines (document_id, position, line_type, item_id, description, quantity_milli, unit, unit_price_cents,
         discount_bp, tax_type, rate_bp, net_cents, tax_cents, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [docId, position, line.lineType, line.itemId || null, line.description || "", line.quantity ?? 1000, line.unit || "", line.unitPriceCents || 0,
        line.discountBp || 0, line.taxType || "no_vat", line.rateBp || 0, line.net || 0, line.tax || 0, line.total || 0],
    );
  }
}

async function draftInput(db, orgId, body, existing) {
  const kind = existing?.kind || String(body.kind || "");
  if (!KINDS.includes(kind)) throw new BillingInputError("Choose a quote, invoice or credit note.");
  const settings = await settingsRow(db, orgId);
  const customer = await customerRow(db, orgId, body.customerId ?? existing?.customer_id);
  const today = todayInZa();
  const header = parseDraftHeader(body, { today, kind, defaultTermsDays: customer.payment_terms_days ?? settings.default_terms_days });
  const history = await vatHistory(db, orgId);
  let creditsDocumentId = existing?.credits_document_id ? Number(existing.credits_document_id) : null;
  if (kind === "credit_note" && body.creditsDocumentId !== undefined && !existing) {
    creditsDocumentId = /^\d+$/.test(String(body.creditsDocumentId || "")) ? Number(body.creditsDocumentId) : null;
  }
  if (creditsDocumentId) {
    const original = (await db.query("SELECT kind, status, customer_id FROM billing_documents WHERE id = $1 AND org_id = $2", [creditsDocumentId, orgId])).rows[0];
    if (!original || original.kind !== "invoice" || !["issued", "partially_paid", "paid"].includes(original.status)) {
      throw new BillingInputError("A credit note can only reduce an issued invoice.");
    }
    if (Number(original.customer_id) !== Number(customer.id)) throw new BillingInputError("The credit note must be for the same customer as the invoice.");
  }
  const rateContext = await rateContextFor(db, orgId, { kind, issueDate: header.issueDate, creditsDocumentId, history });
  let rawLines = body.lines;
  if (kind === "credit_note" && creditsDocumentId && !existing && !Array.isArray(rawLines)) {
    rawLines = (await loadLines(db, creditsDocumentId)).map((row) => {
      const line = lineFromRow(row);
      return { ...line, quantity: { milli: line.quantity }, unitPrice: { cents: line.unitPriceCents }, discountPercent: line.discountBp / 100 };
    });
  }
  const parsed = parseLines(rawLines, { vatRegistered: rateContext.vat.registered });
  const computed = computeLines(parsed, { date: rateContext.date, priceMode: header.priceMode, vatRegistered: rateContext.vat.registered });
  return {
    kind, customer, settings, header, creditsDocumentId, computed,
    template: header.template || existing?.template || customer.billing_template || settings.default_template,
    notes: body.notes === undefined && !existing ? settings.default_notes : header.notes,
    terms: body.terms === undefined && !existing ? (kind === "credit_note" ? "" : settings.default_terms_text) : header.terms,
  };
}

export async function saveDraft(orgId, actorId, id, body) {
  return tx(async (client) => {
    const existing = id ? await loadDoc(client, orgId, id, { lock: true }) : null;
    if (existing && existing.status !== "draft") throw new BillingInputError("Only a draft can be edited. Issued documents never change; use a credit note instead.", 409);
    const input = await draftInput(client, orgId, body, existing);
    const { header, computed } = input;
    const t = computed.totals;
    let docId = existing ? Number(existing.id) : null;
    if (existing) {
      await client.query(
        `UPDATE billing_documents SET customer_id = $3, issue_date = $4, due_date = $5, valid_until = $6, price_mode = $7, subtotal_cents = $8,
           tax_cents = $9, total_cents = $10, balance_cents = $10, po_number = $11, reference = $12, notes = $13, terms = $14, template = $15,
           credit_reason = $16, updated_at = now()
         WHERE id = $1 AND org_id = $2`,
        [docId, orgId, input.customer.id, header.issueDate, header.dueDate || null, header.validUntil || null, header.priceMode, t.subtotal, t.vat, t.total,
          header.poNumber, header.reference, input.notes, input.terms, input.template, header.creditReason || null],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO billing_documents (org_id, customer_id, kind, issue_date, due_date, valid_until, price_mode, subtotal_cents, tax_cents, total_cents,
           balance_cents, po_number, reference, notes, terms, template, credits_document_id, credit_reason, source_quote_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
        [orgId, input.customer.id, input.kind, header.issueDate, header.dueDate || null, header.validUntil || null, header.priceMode, t.subtotal, t.vat, t.total,
          header.poNumber, header.reference, input.notes, input.terms, input.template, input.creditsDocumentId, header.creditReason || null,
          /^\d+$/.test(String(body.sourceQuoteId || "")) ? Number(body.sourceQuoteId) : null, actorId],
      );
      docId = Number(inserted.rows[0].id);
      await event(client, orgId, docId, "created", { actorType: "user", actorId });
    }
    await writeLines(client, docId, computed.lines);
    return docId;
  });
}

async function event(db, orgId, docId, type, { actorType = "user", actorId = null, channel = null, payload = {}, ip = null, userAgent = null } = {}) {
  await db.query(
    `INSERT INTO billing_document_events (org_id, document_id, type, channel, actor_type, actor_id, ip, user_agent, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [orgId, docId, type, channel, actorType, actorId, ip, userAgent ? String(userAgent).slice(0, 300) : null, JSON.stringify(payload)],
  );
}

// ---------------------------------------------------------------- issue
async function allocateNumber(db, orgId, kind, issueDate) {
  const seq = (await db.query("SELECT * FROM billing_sequences WHERE org_id = $1 AND kind = $2 FOR UPDATE", [orgId, kind])).rows[0];
  const year = Number(issueDate.slice(0, 4));
  let next = Number(seq.next_number);
  if (seq.reset_yearly && seq.current_year && seq.current_year !== year) next = 1;
  const number = formatDocumentNumber({ prefix: seq.prefix, padding: seq.padding, includeYear: seq.include_year }, next, year);
  await db.query("UPDATE billing_sequences SET next_number = $3, current_year = $4 WHERE org_id = $1 AND kind = $2", [orgId, kind, next + 1, year]);
  return number;
}

async function createLink(db, orgId, doc, actorId, expiryDays, h, recipient = null) {
  const token = randomBytes(18).toString("base64url");
  await db.query(
    `INSERT INTO billing_document_links (org_id, document_id, token_hash, token_enc, recipient, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)`,
    [orgId, doc.id, hashToken(token), h.sealSecret(token), recipient, expiryDays, actorId],
  );
  return `${PUBLIC_BASE}/${linkPath(doc.kind)}/${token}`;
}

function limitError(usage, what) {
  const { used, limit } = usage;
  if (limit == null || used < limit) return null;
  return `You have used ${used} of ${limit} ${what} this month on Invoicing Free. Drafts and payments still work; upgrade to Invoicing Pro to remove the limit.`;
}

export async function issueDocument(orgId, actor, id, { acknowledge = [], license, h }) {
  const result = await tx(async (client) => {
    const doc = await loadDoc(client, orgId, id, { lock: true });
    if (doc.status !== "draft") throw new BillingInputError(doc.kind === "quote" ? "This quote has already been sent." : "This document has already been issued.", 409);
    const today = todayInZa();
    if (doc.kind === "invoice") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('billing-issue'), $1::int)", [orgId]);
      const usage = await monthlyUsage(client, orgId, license.entitlements.limits || {});
      const blocked = limitError(usage.invoices, "invoices");
      if (blocked) throw new BillingInputError(blocked, 402);
    }
    const customer = await customerRow(client, orgId, doc.customer_id);
    const settings = await settingsRow(client, orgId);
    const history = await vatHistory(client, orgId);
    const issueDate = today;
    const rateContext = await rateContextFor(client, orgId, { kind: doc.kind, issueDate, creditsDocumentId: doc.credits_document_id, history });
    const ownVat = vatOn(history, issueDate);
    const parsed = (await loadLines(client, doc.id)).map(lineFromRow);
    const items = parsed.filter((line) => line.lineType === "item");
    if (!items.length) throw new BillingInputError("Add at least one line before issuing.", 422);
    const computed = computeLines(parsed, { date: rateContext.date, priceMode: doc.price_mode, vatRegistered: rateContext.vat.registered });
    const total = computed.totals.total;
    if (total <= 0) throw new BillingInputError("The total must be more than R 0,00.", 422);

    const recipient = recipientSnapshot(customer);
    const checks = doc.kind === "invoice"
      ? issueChecks({
        vatRegistered: ownVat.registered,
        totalCents: total,
        customer: { address: recipient.address, vatStatus: customer.vat_status, vatNumber: customer.vat_number },
        lines: computed.lines.map((line) => ({ kind: line.lineType, treatment: line.lineType === "item" ? line.taxType : undefined, description: line.description })),
      })
      : { blocks: [], warnings: [] };
    let original = null;
    if (doc.kind === "credit_note") {
      if (doc.credits_document_id) original = await loadDoc(client, orgId, doc.credits_document_id, { lock: true });
      const cn = creditNoteChecks({ reason: doc.credit_reason, originalInvoice: original, reducesVat: computed.totals.vat > 0 });
      checks.blocks.push(...cn.blocks);
      if (original) {
        const room = Number(original.total_cents) - Number(original.credited_cents);
        if (total > room) checks.blocks.push({ code: "credit_too_big", text: `The credit cannot be more than ${formatRand(room)}, the uncredited part of ${original.number}.` });
      }
    }
    if (checks.blocks.length) return { blocked: checks.blocks };
    const pending = checks.warnings.filter((warning) => !acknowledge.includes(warning.code));
    if (pending.length) return { warnings: pending };

    const number = await allocateNumber(client, orgId, doc.kind, issueDate);
    const supplier = supplierSnapshot(settings, bankFrom(settings, h), ownVat);
    supplier.vatRegistered = rateContext.vat.registered;
    supplier.vatNumber = rateContext.vat.registered ? rateContext.vat.vatNumber : null;
    const termsDays = doc.due_date && doc.issue_date ? daysBetween(dateText(doc.issue_date), dateText(doc.due_date)) : customer.payment_terms_days ?? settings.default_terms_days;
    const dueDate = doc.kind === "invoice" ? addDays(issueDate, Math.max(0, termsDays)) : null;
    const validUntil = doc.kind === "quote" ? addDays(issueDate, Math.max(1, doc.valid_until && doc.issue_date ? daysBetween(dateText(doc.issue_date), dateText(doc.valid_until)) : 30)) : null;
    await writeLines(client, doc.id, computed.lines);

    let creditContext = null;
    let applied = 0;
    if (doc.kind === "credit_note" && original) {
      applied = Math.min(total, Math.max(0, Number(original.balance_cents)));
      const newBalance = Number(original.balance_cents) - applied;
      creditContext = { originalNumber: original.number, originalDate: dateText(original.issue_date), originalTotal: Number(original.total_cents), newBalance };
    }
    const status = doc.kind === "quote" ? "sent" : doc.kind === "credit_note" ? (applied === total ? "applied" : "issued") : "issued";
    await client.query(
      `UPDATE billing_documents SET number = $3, status = $4, issue_date = $5, due_date = $6, valid_until = $7, subtotal_cents = $8, tax_cents = $9,
         total_cents = $10, balance_cents = $11, credited_cents = $12, supplier_snapshot = $13::jsonb, recipient_snapshot = $14::jsonb,
         credit_context = $15::jsonb, issued_at = now(), issued_by = $16, sent_at = CASE WHEN kind = 'quote' THEN now() ELSE sent_at END, updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [doc.id, orgId, number, status, issueDate, dueDate, validUntil, computed.totals.subtotal, computed.totals.vat, total,
        doc.kind === "credit_note" ? total - applied : total, doc.kind === "credit_note" ? applied : 0,
        JSON.stringify(supplier), JSON.stringify(recipient), creditContext ? JSON.stringify(creditContext) : null, actor.id],
    );
    if (doc.kind === "credit_note") {
      if (original && applied > 0) {
        const balance = Number(original.balance_cents) - applied;
        await client.query(
          `UPDATE billing_documents SET credited_cents = credited_cents + $3::bigint, balance_cents = $4::bigint,
             status = CASE WHEN $4::bigint > 0 THEN status WHEN paid_cents > 0 THEN 'paid' ELSE 'credited' END, updated_at = now() WHERE id = $1 AND org_id = $2`,
          [original.id, orgId, applied, balance],
        );
        await event(client, orgId, original.id, "credited", { actorId: actor.id, payload: { creditNote: number, amountCents: applied } });
      }
      if (total - applied > 0) {
        await client.query(
          `INSERT INTO billing_customer_credits (org_id, customer_id, source, source_id, amount_cents, remaining_cents) VALUES ($1, $2, 'credit_note', $3, $4, $4)`,
          [orgId, doc.customer_id, doc.id, total - applied],
        );
      }
    }
    await createLink(client, orgId, { id: doc.id, kind: doc.kind }, actor.id, settings.link_expiry_days, h);
    await event(client, orgId, doc.id, doc.kind === "quote" ? "finalised" : "issued", { actorId: actor.id, payload: { number, totalCents: total } });
    await insertAudit(client, orgId, actor.id, `billing.${doc.kind}.issue`, "billing_document", String(doc.id), { number, totalCents: total, vatRegistered: rateContext.vat.registered });
    return { id: Number(doc.id), number };
  });
  if (result.id) storeOriginalPdf(orgId, result.id, h).catch(() => {});
  return result;
}

// ---------------------------------------------------------------- PDF
export async function storeOriginalPdf(orgId, id, h) {
  const doc = await loadDoc(pool, orgId, id);
  if (doc.pdf_file_id) {
    const file = (await pool.query("SELECT data FROM billing_files WHERE id = $1", [doc.pdf_file_id])).rows[0];
    if (file) return file.data;
  }
  if (doc.status === "draft") throw new BillingInputError("A draft has no issued PDF yet.", 409);
  const view = await buildView(pool, orgId, doc, await loadLines(pool, doc.id), h, { link: await linkFor(pool, doc, h, { earliest: true }) });
  const pdf = await htmlToPdf(renderDocument(view, { mode: "pdf" }));
  const digest = sha256(pdf);
  await tx(async (client) => {
    const current = (await client.query("SELECT pdf_file_id FROM billing_documents WHERE id = $1 FOR UPDATE", [doc.id])).rows[0];
    if (current.pdf_file_id) return;
    const file = await client.query(
      `INSERT INTO billing_files (org_id, purpose, file_name, content_type, size_bytes, sha256, data) VALUES ($1, 'pdf', $2, 'application/pdf', $3, $4, $5) RETURNING id`,
      [orgId, `${doc.number}.pdf`, pdf.length, digest, pdf],
    );
    await client.query("UPDATE billing_documents SET pdf_file_id = $2, pdf_sha256 = $3 WHERE id = $1", [doc.id, file.rows[0].id, digest]);
  });
  return pdf;
}

export async function documentPdf(orgId, id, h, { copy = false } = {}) {
  const doc = await loadDoc(pool, orgId, id);
  const name = `${doc.number || `draft-${doc.id}`}${copy ? "-copy" : ""}.pdf`;
  if (doc.status !== "draft" && !copy) return { name, pdf: await storeOriginalPdf(orgId, id, h) };
  const today = todayInZa();
  const marks = stampFor(doc, today, { copy });
  const view = await buildView(pool, orgId, doc, await loadLines(pool, doc.id), h, { link: doc.status === "draft" ? null : await linkFor(pool, doc, h) });
  return { name, pdf: await htmlToPdf(renderDocument(view, { mode: "pdf", ...marks, copy: copy && doc.status !== "draft" })) };
}

// ---------------------------------------------------------------- lifecycle
export async function voidDocument(orgId, actor, id, reason) {
  return tx(async (client) => {
    const doc = await loadDoc(client, orgId, id, { lock: true });
    if (doc.kind !== "invoice" || !OPEN_INVOICE.includes(doc.status)) throw new BillingInputError("Only an unpaid issued invoice can be voided.", 409);
    if (Number(doc.paid_cents) > 0 || Number(doc.credited_cents) > 0) throw new BillingInputError("This invoice has payments or credits. Use a credit note instead.", 409);
    if (doc.sent_at || doc.first_viewed_at) throw new BillingInputError("This invoice has been sent or viewed. Use a credit note instead, so the customer's records match.", 409);
    const why = String(reason || "").trim().slice(0, 500);
    if (!why) throw new BillingInputError("Give a reason for voiding.");
    await client.query("UPDATE billing_documents SET status = 'void', balance_cents = 0, voided_at = now(), void_reason = $3, updated_at = now() WHERE id = $1 AND org_id = $2", [doc.id, orgId, why]);
    await client.query("UPDATE billing_document_links SET revoked_at = now() WHERE document_id = $1 AND revoked_at IS NULL", [doc.id]);
    await event(client, orgId, doc.id, "voided", { actorId: actor.id, payload: { reason: why } });
    await insertAudit(client, orgId, actor.id, "billing.invoice.void", "billing_document", String(doc.id), { number: doc.number, reason: why });
    return { id: Number(doc.id) };
  });
}

// Full credit of an invoice, issued and applied at once; optionally a draft copy to correct and re-issue.
export async function creditAndReissue(orgId, actor, id, { reason, reissue, license, h }) {
  const doc = await loadDoc(pool, orgId, id);
  if (doc.kind !== "invoice" || !["issued", "partially_paid", "paid"].includes(doc.status)) throw new BillingInputError("Only an issued invoice can be credited.", 409);
  const why = String(reason || "").trim();
  if (!why) throw new BillingInputError("Give a reason for the credit note.");
  const lines = (await loadLines(pool, doc.id)).map(lineFromRow);
  const asInput = lines.map((line) => ({ ...line, quantity: { milli: line.quantity }, unitPrice: { cents: line.unitPriceCents }, discountPercent: line.discountBp / 100 }));
  const room = Number(doc.total_cents) - Number(doc.credited_cents);
  if (room <= 0) throw new BillingInputError("This invoice has already been fully credited.", 409);
  if (room < Number(doc.total_cents)) throw new BillingInputError("Part of this invoice is already credited. Create a credit note for the rest instead.", 409);
  const creditId = await saveDraft(orgId, actor.id, null, { kind: "credit_note", customerId: doc.customer_id, creditsDocumentId: doc.id, creditReason: why, lines: asInput, notes: "", terms: "", template: doc.template });
  const issued = await issueDocument(orgId, actor, creditId, { acknowledge: [], license, h });
  if (!issued.id) {
    await pool.query("DELETE FROM billing_documents WHERE id = $1 AND org_id = $2 AND status = 'draft'", [creditId, orgId]);
    throw new BillingInputError((issued.blocked || issued.warnings || []).map((item) => item.text).join(" ") || "The credit note could not be issued.", 422);
  }
  let draftId = null;
  if (reissue) {
    draftId = await saveDraft(orgId, actor.id, null, {
      kind: "invoice", customerId: doc.customer_id, lines: asInput, poNumber: doc.po_number, reference: doc.reference, notes: doc.notes, terms: doc.terms,
      template: doc.template, priceMode: doc.price_mode, termsDays: doc.due_date && doc.issue_date ? daysBetween(dateText(doc.issue_date), dateText(doc.due_date)) : undefined,
    });
  }
  return { creditNoteId: issued.id, creditNoteNumber: issued.number, draftId };
}

export async function quoteDecision(orgId, id, decision, { actorType = "user", actorId = null, name = "", ip = null, userAgent = null } = {}) {
  return tx(async (client) => {
    const doc = await loadDoc(client, orgId, id, { lock: true });
    if (doc.kind !== "quote" || doc.status !== "sent") throw new BillingInputError("Only a sent quote can be accepted or declined.", 409);
    if (decision === "accepted" && dateText(doc.valid_until) < todayInZa()) throw new BillingInputError("This quote has expired. Ask for an updated quote.", 409);
    await client.query("UPDATE billing_documents SET status = $3, updated_at = now() WHERE id = $1 AND org_id = $2", [doc.id, orgId, decision]);
    await event(client, orgId, doc.id, decision, { actorType, actorId, ip, userAgent, payload: name ? { name: String(name).slice(0, 120) } : {} });
    if (actorId) await insertAudit(client, orgId, actorId, `billing.quote.${decision}`, "billing_document", String(doc.id), { number: doc.number });
    return { id: Number(doc.id) };
  });
}

export async function convertQuote(orgId, actor, id) {
  const doc = await loadDoc(pool, orgId, id);
  if (doc.kind !== "quote" || !["sent", "accepted"].includes(doc.status)) throw new BillingInputError("Only a sent or accepted quote can be turned into an invoice.", 409);
  const lines = (await loadLines(pool, doc.id)).map(lineFromRow).map((line) => ({ ...line, quantity: { milli: line.quantity }, unitPrice: { cents: line.unitPriceCents }, discountPercent: line.discountBp / 100 }));
  const draftId = await saveDraft(orgId, actor.id, null, {
    kind: "invoice", customerId: doc.customer_id, lines, poNumber: doc.po_number, reference: doc.reference, notes: doc.notes, template: doc.template,
    priceMode: doc.price_mode, sourceQuoteId: doc.id,
  });
  await pool.query("UPDATE billing_documents SET status = 'converted', updated_at = now() WHERE id = $1 AND org_id = $2", [doc.id, orgId]);
  await event(pool, orgId, doc.id, "converted", { actorId: actor.id, payload: { invoiceDraftId: draftId } });
  return { draftId };
}

export async function deleteDraft(orgId, actor, id) {
  const removed = await pool.query("DELETE FROM billing_documents WHERE id = $1 AND org_id = $2 AND status = 'draft' AND number IS NULL RETURNING kind", [id, orgId]);
  if (!removed.rows[0]) throw new BillingInputError("Only a draft can be deleted.", 409);
  await insertAudit(pool, orgId, actor.id, "billing.draft.delete", "billing_document", String(id), { kind: removed.rows[0].kind });
  return { ok: true };
}

// ---------------------------------------------------------------- payments
export function parsePayment(body, today) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? body.date : today;
  if (date > today) throw new BillingInputError("A payment date cannot be in the future.");
  let amount;
  try {
    amount = toCents(body.amount);
  } catch {
    throw new BillingInputError("Enter the amount received, for example 1 250,00.");
  }
  if (amount <= 0) throw new BillingInputError("The amount must be more than R 0,00.");
  const method = METHODS.includes(body.method) ? body.method : "eft";
  const allocations = (Array.isArray(body.allocations) ? body.allocations : [])
    .map((entry) => {
      let cents;
      try {
        cents = entry.amountCents ?? toCents(entry.amount);
      } catch {
        throw new BillingInputError("Each allocation must be a rand amount.");
      }
      return { documentId: Number(entry.documentId), amountCents: cents };
    })
    .filter((entry) => Number.isSafeInteger(entry.documentId) && entry.amountCents > 0);
  return { date, amount, method, reference: String(body.reference || "").trim().slice(0, 120), notes: String(body.notes || "").trim().slice(0, 1000), allocations };
}

export async function recordPayment(orgId, actor, customerId, body) {
  const input = parsePayment(body, todayInZa());
  return tx(async (client) => {
    await customerRow(client, orgId, customerId);
    const open = (await client.query(
      `SELECT id, number, balance_cents, paid_cents, total_cents FROM billing_documents
       WHERE org_id = $1 AND customer_id = $2 AND kind = 'invoice' AND status = ANY($3) ORDER BY due_date, issue_date, id FOR UPDATE`,
      [orgId, customerId, OPEN_INVOICE],
    )).rows;
    let plan = input.allocations;
    if (!plan.length) {
      let left = input.amount;
      plan = [];
      for (const invoice of open) {
        if (left <= 0) break;
        const take = Math.min(left, Number(invoice.balance_cents));
        if (take > 0) plan.push({ documentId: Number(invoice.id), amountCents: take });
        left -= take;
      }
    }
    const allocated = plan.reduce((sum, entry) => sum + entry.amountCents, 0);
    if (allocated > input.amount) throw new BillingInputError("The allocations add up to more than the payment.");
    for (const entry of plan) {
      const invoice = open.find((row) => Number(row.id) === entry.documentId);
      if (!invoice) throw new BillingInputError("A payment can only go to this customer's unpaid invoices.");
      if (entry.amountCents > Number(invoice.balance_cents)) throw new BillingInputError(`${invoice.number} only has ${formatRand(Number(invoice.balance_cents))} left to pay.`);
    }
    const payment = await client.query(
      `INSERT INTO billing_payments (org_id, customer_id, date, amount_cents, method, reference, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [orgId, customerId, input.date, input.amount, input.method, input.reference, input.notes, actor.id],
    );
    const paymentId = Number(payment.rows[0].id);
    for (const entry of plan) {
      await client.query("INSERT INTO billing_payment_allocations (payment_id, document_id, amount_cents) VALUES ($1, $2, $3)", [paymentId, entry.documentId, entry.amountCents]);
      await client.query(
        `UPDATE billing_documents SET paid_cents = paid_cents + $3::bigint, balance_cents = balance_cents - $3::bigint,
           status = CASE WHEN balance_cents - $3::bigint = 0 THEN 'paid' ELSE 'partially_paid' END, updated_at = now()
         WHERE id = $1 AND org_id = $2`,
        [entry.documentId, orgId, entry.amountCents],
      );
      await event(client, orgId, entry.documentId, "payment_recorded", { actorId: actor.id, payload: { paymentId, amountCents: entry.amountCents, method: input.method } });
    }
    const excess = input.amount - allocated;
    if (excess > 0) {
      await client.query(
        `INSERT INTO billing_customer_credits (org_id, customer_id, source, source_id, amount_cents, remaining_cents) VALUES ($1, $2, 'payment', $3, $4, $4)`,
        [orgId, customerId, paymentId, excess],
      );
    }
    await insertAudit(client, orgId, actor.id, "billing.payment.record", "billing_payment", String(paymentId), { customerId, amountCents: input.amount, method: input.method, allocations: plan, excessCents: excess });
    return { id: paymentId, allocatedCents: allocated, creditCents: excess };
  });
}

// ---------------------------------------------------------------- email
function emailHtml({ view, kindWord, link, message, free, tokens }) {
  const s = view.supplier;
  const amountLabel = view.kind === "quote" ? "Quote total" : view.kind === "credit_note" ? "Credit amount" : "Amount due";
  const amount = view.kind === "invoice" ? view.balanceCents : view.totals.total;
  const dateRow = view.kind === "invoice" ? ["Due date", longDate(view.dueDate)] : view.kind === "quote" ? ["Valid until", longDate(view.validUntil)] : ["Date", longDate(view.issueDate)];
  const bank = view.kind === "invoice" && s.bank
    ? `<div style="font-size:13px;color:#475569;line-height:1.6;background:#F8FAFC;border-radius:10px;padding:12px 16px;margin-top:18px"><b style="color:#0F172A">Paying by EFT?</b> ${esc(s.bank.bankName)} · ${esc(s.bank.accountName)} · Acc. ${esc(s.bank.accountNumber)}${s.bank.branchCode ? ` · Branch ${esc(s.bank.branchCode)}` : ""}. Please use reference <b style="color:#0F172A">${esc(view.number)}</b>.</div>`
    : "";
  const paras = String(message || "").split(/\n{2,}/).map((p) => `<p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const ids = [view.vatRegistered && s.vatNumber ? `VAT no. ${esc(s.vatNumber)}` : null, s.regNo ? `Reg. no. ${esc(s.regNo)}` : null].filter(Boolean).join(" · ");
  return `<!doctype html><html><body style="margin:0;background:#F4F5F8;padding:28px 0;font-family:Inter,Arial,sans-serif">
<table role="presentation" width="600" align="center" cellspacing="0" cellpadding="0" style="width:600px;max-width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E6E8EE">
<tr><td style="height:6px;background:${tokens.primary};background-image:linear-gradient(90deg,${tokens.primary},${tokens.secondary});font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 36px">
<div style="font-size:20px;font-weight:700;color:${tokens.primaryText}">${esc(s.tradingName || s.legalName)}</div>
<h2 style="font-size:22px;line-height:1.3;font-weight:700;margin:24px 0 10px;color:#0F172A">${esc(kindWord)} ${esc(view.number)}</h2>
${paras}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${tokens.tint4};border:1px solid ${tokens.tint12};border-radius:12px">
<tr><td style="padding:12px 18px;font-size:14px;color:#475569;border-bottom:1px solid ${tokens.tint12}">${esc(kindWord)}</td><td style="padding:12px 18px;font-size:14px;text-align:right;font-weight:600;border-bottom:1px solid ${tokens.tint12}">${esc(view.number)}</td></tr>
<tr><td style="padding:12px 18px;font-size:14px;color:#475569;border-bottom:1px solid ${tokens.tint12}">${amountLabel}</td><td style="padding:12px 18px;font-size:24px;text-align:right;font-weight:700;border-bottom:1px solid ${tokens.tint12}">${esc(formatRand(amount))}</td></tr>
<tr><td style="padding:12px 18px;font-size:14px;color:#475569">${dateRow[0]}</td><td style="padding:12px 18px;font-size:14px;text-align:right;font-weight:600">${dateRow[1]}</td></tr>
</table>
<div style="text-align:center;padding:22px 0 6px"><a href="${esc(link)}" style="display:inline-block;min-width:220px;text-align:center;padding:15px 28px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;background:${tokens.primary};color:${tokens.onPrimary}">${view.kind === "quote" ? "View quote" : view.kind === "credit_note" ? "View credit note" : "View and pay invoice"}</a></div>
${bank}
</td></tr>
<tr><td style="background:#F8FAFC;border-top:1px solid #EEF0F4;padding:18px 36px;font-size:12px;color:#64748B;line-height:1.6">${esc(s.legalName)}${s.physicalAddress ? ` · ${esc(String(s.physicalAddress).replace(/\s*\n\s*/g, ", "))}` : ""}${ids ? `<br>${ids}` : ""}${s.email ? ` · Reply to this email to reach ${esc(s.email)}` : ""}
${free ? '<div style="margin-top:8px;color:#64748B">Sent with Digital Fingers Invoicing</div>' : ""}</td></tr></table></body></html>`;
}

export async function sendDocument(orgId, actor, id, body, { license, h }) {
  let doc = await loadDoc(pool, orgId, id);
  if (doc.kind === "quote" && doc.status === "draft") {
    const issued = await issueDocument(orgId, actor, id, { acknowledge: body.acknowledge || [], license, h });
    if (!issued.id) return issued;
    doc = await loadDoc(pool, orgId, id);
  }
  if (["draft", "pending_approval", "void"].includes(doc.status)) throw new BillingInputError("Issue the document before sending it.", 409);
  const usage = await monthlyUsage(pool, orgId, license.entitlements.limits || {});
  const blocked = limitError(usage.emails, "emails");
  if (blocked) throw new BillingInputError(blocked, 402);
  const to = addressSafe(body.to || doc.recipient_snapshot?.email);
  if (!to) throw new BillingInputError("Enter the customer's email address.");
  const cc = String(body.cc ?? "").split(/[,;\s]+/).map(addressSafe).filter(Boolean).slice(0, 5);
  const settings = await settingsRow(pool, orgId);
  let link = await linkFor(pool, doc, h);
  if (!link) link = await createLink(pool, orgId, { id: doc.id, kind: doc.kind }, actor.id, settings.link_expiry_days, h, to);
  const view = await buildView(pool, orgId, doc, await loadLines(pool, doc.id), h, { link });
  const kindWord = documentTitle(doc.kind, view.vatRegistered);
  const trading = view.supplier.tradingName || view.supplier.legalName;
  const amount = doc.kind === "invoice" ? formatRand(Number(doc.balance_cents)) : formatRand(Number(doc.total_cents));
  const subject = String(body.subject || "").trim().slice(0, 180)
    || (doc.kind === "invoice" ? `${kindWord} ${doc.number} from ${trading} – ${amount} due ${longDate(dateText(doc.due_date))}` : `${kindWord} ${doc.number} from ${trading}`);
  const message = String(body.message || "").trim().slice(0, 4000)
    || `Hi${view.recipient.contact ? ` ${view.recipient.contact.split(/[ ,]/)[0]}` : ""},\n\nPlease find ${kindWord.toLowerCase()} ${doc.number} for ${amount}. You can view it online with the button below${settings.attach_pdf ? ", and the PDF is attached" : ""}.\n\nKind regards,\n${trading}`;
  const tokens = tokensFor(view.supplier.primaryColour, view.supplier.secondaryColour);
  const tintTokens = { ...tokens, tint4: "#F8F7FD", tint12: "#E9E5F8" };
  const free = !hasFeature(license.entitlements, "invoicing_pro") && !hasFeature(license.entitlements, "invoicing_msp");
  const html = emailHtml({ view, kindWord, link, message, free, tokens: tintTokens });
  const text = `${message}\n\n${kindWord} ${doc.number}: ${amount}\nView online: ${link}${free ? "\n\nSent with Digital Fingers Invoicing" : ""}`;
  const attachments = [];
  if (settings.attach_pdf) {
    const pdf = await storeOriginalPdf(orgId, doc.id, h);
    attachments.push({ filename: `${doc.number}.pdf`, contentType: "application/pdf", content: pdf });
  }
  const message_row = await pool.query(
    "INSERT INTO billing_messages (org_id, document_id, to_address, cc, status, created_by) VALUES ($1, $2, $3, $4, 'queued', $5) RETURNING id",
    [orgId, doc.id, to, cc.join(", ") || null, actor.id],
  );
  let ok = false;
  let error = null;
  try {
    ok = await sendMail({ to, cc, subject, text, html, attachments, fromName: trading, replyTo: settings.email || undefined, automatic: false, headers: { "X-DF-Document": String(doc.id) } });
    if (!ok) error = "Email is not set up on this server.";
  } catch (err) {
    error = String(err?.message || err).slice(0, 200);
  }
  await pool.query("UPDATE billing_messages SET status = $2, error = $3 WHERE id = $1", [message_row.rows[0].id, ok ? "sent" : "failed", error]);
  if (!ok) throw new BillingInputError(`The email was not sent: ${error}`, 502);
  await pool.query("UPDATE billing_documents SET sent_at = COALESCE(sent_at, now()), updated_at = now() WHERE id = $1 AND org_id = $2", [doc.id, orgId]);
  await event(pool, orgId, doc.id, "sent", { actorId: actor.id, channel: "email", payload: { to, cc } });
  await insertAudit(pool, orgId, actor.id, `billing.${doc.kind}.send`, "billing_document", String(doc.id), { number: doc.number, to, cc });
  return { ok: true, to };
}

// ---------------------------------------------------------------- reads
export async function listDocuments(orgId, query) {
  const where = ["d.org_id = $1"];
  const params = [orgId];
  if (KINDS.includes(query.kind)) {
    params.push(query.kind);
    where.push(`d.kind = $${params.length}`);
  }
  if (/^\d+$/.test(query.customer || "")) {
    params.push(Number(query.customer));
    where.push(`d.customer_id = $${params.length}`);
  }
  const today = todayInZa();
  if (query.status === "overdue") {
    params.push(today);
    where.push(`d.kind = 'invoice' AND d.status IN ('issued', 'partially_paid') AND d.due_date < $${params.length}`);
  } else if (query.status === "unpaid") {
    where.push("d.kind = 'invoice' AND d.status IN ('issued', 'partially_paid')");
  } else if (/^[a-z_]+$/.test(query.status || "") && STATUS_LABELS[query.status]) {
    params.push(query.status);
    where.push(`d.status = $${params.length}`);
  }
  if (query.q) {
    params.push(`%${String(query.q).slice(0, 80).replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(d.number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR d.reference ILIKE $${params.length})`);
  }
  const rows = await pool.query(
    `SELECT d.*, c.name AS customer_name FROM billing_documents d JOIN customers c ON c.id = d.customer_id
     WHERE ${where.join(" AND ")} ORDER BY (d.status = 'draft') DESC, d.issue_date DESC NULLS LAST, d.id DESC LIMIT 500`,
    params,
  );
  return rows.rows.map((row) => docSummary(row, today));
}

export async function documentDetail(orgId, id, h, manage) {
  const row = await loadDoc(pool, orgId, id);
  const today = todayInZa();
  const doc = docSummary(row, today);
  const lines = (await loadLines(pool, row.id)).map(lineFromRow);
  const events = (await pool.query(
    `SELECT e.type, e.channel, e.actor_type, e.payload, e.created_at, u.name AS actor_name FROM billing_document_events e
     LEFT JOIN users u ON u.id = e.actor_id AND e.actor_type = 'user' WHERE e.document_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
    [row.id],
  )).rows.map((e) => ({ type: e.type, channel: e.channel, actorType: e.actor_type, actorName: e.actor_name, payload: e.payload, at: e.created_at }));
  const related = (await pool.query(
    `SELECT id, kind, number, status, total_cents FROM billing_documents WHERE org_id = $1 AND (credits_document_id = $2 OR source_quote_id = $2 OR id = $3 OR id = $4)
     AND id <> $2 ORDER BY id`,
    [orgId, row.id, row.credits_document_id || 0, row.source_quote_id || 0],
  )).rows.map((r) => ({ id: Number(r.id), kind: r.kind, number: r.number, status: r.status, totalCents: Number(r.total_cents) }));
  const link = row.status === "draft" || !manage ? null : await linkFor(pool, row, h);
  const payments = row.kind === "invoice" ? await paymentsFor(pool, row.id) : [];
  const settings = await settingsRow(pool, orgId);
  const customer = (await pool.query("SELECT * FROM customers WHERE id = $1", [row.customer_id])).rows[0];
  const history = await vatHistory(pool, orgId);
  const rateContext = await rateContextFor(pool, orgId, { kind: row.kind, issueDate: doc.issueDate || today, creditsDocumentId: row.credits_document_id, history });
  const actions = [];
  if (manage) {
    if (row.status === "draft") actions.push("edit", "issue", "delete");
    if (row.kind === "invoice" && OPEN_INVOICE.includes(row.status)) actions.push("payment", "send");
    if (row.kind === "invoice" && OPEN_INVOICE.includes(row.status) && !row.sent_at && !row.first_viewed_at && Number(row.paid_cents) === 0 && Number(row.credited_cents) === 0) actions.push("void");
    if (row.kind === "invoice" && ["issued", "partially_paid", "paid"].includes(row.status) && Number(row.credited_cents) < Number(row.total_cents)) actions.push("credit");
    if (row.kind === "invoice" && row.status === "paid") actions.push("send");
    if (row.kind === "credit_note" && row.status !== "draft") actions.push("send");
    if (row.kind === "quote" && row.status === "sent") actions.push("accept", "decline", "convert", "send");
    if (row.kind === "quote" && row.status === "accepted") actions.push("convert");
    if (row.status !== "draft") actions.push("link");
  }
  return {
    document: {
      ...doc,
      priceMode: row.price_mode,
      notes: row.notes,
      terms: row.terms,
      creditReason: row.credit_reason,
      voidReason: row.void_reason,
      recipient: row.recipient_snapshot || (customer ? recipientSnapshot(customer) : null),
      vatRegistered: row.supplier_snapshot ? row.supplier_snapshot.vatRegistered === true : rateContext.vat.registered,
      termsDays: row.kind === "invoice" && row.due_date && row.issue_date ? daysBetween(dateText(row.issue_date), dateText(row.due_date)) : null,
      pdfSha256: row.pdf_sha256,
      firstViewedAt: row.first_viewed_at,
    },
    lines,
    events,
    related,
    payments,
    link,
    actions,
    defaults: { attachPdf: settings.attach_pdf, linkExpiryDays: settings.link_expiry_days },
  };
}

// ---------------------------------------------------------------- live preview (unsaved editor state)
export async function previewHtml(orgId, body, h, fontBase) {
  const kind = KINDS.includes(body.kind) ? body.kind : "invoice";
  const settings = await settingsRow(pool, orgId);
  const history = await vatHistory(pool, orgId);
  const today = todayInZa();
  const customer = /^\d+$/.test(String(body.customerId || "")) ? (await pool.query("SELECT * FROM customers WHERE id = $1 AND org_id = $2", [body.customerId, orgId])).rows[0] : null;
  let header;
  try {
    header = parseDraftHeader(body, { today, kind, defaultTermsDays: customer?.payment_terms_days ?? settings.default_terms_days });
  } catch {
    header = parseDraftHeader({}, { today, kind, defaultTermsDays: settings.default_terms_days });
  }
  const creditsDocumentId = kind === "credit_note" && /^\d+$/.test(String(body.creditsDocumentId || "")) ? Number(body.creditsDocumentId) : null;
  const rateContext = await rateContextFor(pool, orgId, { kind, issueDate: header.issueDate, creditsDocumentId, history });
  let lines;
  try {
    lines = parseLines(body.lines, { vatRegistered: rateContext.vat.registered });
  } catch {
    lines = [];
  }
  const row = {
    id: null, kind, number: body.number || null, status: "draft", customer_id: customer?.id, issue_date: header.issueDate, due_date: header.dueDate || null,
    valid_until: header.validUntil || null, price_mode: header.priceMode, po_number: header.poNumber, reference: header.reference,
    notes: body.notes === undefined ? settings.default_notes : header.notes, terms: body.terms === undefined ? settings.default_terms_text : header.terms,
    template: header.template || customer?.billing_template || settings.default_template, credit_reason: header.creditReason,
    credit_context: null, recipient_snapshot: customer ? null : { name: "Customer name", address: "" },
  };
  if (creditsDocumentId) {
    const original = (await pool.query("SELECT number, issue_date, total_cents, balance_cents FROM billing_documents WHERE id = $1 AND org_id = $2", [creditsDocumentId, orgId])).rows[0];
    if (original) row.credit_context = { originalNumber: original.number, originalDate: dateText(original.issue_date), originalTotal: Number(original.total_cents), newBalance: Number(original.balance_cents) };
  }
  const lineRows = lines.map((line, index) => ({
    id: index, line_type: line.lineType, item_id: line.itemId, description: line.description, quantity_milli: line.quantity ?? 1000, unit: line.unit || "",
    unit_price_cents: line.unitPriceCents || 0, discount_bp: line.discountBp || 0, tax_type: line.taxType || "no_vat", rate_bp: 0, net_cents: 0, tax_cents: 0, total_cents: 0,
  }));
  const view = await buildView(pool, orgId, row, lineRows, h, { live: { settings, history, customer, rateContext } });
  if (body.template && ["modern", "classic", "minimal"].includes(body.template)) view.template = body.template;
  return renderDocument(view, { mode: "preview", stamp: "draft", pill: { status: "draft" }, fontBase });
}

export async function savedPreviewHtml(orgId, id, h, fontBase, { template } = {}) {
  const row = await loadDoc(pool, orgId, id);
  const marks = stampFor(row, todayInZa(), { copy: row.status !== "draft" });
  const view = await buildView(pool, orgId, row, await loadLines(pool, row.id), h, { link: row.status === "draft" ? null : await linkFor(pool, row, h) });
  if (template && ["modern", "classic", "minimal"].includes(template)) view.template = template;
  return renderDocument(view, { mode: "preview", ...marks, fontBase });
}

// ---------------------------------------------------------------- hosted pages (no sign-in)
export async function linkLookup(token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const row = (await pool.query(
    `SELECT l.id AS link_id, l.org_id, l.document_id, l.expires_at, l.revoked_at FROM billing_document_links l WHERE l.token_hash = $1`,
    [hashToken(token)],
  )).rows[0];
  return row || null;
}

export async function hostedView(token, pathKind, h, fontBase, { ip = null, userAgent = null, count = true } = {}) {
  const link = await linkLookup(token);
  if (!link) return { status: 404 };
  const orgId = Number(link.org_id);
  const row = await loadDoc(pool, orgId, link.document_id).catch(() => null);
  if (!row || row.status === "draft" || linkPath(row.kind) !== pathKind) return { status: 404 };
  const settings = await settingsRow(pool, orgId);
  const supplierName = row.supplier_snapshot?.tradingName || row.supplier_snapshot?.legalName || settings.trading_name;
  if (link.revoked_at || new Date(link.expires_at) < new Date()) {
    return { status: 410, body: { expired: true, supplier: { name: supplierName, email: settings.email, phone: settings.phone }, kind: row.kind, number: row.number } };
  }
  if (count) {
    await pool.query(
      "UPDATE billing_documents SET view_count = view_count + 1, first_viewed_at = COALESCE(first_viewed_at, now()), last_viewed_at = now() WHERE id = $1",
      [row.id],
    );
    await event(pool, orgId, row.id, "viewed", { actorType: "customer", channel: "link", ip, userAgent });
  }
  const today = todayInZa();
  const url = `${PUBLIC_BASE}/${pathKind}/${token}`;
  const view = await buildView(pool, orgId, row, await loadLines(pool, row.id), h, { link: url });
  const marks = stampFor(row, today, { hosted: true });
  const summary = docSummary(row, today);
  const license = await h.loadLicense(pool, orgId);
  const free = !hasFeature(license?.entitlements || {}, "invoicing_pro") && !hasFeature(license?.entitlements || {}, "invoicing_msp");
  const s = view.supplier;
  return {
    status: 200,
    body: {
      kind: row.kind,
      title: documentTitle(row.kind, view.vatRegistered),
      number: row.number,
      status: row.status,
      statusLabel: summary.statusLabel,
      overdue: summary.overdue,
      issueDate: summary.issueDate,
      dueDate: summary.dueDate,
      validUntil: summary.validUntil,
      totalCents: summary.totalCents,
      balanceCents: summary.balanceCents,
      canDecide: row.kind === "quote" && row.status === "sent" && summary.validUntil >= today,
      recipient: { name: view.recipient.name },
      supplier: {
        name: s.tradingName || s.legalName,
        legalName: s.legalName,
        email: s.email,
        phone: s.phone,
        address: s.physicalAddress,
        ids: [view.vatRegistered && s.vatNumber ? `VAT no. ${s.vatNumber}` : null, s.regNo ? `Reg. no. ${s.regNo}` : null].filter(Boolean).join(" · "),
        logo: s.logo,
        tokens: tokensFor(s.primaryColour, s.secondaryColour),
      },
      bank: row.kind === "invoice" && s.bank ? s.bank : null,
      payments: view.payments,
      free,
      html: renderDocument(view, { mode: "screen", ...marks, fontBase }),
    },
  };
}

export async function hostedPdf(token, pathKind, h) {
  const link = await linkLookup(token);
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) return null;
  const row = await loadDoc(pool, Number(link.org_id), link.document_id).catch(() => null);
  if (!row || row.status === "draft" || linkPath(row.kind) !== pathKind) return null;
  return { name: `${row.number}.pdf`, pdf: await storeOriginalPdf(Number(link.org_id), row.id, h) };
}

export async function hostedDecision(token, decision, body, meta) {
  const link = await linkLookup(token);
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) throw new BillingInputError("This link has expired.", 410);
  const row = await loadDoc(pool, Number(link.org_id), link.document_id);
  if (row.kind !== "quote") throw new BillingInputError("Not found.", 404);
  return quoteDecision(Number(link.org_id), row.id, decision, { actorType: "customer", name: body?.name, ...meta });
}

export async function regenerateLink(orgId, actor, id, h) {
  return tx(async (client) => {
    const doc = await loadDoc(client, orgId, id, { lock: true });
    if (doc.status === "draft" || doc.status === "void") throw new BillingInputError("Only an issued document has an online link.", 409);
    await client.query("UPDATE billing_document_links SET revoked_at = now() WHERE document_id = $1 AND revoked_at IS NULL", [doc.id]);
    const settings = await settingsRow(client, orgId);
    const url = await createLink(client, orgId, { id: doc.id, kind: doc.kind }, actor.id, settings.link_expiry_days, h);
    await event(client, orgId, doc.id, "link_regenerated", { actorId: actor.id });
    await insertAudit(client, orgId, actor.id, "billing.link.regenerate", "billing_document", String(doc.id), { number: doc.number });
    return { url };
  });
}

// ---------------------------------------------------------------- routes
const json = (h, res, status, body) => {
  h.send(res, status, body);
  return true;
};

function sendPdf(res, { name, pdf }, inline = false) {
  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": pdf.length,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "cache-control": "private, no-store",
  });
  res.end(pdf);
  return true;
}

function sendHtml(res, html) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
  return true;
}

export async function handleDocuments(req, res, url, ctx) {
  const { orgId, actor, manage, license, h } = ctx;
  const path = url.pathname;
  const fontBase = "/billing-assets/fonts/";
  const managerOnly = () => json(h, res, 403, { error: "Only an owner or admin can change invoices, quotes and payments." });

  if (path === "/v1/billing/documents") {
    if (req.method === "GET") return json(h, res, 200, { documents: await listDocuments(orgId, Object.fromEntries(url.searchParams)), canManage: manage });
    if (req.method === "POST") {
      if (!manage) return managerOnly();
      const id = await saveDraft(orgId, actor.id, null, await h.readJson(req, 524288));
      await insertAudit(pool, orgId, actor.id, "billing.draft.create", "billing_document", String(id), {});
      return json(h, res, 201, { id });
    }
  }
  if (req.method === "POST" && path === "/v1/billing/preview") {
    return sendHtml(res, await previewHtml(orgId, await h.readJson(req, 524288), h, fontBase));
  }
  if (path === "/v1/billing/payments") {
    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT p.*, c.name AS customer_name,
                COALESCE((SELECT json_agg(json_build_object('documentId', a.document_id, 'number', d.number, 'amountCents', a.amount_cents))
                          FROM billing_payment_allocations a JOIN billing_documents d ON d.id = a.document_id WHERE a.payment_id = p.id), '[]') AS allocations
         FROM billing_payments p JOIN customers c ON c.id = p.customer_id WHERE p.org_id = $1
         ${/^\d+$/.test(url.searchParams.get("customer") || "") ? "AND p.customer_id = $2" : ""} ORDER BY p.date DESC, p.id DESC LIMIT 500`,
        /^\d+$/.test(url.searchParams.get("customer") || "") ? [orgId, Number(url.searchParams.get("customer"))] : [orgId],
      );
      return json(h, res, 200, {
        payments: rows.rows.map((p) => ({
          id: Number(p.id), customerId: Number(p.customer_id), customerName: p.customer_name, date: dateText(p.date), amountCents: Number(p.amount_cents),
          method: p.method, reference: p.reference, status: p.status, notes: p.notes, allocations: p.allocations.map((a) => ({ ...a, amountCents: Number(a.amountCents) })),
        })),
        canManage: manage,
      });
    }
    if (req.method === "POST") {
      if (!manage) return managerOnly();
      const body = await h.readJson(req);
      return json(h, res, 201, await recordPayment(orgId, actor, Number(body.customerId), body));
    }
  }
  if (req.method === "GET" && path === "/v1/billing/overview") {
    const today = todayInZa();
    const totals = (await pool.query(
      `SELECT
         COALESCE(sum(balance_cents) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partially_paid')), 0)::bigint AS outstanding,
         COALESCE(sum(balance_cents) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partially_paid') AND due_date < $2), 0)::bigint AS overdue,
         count(*) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partially_paid') AND due_date < $2)::int AS overdue_count,
         count(*) FILTER (WHERE status = 'draft')::int AS drafts,
         count(*) FILTER (WHERE kind = 'quote' AND status = 'sent' AND valid_until >= $2)::int AS open_quotes
       FROM billing_documents WHERE org_id = $1`,
      [orgId, today],
    )).rows[0];
    const paid = (await pool.query(
      `SELECT COALESCE(sum(amount_cents), 0)::bigint AS paid FROM billing_payments WHERE org_id = $1 AND status = 'confirmed' AND date >= date_trunc('month', $2::date)`,
      [orgId, today],
    )).rows[0];
    const recent = await listDocuments(orgId, {});
    return json(h, res, 200, {
      outstandingCents: Number(totals.outstanding), overdueCents: Number(totals.overdue), overdueCount: totals.overdue_count, drafts: totals.drafts,
      openQuotes: totals.open_quotes, paidThisMonthCents: Number(paid.paid), usage: await monthlyUsage(pool, orgId, license.entitlements.limits || {}),
      recent: recent.slice(0, 8), canManage: manage,
    });
  }

  const match = path.match(/^\/v1\/billing\/documents\/(\d+)(?:\/([a-z-]+))?$/);
  if (!match) return false;
  const id = Number(match[1]);
  const action = match[2] || "";
  if (!action) {
    if (req.method === "GET") return json(h, res, 200, { ...(await documentDetail(orgId, id, h, manage)), canManage: manage });
    if (req.method === "PUT") {
      if (!manage) return managerOnly();
      await saveDraft(orgId, actor.id, id, await h.readJson(req, 524288));
      return json(h, res, 200, { id });
    }
    if (req.method === "DELETE") {
      if (!manage) return managerOnly();
      return json(h, res, 200, await deleteDraft(orgId, actor, id));
    }
  }
  if (req.method === "GET" && action === "preview") return sendHtml(res, await savedPreviewHtml(orgId, id, h, fontBase, { template: url.searchParams.get("template") }));
  if (req.method === "GET" && action === "pdf") return sendPdf(res, await documentPdf(orgId, id, h, { copy: url.searchParams.get("copy") === "1" }));
  if (req.method !== "POST") return false;
  if (!manage) return managerOnly();
  const body = await h.readJson(req);
  if (action === "issue") {
    const result = await issueDocument(orgId, actor, id, { acknowledge: Array.isArray(body.acknowledge) ? body.acknowledge : [], license, h });
    if (result.blocked) return json(h, res, 422, { error: result.blocked.map((b) => b.text).join(" "), blocks: result.blocked });
    if (result.warnings) return json(h, res, 409, { error: "Please confirm before issuing.", warnings: result.warnings });
    return json(h, res, 200, result);
  }
  if (action === "void") return json(h, res, 200, await voidDocument(orgId, actor, id, body.reason));
  if (action === "credit") return json(h, res, 200, await creditAndReissue(orgId, actor, id, { reason: body.reason, reissue: body.reissue === true, license, h }));
  if (action === "accept" || action === "decline") return json(h, res, 200, await quoteDecision(orgId, id, action === "accept" ? "accepted" : "declined", { actorId: actor.id }));
  if (action === "convert") return json(h, res, 200, await convertQuote(orgId, actor, id));
  if (action === "send") {
    const result = await sendDocument(orgId, actor, id, body, { license, h });
    if (result.blocked) return json(h, res, 422, { error: result.blocked.map((b) => b.text).join(" "), blocks: result.blocked });
    if (result.warnings) return json(h, res, 409, { error: "Please confirm before sending.", warnings: result.warnings });
    return json(h, res, 200, result);
  }
  if (action === "link") return json(h, res, 200, await regenerateLink(orgId, actor, id, h));
  return false;
}

// /v1/public/billing/(pay|q)/<token>[/pdf|/accept|/decline]: the customer's private link, no sign-in.
export async function handlePublicBilling(req, res, url, h) {
  const match = url.pathname.match(/^\/v1\/public\/billing\/(pay|q)\/([A-Za-z0-9_-]{20,40})(?:\/(pdf|accept|decline))?$/);
  if (!match) return false;
  if (await h.limited(req)) return json(h, res, 429, { error: "Too many requests. Wait a few minutes and try again." });
  const [, pathKind, token, action] = match;
  const meta = { ip: h.clientAddress(req), userAgent: req.headers["user-agent"] || null };
  try {
    if (req.method === "GET" && !action) {
      const result = await hostedView(token, pathKind, h, "/billing-assets/fonts/", { ...meta, count: url.searchParams.get("count") !== "0" });
      if (result.status === 404) return json(h, res, 404, { error: "Not found." });
      return json(h, res, result.status, result.body);
    }
    if (req.method === "GET" && action === "pdf") {
      const file = await hostedPdf(token, pathKind, h);
      if (!file) return json(h, res, 404, { error: "Not found." });
      return sendPdf(res, file);
    }
    if (req.method === "POST" && pathKind === "q" && (action === "accept" || action === "decline")) {
      const body = await h.readJson(req);
      await hostedDecision(token, action === "accept" ? "accepted" : "declined", body, meta);
      return json(h, res, 200, { ok: true });
    }
  } catch (error) {
    if (error instanceof BillingInputError) return json(h, res, error.status, { error: error.message });
    throw error;
  }
  return json(h, res, 404, { error: "Not found." });
}
