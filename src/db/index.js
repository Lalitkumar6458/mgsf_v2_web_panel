import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// Return DATE columns as "YYYY-MM-DD" strings (default would be a local-timezone Date → off-by-one bugs)
pg.types.setTypeParser(1082, (v) => v);

// One pool per process (safe with Next.js dev hot-reload)
const g = globalThis;
export const pool =
  g.__mgsfPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX || 10),
  });
if (process.env.NODE_ENV !== "production") g.__mgsfPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
