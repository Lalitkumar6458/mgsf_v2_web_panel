import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { COOKIE_NAME } from "@/lib/auth.js";

export const POST = route(async ({ auth }) => {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, auth.sessionId));
  const res = NextResponse.json({ success: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
});
