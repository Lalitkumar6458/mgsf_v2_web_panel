import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { programFields, membersOnBooks } from "@/services/programs.js";
import { normalizeCountDisplay, displayCount } from "@/lib/memberCountDisplay.js";
import { conflict } from "@/lib/errors.js";

export const GET = route(async ({ auth, params }) => {
  const program = await getProgramFor(auth, params.programId);
  const totalMembers = await membersOnBooks(program.id);
  return { program: { ...program, totalMembers, displayMembers: displayCount(totalMembers, auth.features?.countDisplay === false ? null : program.extra?.countDisplay) } };
});

export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const f = programFields(await readJson(request));
  if (f.extra) {
    // member count display: a "fixed" start remembers how many real members there were when it was set
    const cd = f.extra.countDisplay !== undefined ? f.extra.countDisplay : p.extra?.countDisplay;
    f.extra = { ...f.extra, countDisplay: normalizeCountDisplay(cd, p.extra?.countDisplay, await membersOnBooks(p.id)) };
  }
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
