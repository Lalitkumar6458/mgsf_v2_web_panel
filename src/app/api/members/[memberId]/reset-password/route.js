import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getMemberFor, hashPassword } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { defaultMemberPassword } from "@/lib/regNumber.js";
import { notFound } from "@/lib/errors.js";

/** POST { password? } — admin resets a member's login (default = old rule name+birth year) */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const m = await getMemberFor(auth, params.memberId, { forWrite: true });
  const { password } = await readJson(request);
  const pwd = password || defaultMemberPassword(m.displayName, m.birthDate);
  const rows = await db.update(schema.accounts).set({ passwordHash: await hashPassword(pwd), active: true })
    .where(eq(schema.accounts.memberId, m.id)).returning({ id: schema.accounts.id });
  if (!rows.length) throw notFound("Member has no login yet (accept the member first)");
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.accountId, rows[0].id));
  return { success: true, loginId: m.registrationNumber, password: pwd };
});
