import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql");
const sql = await readFile(schemaPath, "utf8");
await pool.query(sql);
await pool.end();
console.log("schema applied");
