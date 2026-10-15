// Apply SQL migrations in ./drizzle to DATABASE_URL  (npm run db:migrate)
// Prints which migrations were applied now, so it is clear the database is up to date.
import pg from "pg";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL || "";
const pool = new pg.Pool({ connectionString: url });
const count = async () => {
  try { return (await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows[0].n; } catch { return 0; }
};
try {
  const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries;
  console.log(`Database: ${url.replace(/\/\/[^@]*@/, "//***@")}`);
  const before = await count();
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  const after = await count();
  const applied = journal.slice(before, after).map((e) => e.tag);
  if (applied.length) applied.forEach((t) => console.log(`  ✔ applied ${t}`));
  else console.log("  (nothing new to apply)");
  console.log(`✔ database is up to date — ${after}/${journal.length} migrations`);
} catch (e) {
  console.error("✖ migration failed:", e?.cause?.message || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
