import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route } from "@/lib/http.js";

export const GET = route(async () => {
  await db.execute(sql`SELECT 1`);
  return { ok: true, time: new Date().toISOString() };
}, { auth: false });
