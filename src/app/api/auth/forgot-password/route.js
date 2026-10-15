import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { sendOtp } from "@/lib/otp.js";
import { badRequest } from "@/lib/errors.js";

/** POST { email } — e-mails a reset OTP (admins / agents). Always answers success so emails can't be probed. */
export const POST = route(async ({ request }) => {
  const { email } = await readJson(request);
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) throw badRequest("Valid email required");
  const acc = await db.query.accounts.findFirst({ where: eq(schema.accounts.loginId, e) });
  let extra = {};
  if (acc?.active) extra = await sendOtp(e, "reset");
  return { success: true, ...extra };
}, { auth: false });
