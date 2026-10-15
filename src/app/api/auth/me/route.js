import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";

export const GET = route(async ({ auth }) => {
  const out = { user: auth };
  if (auth.adminId) out.trust = await db.query.admins.findFirst({ where: eq(schema.admins.id, auth.adminId) });
  if (auth.agentId) out.agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, auth.agentId) });
  if (auth.memberId) out.member = await db.query.members.findFirst({ where: eq(schema.members.id, auth.memberId) });
  return out;
});

/** PATCH { pushToken } — mobile app registers its Expo push token */
export const PATCH = route(async ({ request, auth }) => {
  const { pushToken } = await readJson(request);
  await db.update(schema.accounts).set({ pushToken: pushToken || null }).where(eq(schema.accounts.id, auth.accountId));
  return { success: true };
});
