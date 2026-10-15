// OTPs stored hashed in Postgres (old code: in-memory Map → lost on every restart / instance)
import { and, eq, gt, isNull, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { sha256, sixDigitCode } from "./auth.js";
import { sendMail } from "./mail.js";
import { badRequest } from "./errors.js";

const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

export async function sendOtp(email, purpose = "login") {
  const code = sixDigitCode();
  await db.insert(schema.otps).values({
    email, purpose, codeHash: sha256(`${email}:${code}`), expiresAt: new Date(Date.now() + TTL_MIN * 60000),
  });
  await sendMail({
    to: email,
    subject: "Login OTP",
    text: `Aapka OTP ${code} hai. Ye ${TTL_MIN} minute tak valid hai.`,
    html: `<p>Aapka OTP <b style="font-size:20px">${code}</b> hai.</p><p>Ye ${TTL_MIN} minute tak valid hai.</p>`,
  });
  return process.env.NODE_ENV === "production" ? {} : { devCode: code };
}

export async function verifyOtp(email, code, purpose = "login") {
  const { otps } = schema;
  const row = await db.query.otps.findFirst({
    where: and(eq(otps.email, email), eq(otps.purpose, purpose), isNull(otps.usedAt), gt(otps.expiresAt, new Date())),
    orderBy: desc(otps.createdAt),
  });
  if (!row) throw badRequest("OTP expired, request a new one");
  if (row.attempts >= MAX_ATTEMPTS) throw badRequest("Too many wrong attempts, request a new OTP");
  if (row.codeHash !== sha256(`${email}:${String(code).trim()}`)) {
    await db.update(otps).set({ attempts: row.attempts + 1 }).where(eq(otps.id, row.id));
    throw badRequest("Wrong OTP");
  }
  await db.update(otps).set({ usedAt: new Date() }).where(eq(otps.id, row.id));
  return true;
}
