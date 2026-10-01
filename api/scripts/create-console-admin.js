import { pool } from "../src/db.js";
import { hashPassword } from "../src/passwords.js";

const email = String(process.env.CONSOLE_ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.CONSOLE_ADMIN_PASSWORD || "";
const name = process.env.CONSOLE_ADMIN_NAME || "Digital Fingers admin";

if (!email || !password) {
  console.error("CONSOLE_ADMIN_EMAIL and CONSOLE_ADMIN_PASSWORD are required.");
  process.exit(1);
}

const org = await pool.query("SELECT id FROM orgs WHERE slug = 'digital-fingers'");
if (!org.rows[0]) {
  console.error("Digital Fingers org is missing.");
  process.exit(1);
}
const orgId = org.rows[0].id;
const role = await pool.query("SELECT id FROM roles WHERE org_id = $1 AND name = 'admin'", [orgId]);
if (!role.rows[0]) {
  console.error("Admin role is missing.");
  process.exit(1);
}

const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
let userId = existing.rows[0]?.id;
if (!userId) {
  const passwordHash = await hashPassword(password);
  const inserted = await pool.query(
    `INSERT INTO users (org_id, email, name, password_hash, is_platform_admin)
     VALUES ($1, $2, $3, $4, false)
     RETURNING id`,
    [orgId, email, name, passwordHash],
  );
  userId = inserted.rows[0].id;
  console.log("console admin created");
} else {
  console.log("console admin already exists");
}

await pool.query(
  `INSERT INTO user_roles (user_id, role_id)
   VALUES ($1, $2)
   ON CONFLICT DO NOTHING`,
  [userId, role.rows[0].id],
);

const operator = await pool.query(
  "SELECT id FROM users WHERE is_platform_admin = true ORDER BY id LIMIT 1",
);
const actorId = operator.rows[0]?.id || userId;
const audited = await pool.query(
  `SELECT id FROM audit_events
   WHERE action = 'user.create' AND target_type = 'user' AND target_id = $1`,
  [String(userId)],
);
if (!audited.rows[0]) {
  await pool.query(
    `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, 'user.create', 'user', $3, $4::jsonb)`,
    [orgId, actorId, String(userId), JSON.stringify({ role: "admin", email })],
  );
  console.log("audit row written");
}
await pool.end();
