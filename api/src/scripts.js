import { pool } from "./db.js";
import { insertAudit } from "./audit.js";
import { JOB_BODY_LIMIT } from "./job-input.js";
import { BUILTIN_SCRIPTS, FIX_TYPES, RISKS, SHELLS, builtinScript, parseScriptInput, scriptView } from "./script-library.js";

function reply(h, res, status, body) {
  h.send(res, status, body);
  return true;
}

const SELECT_SQL = `SELECT s.*, u.name AS created_by_name FROM scripts s LEFT JOIN users u ON u.id = s.created_by`;

export async function orgScript(db, orgId, ref) {
  const builtin = builtinScript(ref);
  if (builtin) return scriptView(builtin);
  if (!/^\d+$/.test(String(ref))) return null;
  const found = await db.query(`${SELECT_SQL} WHERE s.id = $1 AND s.org_id = $2 AND s.archived_at IS NULL`, [ref, orgId]);
  return found.rows[0] ? scriptView(found.rows[0]) : null;
}

function taken(error) {
  return error?.code === "23505";
}

async function copyName(orgId, name) {
  const base = `${name.slice(0, 70)} (copy)`;
  const names = await pool.query(
    "SELECT lower(name) AS name FROM scripts WHERE org_id = $1 AND archived_at IS NULL AND lower(name) LIKE lower($2) || '%'",
    [orgId, base.slice(0, -1)],
  );
  const used = new Set(names.rows.map((row) => row.name));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const next = `${name.slice(0, 66)} (copy ${n})`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return `${name.slice(0, 60)} (copy ${Date.now() % 100000})`;
}

async function insertScript(actor, input) {
  return pool.query(
    `INSERT INTO scripts (org_id, name, description, shell, body, parameters, risk, fixes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) RETURNING id`,
    [actor.org_id, input.name, input.description, input.shell, input.body, JSON.stringify(input.parameters), input.risk, input.fixes, actor.id],
  );
}

// Remote Desk → Settings → Script library. Everyone in the organisation can read it; owners and admins change it.
export async function handleScripts(req, res, url, actor, h) {
  if (url.pathname !== "/v1/scripts" && !url.pathname.startsWith("/v1/scripts/")) return false;
  if (!h.requireActor(actor, res)) return true;
  if (!actor.org_id) return reply(h, res, 403, { error: "This account is not in an org." });
  const license = await h.licenseQuery(actor.org_id);
  if (!h.hasApp(license.rows[0]?.entitlements, "remote")) {
    return reply(h, res, 403, { error: "The script library needs Remote Desk.", code: "app_not_entitled", app: "remote" });
  }
  const manage = h.canOperate(actor);
  const denied = () => reply(h, res, 403, { error: "Only an owner or admin can change the script library." });

  if (req.method === "GET" && url.pathname === "/v1/scripts") {
    const own = await pool.query(`${SELECT_SQL} WHERE s.org_id = $1 AND s.archived_at IS NULL ORDER BY lower(s.name)`, [actor.org_id]);
    return reply(h, res, 200, {
      scripts: [...own.rows.map(scriptView), ...BUILTIN_SCRIPTS.map(scriptView)],
      shells: SHELLS,
      risks: RISKS,
      fixTypes: FIX_TYPES,
      canManage: manage,
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/scripts") {
    if (!manage) return denied();
    const parsed = parseScriptInput(await h.readJson(req, JOB_BODY_LIMIT));
    if (parsed.error) return reply(h, res, 400, { error: parsed.error });
    try {
      const made = await insertScript(actor, parsed.value);
      const id = String(made.rows[0].id);
      await insertAudit(pool, actor.org_id, actor.id, "script.create", "script", id, { name: parsed.value.name, shell: parsed.value.shell, risk: parsed.value.risk });
      return reply(h, res, 201, { id: Number(id), ref: id });
    } catch (error) {
      if (taken(error)) return reply(h, res, 409, { error: "A script with that name already exists." });
      throw error;
    }
  }

  const duplicate = url.pathname.match(/^\/v1\/scripts\/([a-z0-9-]{1,40})\/duplicate$/);
  if (req.method === "POST" && duplicate) {
    if (!manage) return denied();
    const source = await orgScript(pool, actor.org_id, duplicate[1]);
    if (!source) return reply(h, res, 404, { error: "Script not found." });
    const input = { ...source, name: await copyName(actor.org_id, source.name) };
    try {
      const made = await insertScript(actor, input);
      const id = String(made.rows[0].id);
      await insertAudit(pool, actor.org_id, actor.id, "script.create", "script", id, { name: input.name, shell: input.shell, risk: input.risk, copiedFrom: source.ref });
      return reply(h, res, 201, { id: Number(id), ref: id });
    } catch (error) {
      if (taken(error)) return reply(h, res, 409, { error: "A script with that name already exists." });
      throw error;
    }
  }

  const one = url.pathname.match(/^\/v1\/scripts\/([a-z0-9-]{1,40})$/);
  if (!one) return reply(h, res, 404, { error: "Not found." });

  if (req.method === "GET") {
    const script = await orgScript(pool, actor.org_id, one[1]);
    if (!script) return reply(h, res, 404, { error: "Script not found." });
    return reply(h, res, 200, { script, shells: SHELLS, risks: RISKS, fixTypes: FIX_TYPES, canManage: manage });
  }

  if (req.method === "PUT") {
    if (!manage) return denied();
    if (builtinScript(one[1])) return reply(h, res, 400, { error: "Built-in scripts cannot be changed. Duplicate it to make your own copy." });
    if (!/^\d+$/.test(one[1])) return reply(h, res, 404, { error: "Script not found." });
    const parsed = parseScriptInput(await h.readJson(req, JOB_BODY_LIMIT));
    if (parsed.error) return reply(h, res, 400, { error: parsed.error });
    const input = parsed.value;
    try {
      const saved = await pool.query(
        `UPDATE scripts SET name = $3, description = $4, shell = $5, body = $6, parameters = $7::jsonb, risk = $8, fixes = $9, updated_at = now()
         WHERE id = $1 AND org_id = $2 AND archived_at IS NULL RETURNING id`,
        [one[1], actor.org_id, input.name, input.description, input.shell, input.body, JSON.stringify(input.parameters), input.risk, input.fixes],
      );
      if (!saved.rows[0]) return reply(h, res, 404, { error: "Script not found." });
      await insertAudit(pool, actor.org_id, actor.id, "script.update", "script", one[1], { name: input.name, shell: input.shell, risk: input.risk });
      return reply(h, res, 200, { ok: true });
    } catch (error) {
      if (taken(error)) return reply(h, res, 409, { error: "A script with that name already exists." });
      throw error;
    }
  }

  if (req.method === "DELETE") {
    if (!manage) return denied();
    if (builtinScript(one[1])) return reply(h, res, 400, { error: "Built-in scripts cannot be removed." });
    if (!/^\d+$/.test(one[1])) return reply(h, res, 404, { error: "Script not found." });
    const archived = await pool.query(
      "UPDATE scripts SET archived_at = now() WHERE id = $1 AND org_id = $2 AND archived_at IS NULL RETURNING name",
      [one[1], actor.org_id],
    );
    if (!archived.rows[0]) return reply(h, res, 404, { error: "Script not found." });
    await insertAudit(pool, actor.org_id, actor.id, "script.archive", "script", one[1], { name: archived.rows[0].name });
    return reply(h, res, 200, { ok: true });
  }

  return reply(h, res, 405, { error: "Method not allowed." });
}
