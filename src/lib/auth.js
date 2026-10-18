// Auth without Firebase: bcrypt password hashes + signed JWT (jose).
// Web panel: token in an httpOnly cookie. Mobile app: "Authorization: Bearer <token>".
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomInt } from "node:crypto";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { unauthorized, forbidden, notFound, HttpError } from "./errors.js";
import { FULL_ACCESS, normalizePermissions } from "./permissions.js";
import { disabledModules, DEFAULT_BLOCK_MESSAGE, planState, EXPIRED_MESSAGE, hasSupport } from "./features.js";
import { getTrustFeatures } from "../services/features.js";

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

/** The mobile app tells which phone it is (headers X-Device / X-Platform / X-App-Version). */
export function deviceFrom(request) {
  const h = (k, n) => String(request.headers.get(k) || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
  return { device: h("x-device", 80), platform: h("x-platform", 40), appVersion: h("x-app-version", 20) };
}

/**
 * Signed token for an account. New login → a new session row (one row = one phone / browser).
 * sessionId given (the app renewing its login) → the SAME row is reused, so a phone stays one phone.
 */
export async function issueToken(account, { userAgent = "", ip = "", device = "", platform = "", appVersion = "", sessionId = null } = {}) {
  const info = {
    userAgent: String(userAgent).slice(0, 300), ip: String(ip).slice(0, 60),
    ...(device ? { device } : {}), ...(platform ? { platform } : {}), ...(appVersion ? { appVersion } : {}),
  };
  let session = null;
  if (sessionId) {
    [session] = await db.update(schema.sessions).set({ ...info, lastSeenAt: new Date() })
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.accountId, account.id), isNull(schema.sessions.revokedAt)))
      .returning();
  }
  if (!session) {
    [session] = await db.insert(schema.sessions).values({ accountId: account.id, ...info }).returning();
    await db.update(schema.accounts).set({ lastLoginAt: new Date() }).where(eq(schema.accounts.id, account.id));
  }
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
  // feature lock of the trust (secret /feature-control page) — owner is never limited
  const features = a.role !== "owner" && a.adminId ? await getTrustFeatures(a.adminId) : null;
  const block = loginBlock(a, features);
  if (block) throw await blockedError(401, a, features, block);
  // trust staff: super admin (no role) or a custom role's permissions
  let access = a.role === "owner" ? { isSuper: true, permissions: FULL_ACCESS, roleName: "Owner" } : null;
  if (a.role === "admin") {
    if (!a.roleId) access = { isSuper: true, permissions: FULL_ACCESS, roleName: "Super Admin" };
    else {
      const r = await db.query.roles.findFirst({ where: eq(schema.roles.id, a.roleId) });
      access = { isSuper: false, permissions: normalizePermissions(r?.permissions), roleName: r?.name || "No role", roleId: a.roleId };
    }
    // screens the developer switched off: closed for this trust's super admin too
    access.off = disabledModules(features);
    access.features = features.flags;
    const plan = planState(features);
    // warning popup + banner in the panel, with the renew contact from /feature-control
    if (plan.warn) access.plan = { expiresAt: plan.expiresAt, daysLeft: plan.daysLeft, support: hasSupport(features.support) ? features.support : null };
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
    features: features?.flags || null,
  };
}

/**
 * Feature lock at login: whole panel closed, or agent / member logins switched off.
 * Returns the message to show, or null. Used by getAuth() and the login route.
 */
export function loginBlock(account, features) {
  if (!features || account.role === "owner") return null;
  if (!features.active) return features.message || DEFAULT_BLOCK_MESSAGE;
  if (planState(features).expired) return features.message || EXPIRED_MESSAGE;
  if (account.role === "agent" && features.flags.agentLogin === false) return "Agent login abhi band hai — trust se sampark karein.";
  if (account.role === "member" && features.flags.memberLogin === false) return "Member login abhi band hai — trust se sampark karein.";
  return null;
}

/**
 * Whole panel closed (switched off / plan over) → error whose details carry what the
 * "panel band" screen shows: { blocked: { reason, message, expiresAt, support, trustName } }.
 * Agent / member logins switched off → plain error (the mobile app shows the message).
 */
export async function blockedError(status, account, features, message) {
  const reason = !features?.active ? "inactive" : planState(features).expired ? "expired" : null;
  if (!reason) return new HttpError(status, message);
  let trustName = null;
  try {
    const { rows: [r] } = await db.execute(sql`SELECT coalesce(trust_info->>'name', display_name) AS n FROM admins WHERE id = ${account.adminId}`);
    trustName = r?.n || null;
  } catch { /* name is only decoration */ }
  return new HttpError(status, message, {
    blocked: { reason, message, expiresAt: features.expiresAt, support: hasSupport(features.support) ? features.support : null, trustName },
  });
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
