// Mobile app: swap a still-valid login token for a fresh 30-day one (so a regular user never logs in again).
// The same session row is kept — one phone stays one phone in the panel's "App logins".
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { issueToken, deviceFrom } from "@/lib/auth.js";
import { clientIp } from "@/lib/access.js";
import { unauthorized } from "@/lib/errors.js";

export const POST = route(async ({ auth, request }) => {
  const acc = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, auth.accountId) });
  if (!acc || !acc.active) throw unauthorized("Login band hai");
  const { token, maxAge } = await issueToken(acc, { userAgent: request.headers.get("user-agent") || "", ip: clientIp(request), ...deviceFrom(request), sessionId: auth.sessionId });
  return { token, expiresAtMs: Date.now() + maxAge * 1000 };
});
