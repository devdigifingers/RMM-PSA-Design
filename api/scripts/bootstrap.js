// Break-glass: creates a super admin from the server shell. Day-to-day, super admins invite people
// from Control → Team. Every use is written to the audit log.
import { pool } from "../src/db.js";
import { insertAudit } from "../src/audit.js";
import { hashPassword } from "../src/passwords.js";

const email = String(process.env.OPERATOR_EMAIL || "").trim().toLowerCase();
const password = process.env.OPERATOR_PASSWORD || "";
const name = process.env.OPERATOR_NAME || "Platform operator";

if (!email || !password) {
  console.error("OPERATOR_EMAIL and OPERATOR_PASSWORD are required.");
  process.exit(1);
}

const existing = await pool.query("SELECT id FROM users WHERE lower(email) = $1", [email]);
if (existing.rows[0]) {
  console.log("that email already has a login; nothing changed");
  await pool.end();
  process.exit(0);
}

const passwordHash = await hashPassword(password);
const created = await pool.query(
  `INSERT INTO users (email, name, password_hash, is_platform_admin, platform_role, platform_mfa_due_at)
   VALUES ($1, $2, $3, true, 'super', now())
   RETURNING id`,
  [email, name, passwordHash],
);
const userId = Number(created.rows[0].id);
await insertAudit(pool, null, null, "platform.bootstrap", "user", userId, { email, role: "super", via: "server shell" });
await pool.end();
console.log("super admin created; MFA setup is required at first sign-in");
