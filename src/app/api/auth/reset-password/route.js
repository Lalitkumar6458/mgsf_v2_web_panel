import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { verifyOtp } from "@/lib/otp.js";
import { hashPassword } from "@/lib/auth.js";
import { badRequest } from "@/lib/errors.js";
import { forgetAgentPassword } from "@/services/agents.js";

/** POST { email, otp, newPassword } — set a new password with the e-mailed OTP; logs out all devices. */
export const POST = route(async ({ request }) => {
  const { email, otp, newPassword } = await readJson(request);
  const e = String(email || "").trim().toLowerCase();
  if (!newPassword || String(newPassword).length < 6) throw badRequest("Password must be 6+ characters");
  const acc = await db.query.accounts.findFirst({ where: eq(schema.accounts.loginId, e) });
  if (!acc || !acc.active) throw badRequest("Wrong OTP");
  await verifyOtp(e, otp, "reset");
  await db.update(schema.accounts).set({ passwordHash: await hashPassword(newPassword) }).where(eq(schema.accounts.id, acc.id));
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.accountId, acc.id));
  if (acc.agentId) await forgetAgentPassword(acc.agentId, "agent");
  return { success: true };
}, { auth: false });
