import { pool } from "../src/db.js";
import { hashPassword } from "../src/passwords.js";

const email = String(process.env.OPERATOR_EMAIL || "").trim().toLowerCase();
const password = process.env.OPERATOR_PASSWORD || "";
const name = process.env.OPERATOR_NAME || "Platform operator";

if (!email || !password) {
  console.error("OPERATOR_EMAIL and OPERATOR_PASSWORD are required.");
  process.exit(1);
}

const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
if (existing.rows[0]) {
  console.log("operator already exists");
  await pool.end();
  process.exit(0);
}

const passwordHash = await hashPassword(password);
await pool.query(
  `INSERT INTO users (email, name, password_hash, is_platform_admin)
   VALUES ($1, $2, $3, true)`,
  [email, name, passwordHash],
);
await pool.end();
console.log("operator created");
