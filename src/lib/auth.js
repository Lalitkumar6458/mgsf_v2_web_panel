// Auth without Firebase: bcrypt password hashes + signed JWT (jose).
// Web panel: token in an httpOnly cookie. Mobile app: "Authorization: Bearer <token>".
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { unauthorized, forbidden, notFound } from "./errors.js";
import { FULL_ACCESS, normalizePermissions } from "./permissions.js";

export const COOKIE_NAME = "mgsf_token";
const TOKEN_DAYS = 30;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export const hashPassword = (plain) => bcrypt.hash(String(plain), 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(String(plain ?? ""), hash || "");

export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
export const sixDigitCode = () => String(randomInt(100000, 1000000));

/** Create a session row + signed token for an account. */
export async function issueToken(account, { userAgent = "", ip = "" } = {}) {
  const [session] = await db
    .insert(schema.sessions)
    .values({ accountId: account.id, userAgent: String(userAgent).slice(0, 300), ip: String(ip).slice(0, 60) })
    .returning();
  await db.update(schema.accounts).set({ lastLoginAt: new Date() }).where(eq(schema.accounts.id, account.id));
  const token = await new SignJWT({ sid: session.id, role: account.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(account.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_DAYS}d`)
    .sign(secret());
  return { token, sessionId: session.id, maxAge: TOKEN_DAYS * 86400 };
}

function readToken(request) {
  const h = request.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Verify the request and return the caller:
 * { accountId, sessionId, role, adminId, agentId, memberId, displayName }
 * adminId is the trust the caller works in (for an admin: their own trust).
 */
export async function getAuth(request) {
  const token = readToken(request);
  if (!token) throw unauthorized();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret()));
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  const session = payload.sid
    ? await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, String(payload.sid)),
      })
    : null;
  const account = session
    ? await db.query.accounts.findFirst({ where: eq(schema.accounts.id, session.accountId) })
    : null;
  if (session) session.account = account;
  if (!session || session.revokedAt || !session.account?.active || session.accountId !== payload.sub) {
    throw unauthorized("Session expired");
  }
  // touch at most once per 10 minutes
  if (Date.now() - session.lastSeenAt.getTime() > 600000) {
    db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, session.id)).catch(() => {});
  }
  const a = session.account;
  // trust staff: super admin (no role) or a custom role's permissions
  let access = a.role === "owner" ? { isSuper: true, permissions: FULL_ACCESS, roleName: "Owner" } : null;
  if (a.role === "admin") {
    if (!a.roleId) access = { isSuper: true, permissions: FULL_ACCESS, roleName: "Super Admin" };
    else {
      const r = await db.query.roles.findFirst({ where: eq(schema.roles.id, a.roleId) });
      access = { isSuper: false, permissions: normalizePermissions(r?.permissions), roleName: r?.name || "No role", roleId: a.roleId };
    }
  }
  return {
    access,
    accountId: a.id,
    sessionId: session.id,
    role: a.role,
    adminId: a.adminId,
    agentId: a.agentId,
    memberId: a.memberId,
    displayName: a.displayName,
  };
}

export function requireRole(auth, ...roles) {
  if (!roles.includes(auth.role)) throw forbidden();
  return auth;
}

/** Load a program and make sure the caller's trust owns it. */
export async function getProgramFor(auth, programId) {
  if (!programId) throw notFound("programId required");
  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, programId) });
  if (!program) throw notFound("Program not found");
  if (auth.role !== "owner" && program.adminId !== auth.adminId) throw forbidden();
  return program;
}

/** Load a member and check the caller may see it (admin of the trust, its agent, or the member himself). */
export async function getMemberFor(auth, memberId, { forWrite = false } = {}) {
  const member = await db.query.members.findFirst({ where: eq(schema.members.id, memberId) });
  if (!member) throw notFound("Member not found");
  member.program = await db.query.programs.findFirst({ where: eq(schema.programs.id, member.programId) });
  if (auth.role === "owner") return member;
  if (member.program.adminId !== auth.adminId) throw forbidden();
  if (auth.role === "agent" && member.agentId !== auth.agentId) throw forbidden();
  if (auth.role === "member" && (forWrite || member.id !== auth.memberId)) throw forbidden();
  return member;
}
