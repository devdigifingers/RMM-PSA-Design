import { pool } from "../src/db.js";
import { hashPassword } from "../src/passwords.js";

const email = String(process.env.TECH_EMAIL || "").trim().toLowerCase();
const password = process.env.TECH_PASSWORD || "";
const name = process.env.TECH_NAME || "Digital Fingers tech";

if (!email || !password) {
  console.error("TECH_EMAIL and TECH_PASSWORD are required.");
  process.exit(1);
}

const org = await pool.query("SELECT id FROM orgs WHERE slug = 'digital-fingers'");
if (!org.rows[0]) {
  console.error("Digital Fingers org is missing.");
  process.exit(1);
}
const orgId = org.rows[0].id;
const role = await pool.query("SELECT id FROM roles WHERE org_id = $1 AND name = 'tech'", [orgId]);
const admin = await pool.query("SELECT id FROM roles WHERE org_id = $1 AND name = 'admin'", [orgId]);
if (!role.rows[0] || !admin.rows[0]) {
  console.error("Org roles are missing.");
  process.exit(1);
}

await pool.query(
  `INSERT INTO user_roles (user_id, role_id)
   SELECT u.id, $2
   FROM users u
   WHERE u.email = 'console@digitalfingers.co.za' AND u.org_id = $1
   ON CONFLICT DO NOTHING`,
  [orgId, admin.rows[0].id],
);

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
  console.log("tech created");
} else {
  console.log("tech already exists");
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
    [orgId, actorId, String(userId), JSON.stringify({ role: "tech" })],
  );
  console.log("audit row written");
}
await pool.end();
