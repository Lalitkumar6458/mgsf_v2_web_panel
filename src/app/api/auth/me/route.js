import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";

export const GET = route(async ({ auth }) => {
  const out = { user: auth };
  if (auth.adminId) out.trust = await db.query.admins.findFirst({ where: eq(schema.admins.id, auth.adminId) });
  if (auth.agentId) out.agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, auth.agentId) });
  if (auth.memberId) out.member = await db.query.members.findFirst({ where: eq(schema.members.id, auth.memberId) });
  return out;
});

/** PATCH { pushToken } — mobile app registers its Expo push token (kept per phone = per session) */
export const PATCH = route(async ({ request, auth }) => {
  const { pushToken } = await readJson(request);
  const t = pushToken ? String(pushToken).slice(0, 200) : null;
  if (t) {
    // a phone has one token and the app holds one login: older logins with this token are this same
    // phone — end them, so a phone is counted once in "App logins" and gets each push once
    await db.execute(sql`UPDATE sessions SET push_token = NULL, revoked_at = coalesce(revoked_at, now()) WHERE push_token = ${t} AND id <> ${auth.sessionId}`);
    await db.execute(sql`UPDATE accounts SET push_token = NULL WHERE push_token = ${t} AND id <> ${auth.accountId}`);
  }
  await db.update(schema.sessions).set({ pushToken: t }).where(eq(schema.sessions.id, auth.sessionId));
  await db.update(schema.accounts).set({ pushToken: t }).where(eq(schema.accounts.id, auth.accountId));
  return { success: true };
});
