import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { programFields } from "@/services/programs.js";
import { conflict } from "@/lib/errors.js";

export const GET = route(async ({ auth, params }) => ({ program: await getProgramFor(auth, params.programId) }));

export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const f = programFields(await readJson(request));
  if (f.isSelected) await db.update(schema.programs).set({ isSelected: false }).where(eq(schema.programs.adminId, p.adminId));
  const [out] = await db.update(schema.programs).set(f).where(eq(schema.programs.id, p.id)).returning();
  return { success: true, program: out };
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const { rows: [r] } = await db.execute(sql`SELECT count(*)::int n FROM members WHERE program_id = ${p.id} AND NOT deleted`);
  if (r.n > 0) throw conflict(`Program has ${r.n} members — it cannot be deleted`);
  await db.delete(schema.programs).where(eq(schema.programs.id, p.id));
  return { success: true };
});
