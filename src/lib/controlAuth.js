// Secret developer access for the /feature-control page — not a normal login.
//
//   • Off unless CONTROL_KEY (12+ characters) is set in the server .env. Off = every /api/control
//     call answers 404, so the page looks like it does not exist.
//   • The key is typed on the page once; a signed cookie (8 hours, only sent to /api/control)
//     keeps you in. Changing CONTROL_KEY logs everyone out.
//   • 5 wrong keys from one IP → that IP is locked out for 15 minutes.
import { SignJWT, jwtVerify } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
import { notFound, unauthorized, HttpError } from "./errors.js";

export const CONTROL_COOKIE = "mgsf_ctl";
const HOURS = 8;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const g = globalThis;
const fails = (g.__mgsfControlFails ??= new Map()); // ip → { n, until }

const key = () => String(process.env.CONTROL_KEY || "");
export const controlEnabled = () => key().length >= 12;
const sha = (s) => createHash("sha256").update(String(s)).digest();

function secret() {
  // tied to both secrets: a new CONTROL_KEY or JWT_SECRET ends every control session
  const s = `${process.env.JWT_SECRET || ""}:control:${sha(key()).toString("hex")}`;
  return new TextEncoder().encode(s);
}

export function assertEnabled() {
  if (!controlEnabled()) throw notFound();
}

export function checkKey(typed, ip = "") {
  assertEnabled();
  const now = Date.now();
  const f = fails.get(ip);
  if (f?.until > now) {
    throw new HttpError(429, `Bahut galat koshish — ${Math.ceil((f.until - now) / 60000)} minute baad try karein`);
  }
  const ok = timingSafeEqual(sha(typed), sha(key()));
  if (!ok) {
    // count misses inside a 15-minute window; the 5th one locks this IP for 15 minutes
    const cur = f && now - f.first < LOCK_MS && !(f.until && f.until <= now) ? f : { n: 0, first: now, until: 0 };
    cur.n += 1;
    if (cur.n >= MAX_FAILS) cur.until = now + LOCK_MS;
    fails.set(ip, cur);
    if (fails.size > 5000) fails.clear(); // never grow without bound
    throw unauthorized("Galat key");
  }
  fails.delete(ip);
}

export async function issueControlToken() {
  const token = await new SignJWT({ scope: "control" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${HOURS}h`)
    .sign(secret());
  return { token, maxAge: HOURS * 3600 };
}

export const controlCookie = (token, maxAge) => ({
  name: CONTROL_COOKIE, value: token,
  httpOnly: true, sameSite: "strict", path: "/api/control",
  secure: process.env.NODE_ENV === "production", maxAge,
});

/** Throws unless the request carries a valid control cookie. */
export async function requireControl(request) {
  assertEnabled();
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${CONTROL_COOKIE}=([^;]+)`));
  if (!m) throw unauthorized("Control login chahiye");
  try {
    const { payload } = await jwtVerify(decodeURIComponent(m[1]), secret());
    if (payload.scope !== "control") throw new Error("scope");
  } catch {
    throw unauthorized("Control session khatam — key dobara daalein");
  }
}
