// Usage: node scripts/license-backfill.js [--apply | --verify]
// With no flag it is a dry run: it prints the per-tenant plan and writes nothing.
import { pool } from "../src/db.js";
import { effectiveDiff, legacyEffective, planBackfill, resolve } from "../src/licensing.js";
import {
  currentAssignment,
  describeAssignment,
  loadPackages,
  loadTenantLicenses,
  syncPackageFromLegacy,
} from "../src/license-store.js";

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply") ? "apply" : args.has("--verify") ? "verify" : "dry-run";

async function applyTenant(orgId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await syncPackageFromLegacy(client, orgId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const now = new Date();
  const packages = await loadPackages(pool);
  const tenants = await loadTenantLicenses(pool);
  let problems = 0;
  console.log(`License backfill: ${mode}, ${tenants.length} tenant(s)\n`);

  for (const row of tenants) {
    const label = `#${row.org_id} ${row.name} (${row.slug})`;
    const legacy = legacyEffective(row, now);
    if (mode === "verify") {
      const current = currentAssignment(row, packages);
      if (!current) {
        problems += 1;
        console.log(`DIFF ${label}: no package assigned`);
        continue;
      }
      const diffs = effectiveDiff(legacy, resolve(current.package, current.license, now));
      if (diffs.length) problems += 1;
      console.log(`${diffs.length ? "DIFF" : "OK  "} ${label}: ${describeAssignment(current)}`);
      for (const diff of diffs) console.log(`       ${diff.field}: old ${JSON.stringify(diff.before)} new ${JSON.stringify(diff.after)}`);
      continue;
    }

    const before = currentAssignment(row, packages);
    const plan = mode === "apply" ? (await applyTenant(row.org_id)).plan : planBackfill(row, packages);
    const diffs = effectiveDiff(legacy, resolve(plan.package, plan.license, now));
    if (diffs.length) problems += 1;
    console.log(`${diffs.length ? "DIFF" : "OK  "} ${label}`);
    console.log(`       old: ${legacy.features.join(", ") || "no features"}; seats ${legacy.seats}, devices ${legacy.devices}, sessions ${legacy.sessions}, ${legacy.status}`);
    console.log(`       now: ${describeAssignment(before)}`);
    console.log(`       ${mode === "apply" ? "set" : "plan"}: ${describeAssignment(plan)}${plan.customPackage ? " (custom package)" : ""}`);
    for (const diff of diffs) console.log(`       ${diff.field}: old ${JSON.stringify(diff.before)} new ${JSON.stringify(diff.after)}`);
  }

  console.log(`\n${problems ? `${problems} tenant(s) differ` : "0 differences"}`);
  return problems;
}

try {
  const problems = await main();
  process.exitCode = problems ? 1 : 0;
} finally {
  await pool.end();
}
