// Trust logo for the mobile app (public). A logo saved as an uploaded file is linked directly;
// one stored inline (data:image/…;base64 — e.g. migrated from the old app) is served from here.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { rows: [r] } = await db.execute(sql`SELECT trust_info->>'logo' AS logo FROM admins ORDER BY created_at LIMIT 1`);
  const logo = String(r?.logo || "");
  const m = logo.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (m) {
    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=3600" },
    });
  }
  if (/^https?:\/\//.test(logo) || logo.startsWith("/")) return NextResponse.redirect(new URL(logo, request.url), 302);
  return NextResponse.json({ success: false, error: "logo nahi hai" }, { status: 404 });
}
