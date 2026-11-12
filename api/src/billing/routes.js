import { createHash } from "node:crypto";
import { pool } from "../db.js";
import { insertAudit } from "../audit.js";
import { hasFeature } from "../licensing.js";
import { dateText, monthlyUsage, todayInZa, tx, vatHistory, vatOn } from "./common.js";
import { handleDocuments } from "./documents.js";
import {
  BillingInputError,
  DEFAULT_SEQUENCES,
  DEFAULT_TAX_RATES,
  DOCUMENT_KINDS,
  ITEM_TYPES,
  ITEM_UNITS,
  KIND_LABELS,
  STARTER_ITEMS,
  TAX_LABELS,
  TAX_TYPES,
  TEMPLATES,
  VAT_STATUSES,
  formatDocumentNumber,
  parseBank,
  parseCompany,
  parseCustomerBilling,
  parseItem,
  parseLogo,
  parseSequence,
  parseVatRecord,
} from "./setup.js";

// Defaults for a tenant's first visit: settings row, number sequences, tax rates and starter items. Safe to call often.
export async function ensureSetup(db, orgId) {
  const existing = await db.query("SELECT 1 FROM billing_settings WHERE org_id = $1", [orgId]);
  if (existing.rows[0]) return;
  await db.query(
    `INSERT INTO billing_settings (org_id, legal_name, trading_name)
     SELECT id, name, name FROM orgs WHERE id = $1 ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  );
  for (const kind of DOCUMENT_KINDS) {
    await db.query("INSERT INTO billing_sequences (org_id, kind, prefix) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [orgId, kind, DEFAULT_SEQUENCES[kind]]);
  }
  const rates = await db.query("SELECT 1 FROM billing_tax_rates WHERE org_id = $1 LIMIT 1", [orgId]);
  if (!rates.rows[0]) {
    for (const rate of DEFAULT_TAX_RATES) {
      await db.query(
        `INSERT INTO billing_tax_rates (org_id, name, type, rate_bp, effective_from, effective_to, sars_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgId, rate.name, rate.type, rate.rateBp, rate.from, rate.to, rate.sarsCode],
      );
    }
  }
  const items = await db.query("SELECT 1 FROM billing_items WHERE org_id = $1 LIMIT 1", [orgId]);
  if (!items.rows[0]) {
    for (const item of STARTER_ITEMS) {
      await db.query("INSERT INTO billing_items (org_id, name, type, unit, tax_type) VALUES ($1, $2, $3, $4, 'standard')", [orgId, item.name, item.type, item.unit]);
    }
  }
}

function settingsView(row, bank) {
  return {
    legalName: row.legal_name,
    tradingName: row.trading_name,
    companyRegNo: row.company_reg_no,
    physicalAddress: row.physical_address,
    postalAddress: row.postal_address,
    email: row.email,
    phone: row.phone,
    website: row.website,
    bbbeeLevel: row.bbbee_level,
    csdNumber: row.csd_number,
    defaultTermsDays: row.default_terms_days,
    defaultNotes: row.default_notes,
    defaultTermsText: row.default_terms_text,
    priceMode: row.price_mode,
    defaultTemplate: row.default_template,
    primaryColour: row.primary_colour,
    secondaryColour: row.secondary_colour,
    linkExpiryDays: row.link_expiry_days,
    attachPdf: row.attach_pdf,
    bank,
    updatedAt: row.updated_at,
  };
}

export function itemView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    sku: row.sku,
    type: row.type,
    unit: row.unit,
    unitPriceCents: Number(row.unit_price_cents),
    taxType: row.tax_type,
    accountCode: row.account_code,
    costCents: row.cost_cents == null ? null : Number(row.cost_cents),
    active: row.active,
  };
}

function customerBillingView(row) {
  return {
    id: Number(row.id),
    name: row.name,
    address: row.address || "",
    email: row.email || "",
    vatStatus: row.vat_status,
    vatNumber: row.vat_number || "",
    registeredName: row.registered_name || "",
    billingContact: row.billing_contact || row.contact_name || "",
    billingEmail: row.billing_email || "",
    billingCc: row.billing_cc || "",
    billingAddress: row.billing_address || "",
    paymentTermsDays: row.payment_terms_days,
    billingTemplate: row.billing_template,
    billingReminders: row.billing_reminders,
  };
}

// Everything under /v1/billing. The licence check runs first, so a tenant without Invoicing gets 403 on every path.
export async function handleBilling(req, res, url, actor, h) {
  if (url.pathname !== "/v1/billing" && !url.pathname.startsWith("/v1/billing/")) return false;
  const reply = (status, body) => {
    h.send(res, status, body);
    return true;
  };
  const license = await h.requireInvoicing(actor, res);
  if (!license) return true;
  const orgId = actor.org_id;
  const manage = h.canOperate(actor);
  const path = url.pathname;
  const audit = (action, targetType, targetId, detail, db = pool) => insertAudit(db, orgId, actor.id, action, targetType, String(targetId), detail);
  const managerOnly = () => reply(403, { error: "Only an owner or admin can change Invoicing settings." });

  try {
    await ensureSetup(pool, orgId);

    if (req.method === "GET" && path === "/v1/billing/status") {
      const { features, limits } = license.entitlements;
      const history = await vatHistory(pool, orgId);
      return reply(200, {
        features: features.filter((key) => key.startsWith("invoicing")),
        limits,
        usage: await monthlyUsage(pool, orgId, limits || {}),
        canManage: manage,
        vat: vatOn(history, todayInZa()),
      });
    }

    if (path === "/v1/billing/settings/company") {
      if (req.method === "GET") {
        const row = (await pool.query("SELECT * FROM billing_settings WHERE org_id = $1", [orgId])).rows[0];
        const bank = row.bank_details_enc ? JSON.parse(h.openSecret(row.bank_details_enc)) : null;
        const history = await vatHistory(pool, orgId);
        const today = todayInZa();
        return reply(200, {
          settings: settingsView(row, bank),
          vatHistory: history,
          vat: vatOn(history, today),
          today,
          templates: TEMPLATES,
          canManage: manage,
        });
      }
      if (req.method === "PUT") {
        if (!manage) return managerOnly();
        const body = await h.readJson(req);
        const input = parseCompany(body);
        const bank = parseBank(body.bank || {});
        await tx(async (client) => {
          await client.query(
            `UPDATE billing_settings SET legal_name = $2, trading_name = $3, company_reg_no = $4, physical_address = $5,
               postal_address = $6, email = $7, phone = $8, website = $9, bbbee_level = $10, csd_number = $11,
               default_terms_days = $12, default_notes = $13, default_terms_text = $14, price_mode = $15,
               default_template = $16, primary_colour = $17, secondary_colour = $18, link_expiry_days = $19,
               attach_pdf = $20, bank_details_enc = $21, updated_by = $22, updated_at = now()
             WHERE org_id = $1`,
            [orgId, input.legalName, input.tradingName, input.companyRegNo, input.physicalAddress, input.postalAddress,
              input.email, input.phone, input.website, input.bbbeeLevel, input.csdNumber, input.defaultTermsDays,
              input.defaultNotes, input.defaultTermsText, input.priceMode, input.defaultTemplate, input.primaryColour,
              input.secondaryColour, input.linkExpiryDays, input.attachPdf, bank ? h.sealSecret(JSON.stringify(bank)) : null, actor.id],
          );
          await audit("billing.settings.update", "billing_settings", orgId, { fields: Object.keys(input), bankDetails: bank ? "set" : "empty" }, client);
        });
        return reply(200, { ok: true });
      }
    }

    if (path === "/v1/billing/settings/vat" && req.method === "POST") {
      if (!manage) return managerOnly();
      const today = todayInZa();
      const record = parseVatRecord(await h.readJson(req), today);
      const issued = await pool.query(
        `SELECT count(*)::int AS n FROM billing_documents
         WHERE org_id = $1 AND issue_date >= $2 AND status NOT IN ('draft', 'pending_approval') AND kind <> 'quote'`,
        [orgId, record.effectiveFrom],
      );
      if (issued.rows[0].n > 0) {
        throw new BillingInputError("Documents were already issued on or after that date. Choose a later effective date; issued documents never change.");
      }
      try {
        const inserted = await pool.query(
          `INSERT INTO billing_vat_registrations (org_id, vat_registered, vat_number, effective_from, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [orgId, record.vatRegistered, record.vatNumber, record.effectiveFrom, actor.id],
        );
        await audit("billing.vat.record", "billing_vat_registration", inserted.rows[0].id, record);
      } catch (error) {
        if (error.code === "23505") throw new BillingInputError("There is already a VAT change on that date. Remove it first, or pick another date.");
        throw error;
      }
      return reply(201, { ok: true });
    }

    const vatMatch = path.match(/^\/v1\/billing\/settings\/vat\/(\d+)$/);
    if (vatMatch && req.method === "DELETE") {
      if (!manage) return managerOnly();
      const today = todayInZa();
      const removed = await pool.query(
        "DELETE FROM billing_vat_registrations WHERE id = $1 AND org_id = $2 AND effective_from > $3 RETURNING vat_registered, effective_from",
        [vatMatch[1], orgId, today],
      );
      if (!removed.rows[0]) throw new BillingInputError("Only a VAT change that has not taken effect yet can be removed.");
      await audit("billing.vat.remove", "billing_vat_registration", vatMatch[1], { effectiveFrom: dateText(removed.rows[0].effective_from) });
      return reply(200, { ok: true });
    }

    if (path === "/v1/billing/settings/numbering") {
      if (req.method === "GET") {
        const rows = await pool.query("SELECT * FROM billing_sequences WHERE org_id = $1", [orgId]);
        const year = Number(todayInZa().slice(0, 4));
        const sequences = DOCUMENT_KINDS.map((kind) => {
          const row = rows.rows.find((entry) => entry.kind === kind);
          const sequence = { prefix: row.prefix, padding: row.padding, includeYear: row.include_year };
          return {
            kind,
            label: KIND_LABELS[kind],
            prefix: row.prefix,
            padding: row.padding,
            nextNumber: Number(row.next_number),
            includeYear: row.include_year,
            resetYearly: row.reset_yearly,
            preview: formatDocumentNumber(sequence, Number(row.next_number), year),
          };
        });
        return reply(200, { sequences, canManage: manage });
      }
      if (req.method === "PUT") {
        if (!manage) return managerOnly();
        const body = await h.readJson(req);
        const kind = String(body.kind || "");
        if (!DOCUMENT_KINDS.includes(kind)) throw new BillingInputError("Choose invoices, quotes or credit notes.");
        await tx(async (client) => {
          const current = (await client.query("SELECT * FROM billing_sequences WHERE org_id = $1 AND kind = $2 FOR UPDATE", [orgId, kind])).rows[0];
          const input = parseSequence(body, current);
          await client.query(
            `UPDATE billing_sequences SET prefix = $3, padding = $4, next_number = $5, include_year = $6, reset_yearly = $7
             WHERE org_id = $1 AND kind = $2`,
            [orgId, kind, input.prefix, input.padding, input.nextNumber, input.includeYear, input.resetYearly],
          );
          await audit("billing.numbering.update", "billing_sequence", kind, {
            before: { prefix: current.prefix, padding: current.padding, nextNumber: Number(current.next_number), includeYear: current.include_year },
            after: input,
          }, client);
        });
        return reply(200, { ok: true });
      }
    }

    if (req.method === "GET" && path === "/v1/billing/settings/tax-rates") {
      const rows = await pool.query("SELECT * FROM billing_tax_rates WHERE org_id = $1 ORDER BY type = 'no_vat', type, effective_from DESC", [orgId]);
      const history = await vatHistory(pool, orgId);
      const today = todayInZa();
      return reply(200, {
        rates: rows.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          type: row.type,
          typeLabel: TAX_LABELS[row.type],
          rateBp: row.rate_bp,
          effectiveFrom: dateText(row.effective_from),
          effectiveTo: dateText(row.effective_to),
          sarsCode: row.sars_code,
          accountCode: row.account_code,
          current: dateText(row.effective_from) <= today && (!row.effective_to || dateText(row.effective_to) >= today),
        })),
        vat: vatOn(history, today),
        canManage: manage,
      });
    }

    const rateMatch = path.match(/^\/v1\/billing\/settings\/tax-rates\/(\d+)$/);
    if (rateMatch && req.method === "PUT") {
      if (!manage) return managerOnly();
      const body = await h.readJson(req);
      const accountCode = String(body.accountCode ?? "").trim().slice(0, 40);
      const updated = await pool.query("UPDATE billing_tax_rates SET account_code = $3 WHERE id = $1 AND org_id = $2 RETURNING id", [rateMatch[1], orgId, accountCode]);
      if (!updated.rows[0]) return reply(404, { error: "That tax rate was not found." });
      await audit("billing.tax_rate.update", "billing_tax_rate", rateMatch[1], { accountCode });
      return reply(200, { ok: true });
    }

    if (path === "/v1/billing/items") {
      if (req.method === "GET") {
        const all = url.searchParams.get("all") === "1";
        const rows = await pool.query(
          `SELECT * FROM billing_items WHERE org_id = $1 ${all ? "" : "AND active"} ORDER BY active DESC, lower(name)`,
          [orgId],
        );
        return reply(200, { items: rows.rows.map(itemView), types: ITEM_TYPES, units: ITEM_UNITS, taxTypes: TAX_TYPES, taxLabels: TAX_LABELS, canManage: manage });
      }
      if (req.method === "POST") {
        if (!manage) return managerOnly();
        const input = parseItem(await h.readJson(req));
        const inserted = await pool.query(
          `INSERT INTO billing_items (org_id, name, description, sku, type, unit, unit_price_cents, tax_type, account_code, cost_cents, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [orgId, input.name, input.description, input.sku, input.type, input.unit, input.unitPriceCents, input.taxType, input.accountCode, input.costCents, input.active],
        );
        await audit("billing.item.create", "billing_item", inserted.rows[0].id, input);
        return reply(201, { item: itemView(inserted.rows[0]) });
      }
    }

    const itemMatch = path.match(/^\/v1\/billing\/items\/(\d+)$/);
    if (itemMatch) {
      if (req.method === "GET") {
        const row = (await pool.query("SELECT * FROM billing_items WHERE id = $1 AND org_id = $2", [itemMatch[1], orgId])).rows[0];
        if (!row) return reply(404, { error: "That item was not found." });
        return reply(200, { item: itemView(row), types: ITEM_TYPES, units: ITEM_UNITS, taxTypes: TAX_TYPES, taxLabels: TAX_LABELS, canManage: manage });
      }
      if (req.method === "PUT") {
        if (!manage) return managerOnly();
        const input = parseItem(await h.readJson(req));
        const updated = await pool.query(
          `UPDATE billing_items SET name = $3, description = $4, sku = $5, type = $6, unit = $7, unit_price_cents = $8,
             tax_type = $9, account_code = $10, cost_cents = $11, active = $12, updated_at = now()
           WHERE id = $1 AND org_id = $2 RETURNING *`,
          [itemMatch[1], orgId, input.name, input.description, input.sku, input.type, input.unit, input.unitPriceCents, input.taxType, input.accountCode, input.costCents, input.active],
        );
        if (!updated.rows[0]) return reply(404, { error: "That item was not found." });
        await audit("billing.item.update", "billing_item", itemMatch[1], input);
        return reply(200, { item: itemView(updated.rows[0]) });
      }
    }

    if (req.method === "GET" && path === "/v1/billing/customers") {
      const rows = await pool.query(
        `SELECT c.*,
                COALESCE(sum(d.balance_cents) FILTER (WHERE d.kind = 'invoice' AND d.status IN ('issued', 'partially_paid')), 0)::bigint AS outstanding,
                COALESCE(sum(d.balance_cents) FILTER (WHERE d.kind = 'invoice' AND d.status IN ('issued', 'partially_paid') AND d.due_date < $2), 0)::bigint AS overdue,
                max(d.issue_date) FILTER (WHERE d.kind = 'invoice' AND d.status NOT IN ('draft', 'pending_approval')) AS last_invoice
         FROM customers c LEFT JOIN billing_documents d ON d.customer_id = c.id AND d.org_id = c.org_id
         WHERE c.org_id = $1 GROUP BY c.id ORDER BY lower(c.name)`,
        [orgId, todayInZa()],
      );
      return reply(200, {
        customers: rows.rows.map((row) => ({
          ...customerBillingView(row),
          outstandingCents: Number(row.outstanding),
          overdueCents: Number(row.overdue),
          lastInvoice: dateText(row.last_invoice),
        })),
        msp: hasFeature(license.entitlements, "invoicing_msp"),
        canManage: manage,
      });
    }

    if (req.method === "POST" && path === "/v1/billing/customers") {
      if (!manage) return managerOnly();
      const body = await h.readJson(req);
      const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
      if (!name) throw new BillingInputError("Enter the customer's name.");
      const input = parseCustomerBilling({ ...body, billingEmail: body.billingEmail ?? body.email });
      const id = await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('customer-name'), $1::int)", [orgId]);
        const taken = await client.query("SELECT 1 FROM customers WHERE org_id = $1 AND lower(name) = lower($2)", [orgId, name]);
        if (taken.rows[0]) throw new BillingInputError("A customer with that name already exists.", 409);
        const made = await client.query(
          `INSERT INTO customers (org_id, name, email, address, vat_status, vat_number, registered_name, billing_contact, billing_email, billing_cc,
             billing_address, payment_terms_days, billing_template, billing_reminders)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [orgId, name, input.billingEmail || null, input.billingAddress || null, input.vatStatus, input.vatNumber, input.registeredName, input.billingContact, input.billingEmail,
            input.billingCc, input.billingAddress, input.paymentTermsDays, input.billingTemplate, input.billingReminders],
        );
        const customerId = Number(made.rows[0].id);
        await client.query("INSERT INTO sites (org_id, customer_id, name) VALUES ($1, $2, 'Primary')", [orgId, customerId]);
        await audit("billing.customer.create", "customer", customerId, { name, vatStatus: input.vatStatus }, client);
        return customerId;
      });
      return reply(201, { id });
    }

    const customerMatch = path.match(/^\/v1\/billing\/customers\/(\d+)$/);
    if (customerMatch) {
      const row = (await pool.query("SELECT * FROM customers WHERE id = $1 AND org_id = $2", [customerMatch[1], orgId])).rows[0];
      if (!row) return reply(404, { error: "That customer was not found." });
      if (req.method === "GET") {
        return reply(200, { customer: customerBillingView(row), vatStatuses: VAT_STATUSES, templates: TEMPLATES, canManage: manage });
      }
      if (req.method === "PUT") {
        if (!manage) return managerOnly();
        const input = parseCustomerBilling(await h.readJson(req));
        await pool.query(
          `UPDATE customers SET vat_status = $3, vat_number = $4, registered_name = $5, billing_contact = $6, billing_email = $7,
             billing_cc = $8, billing_address = $9, payment_terms_days = $10, billing_template = $11, billing_reminders = $12, updated_at = now()
           WHERE id = $1 AND org_id = $2`,
          [customerMatch[1], orgId, input.vatStatus, input.vatNumber, input.registeredName, input.billingContact, input.billingEmail,
            input.billingCc, input.billingAddress, input.paymentTermsDays, input.billingTemplate, input.billingReminders],
        );
        await audit("billing.customer.update", "customer", customerMatch[1], { vatStatus: input.vatStatus, fields: Object.keys(input) });
        return reply(200, { ok: true });
      }
    }

    if (path === "/v1/billing/settings/logo") {
      if (req.method === "GET") {
        const row = (await pool.query(
          "SELECT f.content_type, f.data FROM billing_settings s JOIN billing_files f ON f.id = s.logo_file_id WHERE s.org_id = $1",
          [orgId],
        )).rows[0];
        return reply(200, { logo: row ? `data:${row.content_type};base64,${row.data.toString("base64")}` : null });
      }
      if (!manage) return managerOnly();
      if (req.method === "PUT") {
        const logo = parseLogo((await h.readJson(req, 1048576)).dataUrl);
        await tx(async (client) => {
          const file = await client.query(
            `INSERT INTO billing_files (org_id, purpose, file_name, content_type, size_bytes, sha256, data, created_by)
             VALUES ($1, 'logo', $2, $3, $4, $5, $6, $7) RETURNING id`,
            [orgId, `logo.${logo.extension}`, logo.contentType, logo.data.length, createHash("sha256").update(logo.data).digest("hex"), logo.data, actor.id],
          );
          await client.query("UPDATE billing_settings SET logo_file_id = $2, updated_by = $3, updated_at = now() WHERE org_id = $1", [orgId, file.rows[0].id, actor.id]);
          await audit("billing.logo.update", "billing_settings", orgId, { contentType: logo.contentType, bytes: logo.data.length }, client);
        });
        return reply(200, { ok: true });
      }
      if (req.method === "DELETE") {
        await pool.query("UPDATE billing_settings SET logo_file_id = NULL, updated_by = $2, updated_at = now() WHERE org_id = $1", [orgId, actor.id]);
        await audit("billing.logo.remove", "billing_settings", orgId, {});
        return reply(200, { ok: true });
      }
    }

    if (await handleDocuments(req, res, url, { orgId, actor, manage, license, h })) return true;

    return reply(404, { error: "Not found." });
  } catch (error) {
    if (error instanceof BillingInputError) return reply(error.status, { error: error.message });
    throw error;
  }
}
