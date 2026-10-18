import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { COOKIE_NAME } from "@/lib/auth.js";

export const POST = route(async ({ auth }) => {
  // this phone stops getting push too
  await db.execute(sql`
    UPDATE accounts a SET push_token = NULL FROM sessions s
    WHERE s.id = ${auth.sessionId} AND a.id = s.account_id AND s.push_token IS NOT NULL AND a.push_token = s.push_token`);
  await db.update(schema.sessions).set({ revokedAt: new Date(), pushToken: null }).where(eq(schema.sessions.id, auth.sessionId));
  const res = NextResponse.json({ success: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
});
