// Secret feature-control login (see lib/controlAuth.js). 404 everywhere when CONTROL_KEY is not set.
import { NextResponse } from "next/server";
import { route, readJson } from "@/lib/http.js";
import { clientIp } from "@/lib/access.js";
import { assertEnabled, checkKey, issueControlToken, controlCookie, requireControl, CONTROL_COOKIE } from "@/lib/controlAuth.js";

export const dynamic = "force-dynamic";

/** GET → { loggedIn } */
export const GET = route(async ({ request }) => {
  assertEnabled();
  try { await requireControl(request); return { loggedIn: true }; } catch { return { loggedIn: false }; }
}, { auth: false });

/** POST { key } → sets the control cookie */
export const POST = route(async ({ request }) => {
  const { key } = await readJson(request);
  checkKey(String(key || ""), clientIp(request));
  const { token, maxAge } = await issueControlToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(controlCookie(token, maxAge));
  return res;
}, { auth: false });

/** DELETE → log out */
export const DELETE = route(async () => {
  assertEnabled();
  const res = NextResponse.json({ success: true });
  res.cookies.set({ ...controlCookie("", 0), name: CONTROL_COOKIE });
  return res;
}, { auth: false });
