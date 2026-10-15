import { eq, and, ne } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { verifyPassword, hashPassword } from "@/lib/auth.js";
import { badRequest } from "@/lib/errors.js";

/** POST { oldPassword, newPassword, logoutOthers? } */
export const POST = route(async ({ request, auth }) => {
  const { oldPassword, newPassword, logoutOthers = true } = await readJson(request);
  if (!newPassword || String(newPassword).length < 6) throw badRequest("New password must be 6+ characters");
  const acc = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, auth.accountId) });
  if (!(await verifyPassword(oldPassword, acc.passwordHash))) throw badRequest("Old password is wrong");
  await db.update(schema.accounts).set({ passwordHash: await hashPassword(newPassword) }).where(eq(schema.accounts.id, acc.id));
  if (logoutOthers) {
    await db.update(schema.sessions).set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.accountId, acc.id), ne(schema.sessions.id, auth.sessionId)));
  }
  return { success: true };
});
