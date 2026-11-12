import { pool } from "../db.js";
import { vatRegisteredOn } from "./sars.js";

export function todayInZa(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function dateText(value) {
  if (!value) return null;
  return value instanceof Date ? todayInZa(value) : String(value).slice(0, 10);
}

export async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function vatHistory(db, orgId) {
  const rows = await db.query(
    "SELECT id, vat_registered, vat_number, effective_from, created_at FROM billing_vat_registrations WHERE org_id = $1 ORDER BY effective_from",
    [orgId],
  );
  return rows.rows.map((row) => ({
    id: Number(row.id),
    registered: row.vat_registered,
    vatNumber: row.vat_number,
    effectiveFrom: dateText(row.effective_from),
    createdAt: row.created_at,
  }));
}

export function vatOn(history, date) {
  const registered = vatRegisteredOn(history, date);
  const record = [...history].reverse().find((entry) => entry.effectiveFrom <= date);
  return { registered, vatNumber: registered ? record?.vatNumber || null : null };
}

// Invoices issued and emails sent this calendar month (Africa/Johannesburg), against the package limits.
export async function monthlyUsage(db, orgId, limits = {}) {
  const month = `${todayInZa().slice(0, 7)}-01`;
  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM billing_documents WHERE org_id = $1 AND kind = 'invoice' AND issued_at >= ($2::date AT TIME ZONE 'Africa/Johannesburg')) AS invoices,
       (SELECT count(*)::int FROM billing_messages WHERE org_id = $1 AND status IN ('sent', 'delivered') AND created_at >= ($2::date AT TIME ZONE 'Africa/Johannesburg')) AS emails`,
    [orgId, month],
  );
  const row = counts.rows[0];
  return {
    invoices: { used: row.invoices, limit: limits.invoicesPerMonth ?? null },
    emails: { used: row.emails, limit: limits.emailsPerMonth ?? null },
  };
}
