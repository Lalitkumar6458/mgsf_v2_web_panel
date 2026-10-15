import { eq, and, isNull, desc } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";

const { sessions } = schema;

/** Logged-in devices (old settings → Sessions) */
export const GET = route(async ({ auth }) => {
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.accountId, auth.accountId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt));
  return { sessions: rows.map((s) => ({ ...s, current: s.id === auth.sessionId })) };
});

/** DELETE ?id=… (one device) or ?all=1 (all other devices) */
export const DELETE = route(async ({ auth, query }) => {
  const id = query.get("id");
  const where = id
    ? and(eq(sessions.accountId, auth.accountId), eq(sessions.id, id))
    : eq(sessions.accountId, auth.accountId);
  const rows = await db.update(sessions).set({ revokedAt: new Date() }).where(where).returning({ id: sessions.id });
  return { success: true, revoked: rows.filter((r) => id || r.id !== auth.sessionId).length };
});
