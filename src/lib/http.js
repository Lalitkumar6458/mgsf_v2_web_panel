import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";
import { getAuth } from "./auth.js";
import { assertApiAccess } from "./apiAccess.js";
import { auditRequest } from "../services/audit.js";
import { clientIp } from "./access.js";
export { assertApiAccess };

/**
 * Wrap a route handler: JSON errors, optional auth.
 *   export const GET = route(async ({ request, auth, params }) => {...}, { auth: true })
 */
export function route(fn, { auth = true } = {}) {
  return async (request, ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      const a = auth ? await getAuth(request) : null;
      if (a) assertApiAccess(a, request);
      // audit log: keep a copy of the JSON body of a change (the handler reads the original)
      const write = a && !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const bodyCopy = write && (request.headers.get("content-type") || "").includes("json")
        ? request.clone().json().catch(() => null) : null;
      const result = await fn({ request, auth: a, params, query: new URL(request.url).searchParams });
      if (write) {
        const ok = !(result instanceof Response) || result.ok;
        if (ok) Promise.resolve(bodyCopy).then((body) => auditRequest({ auth: a, request, body, result: result instanceof Response ? null : result, ip: clientIp(request) })).catch(() => {});
      }
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ success: false, error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ success: false, error: "Invalid input", details: err.flatten() }, { status: 400 });
      }
      if (err?.code === "P2002") {
        return NextResponse.json({ success: false, error: "Duplicate value", details: err.meta }, { status: 409 });
      }
      // missing table / column = new code, old database → tell the admin what to run
      const pg = err?.cause?.code || err?.code;
      if (pg === "42703" || pg === "42P01") {
        console.error("[api] database not migrated:", err?.cause?.message || err.message);
        return NextResponse.json({
          success: false,
          error: "Database update pending — server folder mein `npm run db:migrate` chalayein, phir server restart karein.",
        }, { status: 500 });
      }
      console.error("[api]", request.method, request.url, err);
      return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

