import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { verifyPassword, issueToken, COOKIE_NAME } from "@/lib/auth.js";
import { sendOtp, verifyOtp } from "@/lib/otp.js";
import { unauthorized, badRequest } from "@/lib/errors.js";
import { clientIp } from "@/lib/access.js";

/**
 * POST { loginId, password, otp? }
 * loginId = email (admin / agent) or registration number (member).
 * Admins need an e-mail OTP as 2nd step when ADMIN_LOGIN_OTP=1 → first call returns { otpRequired: true }.
 */
export const POST = route(async ({ request }) => {
  const { loginId, password, otp } = await readJson(request);
  if (!loginId || !password) throw badRequest("loginId and password required");
  const acc = await db.query.accounts.findFirst({ where: eq(schema.accounts.loginId, String(loginId).trim().toLowerCase()) });
  if (!acc || !acc.active || !(await verifyPassword(password, acc.passwordHash))) throw unauthorized("Wrong login id or password");

  if ((acc.role === "admin" || acc.role === "owner") && process.env.ADMIN_LOGIN_OTP === "1") {
    if (!otp) return { success: true, otpRequired: true, ...(await sendOtp(acc.email || acc.loginId)) };
    await verifyOtp(acc.email || acc.loginId, otp);
  }

  const { token, maxAge } = await issueToken(acc, { userAgent: request.headers.get("user-agent") || "", ip: clientIp(request) });
  const res = NextResponse.json({
    success: true,
    token, // mobile app keeps this in SecureStore and sends "Authorization: Bearer"
    user: { id: acc.id, role: acc.role, displayName: acc.displayName, adminId: acc.adminId, agentId: acc.agentId, memberId: acc.memberId },
  });
  res.cookies.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
  return res;
}, { auth: false });
